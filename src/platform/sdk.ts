/**
 * Обёртка над Yandex Games SDK v2.
 *
 * Два принципа, из которых следует всё остальное:
 *
 * 1. Отказ платформы никогда не ломает игру. Каждый вызов в try/catch, каждое
 *    ожидание — с таймаутом. Если реклама не показалась, сохранение не
 *    записалось, а лидерборд не ответил, игрок этого не замечает и продолжает
 *    играть. Промисы SDK на некоторых встраиваниях не резолвятся вообще —
 *    поэтому таймауты, а не просто catch.
 *
 * 2. Локально работает mock. Без него разработку пришлось бы вести только в
 *    песочнице платформы. Mock хранит данные в localStorage и логирует все
 *    обращения к рекламе в window.__ysdkMockLog — на этом построены смоук-тесты.
 *
 * SDK подключается программно (см. loadSdkScript), а не тегом в index.html:
 * устойчивее к строгому CSP хостинга и без гонки состояний между async-загрузкой
 * скрипта и нашим модулем.
 */

import { t } from '../i18n';
import { installClock } from './clock';

const LS_KEY = 'drop.save.v1';
const LS_LEADERBOARD = 'drop.mock.leaderboard.v1';
const INIT_TIMEOUT_MS = 10_000;
const CALL_TIMEOUT_MS = 8_000;

/**
 * Лимит площадки на запись данных игрока — 100 обращений за 5 минут, дальше
 * запрос отклоняется ошибкой. Держимся ниже с запасом: в тот же лимит попадает
 * и чтение на старте, и внеплановые записи после покупок.
 */
const SAVE_LIMIT = 80;
const SAVE_WINDOW_MS = 5 * 60_000;

export interface LeaderboardEntry {
  rank: number;
  score: number;
  name: string;
  /** Это строка самого игрока — её подсвечиваем в таблице. */
  self: boolean;
}

export interface CatalogItem {
  id: string;
  title: string;
  description: string;
  /** Цена с кодом валюты, как её отдаёт площадка: «20 YAN». */
  price: string;
  /** Только число, без валюты. */
  priceValue: string;
  imageURI?: string;
  /**
   * Иконка портальной валюты (SVG), взятая из свойств товара.
   *
   * Требование п. 1.13.2: портальная валюта определяется автоматически, её
   * название и иконку нужно брать из `IProduct`, а не рисовать своими. Валюта
   * различается по регионам, и нарисованный ян в турецкой витрине был бы
   * прямым обманом игрока.
   */
  currencyIcon?: string;
}

export interface PurchasedItem {
  productID: string;
  purchaseToken: string;
}

type Unsubscribe = () => void;

function timeout<T>(ms: number, value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

function mockLog(...args: unknown[]): void {
  console.log('[YSDK-mock]', ...args);
  const w = window as unknown as { __ysdkMockLog?: string[] };
  w.__ysdkMockLog = w.__ysdkMockLog ?? [];
  w.__ysdkMockLog.push(args.map(String).join(' '));
}

/** Заглушка игрока: те же методы, что у ysdk.player, но поверх localStorage. */
class MockPlayer {
  getData(): Promise<Record<string, unknown>> {
    try {
      return Promise.resolve(JSON.parse(localStorage.getItem(LS_KEY) ?? '{}'));
    } catch {
      return Promise.resolve({});
    }
  }
  setData(data: Record<string, unknown>): Promise<void> {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(data));
    } catch {
      // Приватный режим — сохранений не будет, но игра продолжается.
    }
    return Promise.resolve();
  }
  getName(): string {
    return t('common.player');
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnySdk = any;

/**
 * Иконка валюты товара. Отдельная функция, потому что метод может
 * отсутствовать: витрина без подключённой монетизации отдаёт голые поля.
 */
function iconOf(product: AnySdk): string | undefined {
  try {
    return product.getPriceCurrencyImage?.('svg') || undefined;
  } catch {
    return undefined;
  }
}

export class Platform {
  private readonly ysdk: AnySdk | null;
  readonly isMock: boolean;
  private player: AnySdk = null;
  private leaderboards: AnySdk = null;
  private payments: AnySdk = null;

  lang = 'ru';
  isMobile = false;

  private gameplayRunning = false;
  private loadingReadySent = false;
  private bannerShown = false;
  /** Оценку игры площадка разрешает просить один раз за сессию. */
  private reviewRequested = false;
  /** Моменты фактических записей — для соблюдения лимита площадки. */
  private readonly writes: number[] = [];

  constructor(ysdk: AnySdk | null) {
    this.ysdk = ysdk;
    this.isMock = !ysdk;
  }

  async init(): Promise<void> {
    if (this.isMock) {
      this.player = new MockPlayer();
      // Только в режиме заглушки: на площадке язык всегда приходит из SDK,
      // а локально другого источника просто нет.
      this.lang = (navigator.language || 'ru').toLowerCase().split('-')[0];
      this.isMobile = /android|iphone|ipad|mobile/i.test(navigator.userAgent);
      mockLog('init (режим заглушки)');
      return;
    }
    try {
      this.lang = this.ysdk.environment?.i18n?.lang ?? 'ru';
    } catch {
      this.lang = 'ru';
    }
    try {
      this.isMobile = Boolean(this.ysdk.deviceInfo?.isMobile?.());
    } catch {
      this.isMobile = false;
    }
    try {
      // scopes:false — персональные данные не запрашиваем: это требование
      // модерации и лишний диалог на входе, который роняет конверсию.
      this.player = await Promise.race([
        this.ysdk.getPlayer({ scopes: false }),
        timeout(CALL_TIMEOUT_MS, null),
      ]);
    } catch (e) {
      console.warn('getPlayer не удался, работаем через localStorage', e);
    }
    if (!this.player) this.player = new MockPlayer();
  }

  // --- Время --------------------------------------------------------------

  /**
   * Текущее время площадки, мс.
   *
   * `ysdk.serverTime()` — то же по формату, что `Date.now()`, но одинаковое на
   * всех устройствах и неподвластное переводу системных часов. Всё, что игрок
   * получает по календарю (награда за вход, пропуск, вызов дня, сезон) и всё,
   * что меряется секундами в лидерборд (забег блица), считает время отсюда.
   *
   * Вызывается на каждое обращение, как требует документация, а не берётся
   * поправка один раз на старте: поправка, снятая до перевода часов, ровно
   * настолько же врёт после него.
   */
  now(): number {
    if (!this.isMock) {
      try {
        const value = this.ysdk.serverTime?.();
        if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
      } catch {
        /* метода нет или он отказал — часы устройства */
      }
    }
    return Date.now();
  }

  // --- Обязательные для модерации сигналы ---------------------------------

  /** Идёт ли сейчас размеченный геймплей. */
  get isGameplayRunning(): boolean {
    return this.gameplayRunning;
  }

  /** Игра загрузилась. Ровно один раз, иначе платформа считает это ошибкой. */
  loadingReady(): void {
    if (this.loadingReadySent) return;
    this.loadingReadySent = true;
    if (this.isMock) return void mockLog('LoadingAPI.ready');
    try {
      this.ysdk.features?.LoadingAPI?.ready?.();
    } catch (e) {
      console.warn('LoadingAPI.ready не удался', e);
    }
  }

  /** Геймплей идёт: платформа не показывает поверх него ничего своего. */
  gameplayStart(): void {
    if (this.gameplayRunning) return;
    this.gameplayRunning = true;
    if (this.isMock) return void mockLog('GameplayAPI.start');
    try {
      this.ysdk.features?.GameplayAPI?.start?.();
    } catch (e) {
      console.warn('GameplayAPI.start не удался', e);
    }
  }

  /** Геймплей встал: меню, реклама, пауза, победа, свёрнутая вкладка. */
  gameplayStop(): void {
    if (!this.gameplayRunning) return;
    this.gameplayRunning = false;
    if (this.isMock) return void mockLog('GameplayAPI.stop');
    try {
      this.ysdk.features?.GameplayAPI?.stop?.();
    } catch (e) {
      console.warn('GameplayAPI.stop не удался', e);
    }
  }

  /**
   * Пауза и возобновление со стороны платформы.
   *
   * У SDK для этого есть события `game_api_pause` / `game_api_resume`, но
   * подписка на них доступна не во всех встраиваниях, а замолчать звук и
   * остановить таймер блица нужно НАДЁЖНО — иначе игрок теряет забег, пока
   * смотрит рекламу в другой вкладке. Поэтому подписываемся и на события SDK,
   * и на visibilitychange документа, который работает всегда.
   */
  onPauseResume(onPause: () => void, onResume: () => void): Unsubscribe {
    const unsubs: Unsubscribe[] = [];

    if (!this.isMock) {
      try {
        const pause = () => onPause();
        const resume = () => onResume();
        this.ysdk.on?.('game_api_pause', pause);
        this.ysdk.on?.('game_api_resume', resume);
        unsubs.push(() => {
          try {
            this.ysdk.off?.('game_api_pause', pause);
            this.ysdk.off?.('game_api_resume', resume);
          } catch {
            /* не поддерживается — не страшно */
          }
        });
      } catch {
        /* события недоступны — остаётся visibilitychange */
      }
    }

    const onVisibility = () => (document.hidden ? onPause() : onResume());
    document.addEventListener('visibilitychange', onVisibility);
    unsubs.push(() => document.removeEventListener('visibilitychange', onVisibility));

    return () => unsubs.forEach((fn) => fn());
  }

  /**
   * Кнопка «Назад» на пульте телевизора.
   *
   * Событие приходит только в телевизионном встраивании. Платформа требует
   * показать по нему СВОЙ диалог с подтверждением выхода, а не выходить молча,
   * и отправить `EXIT` уже после подтверждения — см. exit().
   */
  onHistoryBack(handler: () => void): Unsubscribe {
    if (this.isMock) return () => {};
    try {
      const name = this.ysdk.EVENTS?.HISTORY_BACK ?? 'HISTORY_BACK';
      // on() в этом семействе событий возвращает функцию отписки; на части
      // встраиваний — ничего, тогда отписываемся через off().
      const off = this.ysdk.on?.(name, handler);
      if (typeof off === 'function') return off as Unsubscribe;
      return () => {
        try {
          this.ysdk.off?.(name, handler);
        } catch {
          /* не поддерживается */
        }
      };
    } catch {
      return () => {};
    }
  }

  /** Игрок подтвердил выход в нашем диалоге — сообщаем платформе. */
  exit(): void {
    if (this.isMock) return void mockLog('dispatchEvent EXIT');
    try {
      this.ysdk.dispatchEvent?.(this.ysdk.EVENTS?.EXIT ?? 'EXIT');
    } catch (e) {
      console.warn('EXIT не отправлен', e);
    }
  }

  // --- Реклама ------------------------------------------------------------

  /**
   * Фулскрин между уровнями. Частоту регулирует платформа — наша задача дать
   * корректную логическую паузу и прочитать фактический результат из onClose
   * (план, §8). Звать чаще смысла нет: лишнее платформа отфильтрует сама.
   */
  showInterstitial(): Promise<{ wasShown: boolean }> {
    if (this.isMock) {
      mockLog('showFullscreenAdv');
      return Promise.resolve({ wasShown: true });
    }
    return new Promise((resolve) => {
      let settled = false;
      const done = (r: { wasShown: boolean }) => {
        if (!settled) {
          settled = true;
          resolve(r);
        }
      };
      // Страховка: если SDK не позовёт ни один колбэк, игра не должна
      // остаться в состоянии «ждём рекламу» навсегда.
      setTimeout(() => done({ wasShown: false }), CALL_TIMEOUT_MS * 2);
      try {
        this.ysdk.adv.showFullscreenAdv({
          callbacks: {
            onClose: (wasShown: boolean) => done({ wasShown: Boolean(wasShown) }),
            onError: () => done({ wasShown: false }),
            onOffline: () => done({ wasShown: false }),
          },
        });
      } catch (e) {
        console.warn('showFullscreenAdv не удался', e);
        done({ wasShown: false });
      }
    });
  }

  /**
   * Реклама за вознаграждение. Награда выдаётся ТОЛЬКО после onRewarded:
   * начислять по onClose — это выдавать награду за закрытый крестиком ролик,
   * и рекламная сеть считает такое фродом.
   */
  showRewarded(): Promise<{ rewarded: boolean }> {
    if (this.isMock) {
      mockLog('showRewardedVideo');
      return Promise.resolve({ rewarded: true });
    }
    return new Promise((resolve) => {
      let rewarded = false;
      let settled = false;
      const done = (r: { rewarded: boolean }) => {
        if (!settled) {
          settled = true;
          resolve(r);
        }
      };
      setTimeout(() => done({ rewarded }), CALL_TIMEOUT_MS * 3);
      try {
        this.ysdk.adv.showRewardedVideo({
          callbacks: {
            onRewarded: () => {
              rewarded = true;
            },
            onClose: () => done({ rewarded }),
            onError: () => done({ rewarded: false }),
          },
        });
      } catch (e) {
        console.warn('showRewardedVideo не удался', e);
        done({ rewarded: false });
      }
    });
  }

  /** Sticky-баннер включён всю сессию (план, §8). */
  async showBanner(): Promise<void> {
    if (this.bannerShown) return;
    this.bannerShown = true;
    if (this.isMock) return void mockLog('showBannerAdv');
    try {
      await this.ysdk.adv.showBannerAdv();
    } catch (e) {
      console.warn('showBannerAdv не удался', e);
    }
  }

  async hideBanner(): Promise<void> {
    if (!this.bannerShown) return;
    this.bannerShown = false;
    if (this.isMock) return void mockLog('hideBannerAdv');
    try {
      await this.ysdk.adv.hideBannerAdv();
    } catch (e) {
      console.warn('hideBannerAdv не удался', e);
    }
  }

  // --- Сохранения ---------------------------------------------------------

  async getData(): Promise<Record<string, unknown>> {
    if (!this.player) return {};
    try {
      const data = await Promise.race([this.player.getData(), timeout(CALL_TIMEOUT_MS, null)]);
      return (data as Record<string, unknown>) ?? {};
    } catch {
      return {};
    }
  }

  /**
   * flush=true — немедленная запись на сервер (пройден уровень, куплен товар).
   *
   * Возвращает, ДОШЛА ли запись. Это нужно ровно одному месту — выдаче
   * покупки: документация площадки требует сначала сохранить данные игрока и
   * только потом вызывать `consumePurchase`, потому что потреблённая покупка
   * удаляется безвозвратно. Раньше отсюда возвращался void, отвалившийся и
   * успешный вызов были неотличимы, и покупка потреблялась в любом случае —
   * при неудачной записи игрок остался бы и без товара, и без возможности его
   * восстановить.
   */
  async setData(data: Record<string, unknown>, flush = false): Promise<boolean> {
    if (!this.player) return false;
    if (!this.takeWriteSlot()) {
      // Лимит площадки исчерпан. Отправлять всё равно смысла нет — запрос
      // отклонят с ошибкой, а профиль по возвращённому false оставит данные
      // грязными и повторит попытку позже. Это ровно тот случай, ради
      // которого setData возвращает результат, а не void.
      console.warn('setData отложен: лимит записей площадки');
      return false;
    }
    try {
      // Таймаут возвращает false: молчащий сервер — это НЕ успешная запись.
      return await Promise.race([
        this.player.setData(data, flush).then(() => true),
        timeout(CALL_TIMEOUT_MS, false),
      ]);
    } catch (e) {
      console.warn('setData не удался', e);
      return false;
    }
  }

  /**
   * Занять место в окне лимита записей.
   *
   * Окно считается по часам устройства, а не по серверным: здесь меряется
   * промежуток между нашими же вызовами, и перевод часов игроком лимит
   * площадки не отменяет — рискуем только собственными отказами.
   */
  private takeWriteSlot(): boolean {
    const edge = Date.now() - SAVE_WINDOW_MS;
    while (this.writes.length > 0 && this.writes[0] < edge) this.writes.shift();
    if (this.writes.length >= SAVE_LIMIT) return false;
    this.writes.push(Date.now());
    return true;
  }

  playerName(): string {
    try {
      return this.player?.getName?.() || t('common.player');
    } catch {
      return t('common.player');
    }
  }

  // --- Лидерборды ---------------------------------------------------------

  private async getLeaderboards(): Promise<AnySdk> {
    if (this.leaderboards) return this.leaderboards;
    if (this.isMock) return null;
    try {
      this.leaderboards = await Promise.race([
        this.ysdk.getLeaderboards(),
        timeout(CALL_TIMEOUT_MS, null),
      ]);
    } catch (e) {
      console.warn('getLeaderboards не удался', e);
    }
    return this.leaderboards;
  }

  async submitScore(leaderboard: string, score: number): Promise<void> {
    if (this.isMock) {
      // Заглушка ведёт таблицу в localStorage, чтобы экран лидерборда можно
      // было разрабатывать и проверять локально.
      try {
        const all = JSON.parse(localStorage.getItem(LS_LEADERBOARD) ?? '{}');
        all[leaderboard] = Math.max(score, all[leaderboard] ?? 0);
        localStorage.setItem(LS_LEADERBOARD, JSON.stringify(all));
      } catch {
        /* приватный режим */
      }
      return void mockLog('setLeaderboardScore', leaderboard, score);
    }
    const lb = await this.getLeaderboards();
    if (!lb) return;
    try {
      await lb.setLeaderboardScore(leaderboard, Math.round(score));
    } catch (e) {
      console.warn('setLeaderboardScore не удался', e);
    }
  }

  /**
   * Своя строка в таблице. Отдельный вызов SDK, а не поиск себя в общем
   * списке: в записях списка нет надёжного признака «это я» — предыдущая
   * версия опиралась на недокументированное поле и не работала.
   *
   * Нужна для карточки результата: план (§2) требует показывать на ней место
   * в топе, а не только очки.
   */
  async fetchPlayerRank(leaderboard: string): Promise<number | null> {
    if (this.isMock) {
      const entries = this.mockLeaderboard(leaderboard, 10);
      return entries.find((e) => e.self)?.rank ?? null;
    }
    const lb = await this.getLeaderboards();
    if (!lb) return null;
    try {
      const entry = await Promise.race([
        lb.getLeaderboardPlayerEntry(leaderboard),
        timeout(CALL_TIMEOUT_MS, null),
      ]);
      return typeof entry?.rank === 'number' && entry.rank > 0 ? entry.rank : null;
    } catch {
      // Игрок ещё не в таблице — это не ошибка, а обычное состояние новичка.
      return null;
    }
  }

  async fetchLeaderboard(leaderboard: string, top = 10): Promise<LeaderboardEntry[]> {
    if (this.isMock) return this.mockLeaderboard(leaderboard, top);
    const lb = await this.getLeaderboards();
    if (!lb) return [];

    // Своё место запрашиваем отдельно и по нему помечаем строку в списке.
    const myRank = await this.fetchPlayerRank(leaderboard);

    try {
      const res = await Promise.race([
        lb.getLeaderboardEntries(leaderboard, {
          quantityTop: top,
          includeUser: true,
          quantityAround: 3,
        }),
        timeout(CALL_TIMEOUT_MS, null),
      ]);
      if (!res?.entries) return [];
      return res.entries.map((e: AnySdk) => ({
        rank: e.rank,
        score: e.score,
        name: e.player?.publicName || t('common.player'),
        self: myRank !== null && e.rank === myRank,
      }));
    } catch (e) {
      console.warn('getLeaderboardEntries не удался', e);
      return [];
    }
  }

  private mockLeaderboard(leaderboard: string, top: number): LeaderboardEntry[] {
    let mine = 0;
    try {
      mine = JSON.parse(localStorage.getItem(LS_LEADERBOARD) ?? '{}')[leaderboard] ?? 0;
    } catch {
      mine = 0;
    }
    const names = ['ЛисаНеон', 'drop_king', 'Мурчалка', 'ZeroTwo', 'Витринка', 'sortmaster', 'ღ Ая ღ'];
    const fake = names.map((name, i) => ({
      rank: 0,
      score: Math.round(mine * 1.5 + 900 - i * 120 + (i % 3) * 40),
      name,
      self: false,
    }));
    fake.push({ rank: 0, score: mine, name: t('common.you'), self: true });
    return fake
      .sort((a, b) => b.score - a.score)
      .slice(0, top)
      .map((e, i) => ({ ...e, rank: i + 1 }));
  }

  // --- Инапы --------------------------------------------------------------

  private async getPayments(): Promise<AnySdk> {
    if (this.payments) return this.payments;
    if (this.isMock) return null;
    try {
      // signed:false — подпись покупок проверял бы наш сервер, которого нет.
      // Товары здесь только косметика и удобства, поэтому риск приемлемый и
      // осознанный; ничего, что даёт преимущество в лидерборде, не продаётся.
      this.payments = await Promise.race([
        this.ysdk.getPayments({ signed: false }),
        timeout(CALL_TIMEOUT_MS, null),
      ]);
    } catch (e) {
      console.warn('getPayments не удался', e);
    }
    return this.payments;
  }

  async fetchCatalog(): Promise<CatalogItem[]> {
    if (this.isMock) return [];
    const payments = await this.getPayments();
    if (!payments) return [];
    try {
      const catalog = await Promise.race([payments.getCatalog(), timeout(CALL_TIMEOUT_MS, null)]);
      if (!Array.isArray(catalog)) return [];
      return catalog.map((item: AnySdk) => ({
        id: String(item.id),
        title: String(item.title ?? ''),
        description: String(item.description ?? ''),
        price: String(item.price ?? ''),
        priceValue: String(item.priceValue ?? ''),
        imageURI: item.imageURI,
        // Метод живёт на объекте товара, поэтому его нужно вызвать здесь:
        // дальше по коду остаётся уже наш простой объект без методов.
        currencyIcon: iconOf(item),
      }));
    } catch (e) {
      console.warn('getCatalog не удался', e);
      return [];
    }
  }

  /** Купить товар. Возвращает токен покупки или null при отказе/ошибке. */
  async purchase(productId: string): Promise<string | null> {
    if (this.isMock) {
      mockLog('purchase', productId);
      return `mock-token-${productId}`;
    }
    const payments = await this.getPayments();
    if (!payments) return null;
    try {
      const purchase = await payments.purchase({ id: productId });
      return purchase?.purchaseToken ?? null;
    } catch (e) {
      // Отказ игрока приходит сюда же, что и ошибка — для нас это одно и то же.
      console.warn('purchase не завершён', e);
      return null;
    }
  }

  /**
   * Незакрытые покупки. Их нужно вычитывать на старте: если игра закрылась
   * между оплатой и начислением, товар выдастся при следующем запуске.
   */
  async pendingPurchases(): Promise<PurchasedItem[]> {
    if (this.isMock) return [];
    const payments = await this.getPayments();
    if (!payments) return [];
    try {
      const list = await Promise.race([payments.getPurchases(), timeout(CALL_TIMEOUT_MS, null)]);
      if (!Array.isArray(list)) return [];
      return list.map((p: AnySdk) => ({
        productID: String(p.productID),
        purchaseToken: String(p.purchaseToken),
      }));
    } catch (e) {
      console.warn('getPurchases не удался', e);
      return [];
    }
  }

  /** Подтвердить выдачу расходуемого товара, чтобы его можно было купить снова. */
  async consume(token: string): Promise<void> {
    if (this.isMock) return void mockLog('consumePurchase', token);
    const payments = await this.getPayments();
    if (!payments) return;
    try {
      await payments.consumePurchase(token);
    } catch (e) {
      console.warn('consumePurchase не удался', e);
    }
  }

  // --- Прочее -------------------------------------------------------------

  /** Скопировать текст результата — основа шеринга (план, §2). */
  async copyText(text: string): Promise<boolean> {
    try {
      if (!this.isMock && this.ysdk.clipboard?.writeText) {
        await this.ysdk.clipboard.writeText(text);
        return true;
      }
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Предложить оценить игру.
   *
   * Порядок задан документацией и обязателен: сначала `canReview()`, только
   * потом `requestReview()`. Без проверки площадка отвечает отказом с ошибкой
   * «use canReview before requestReview», а спросить можно ровно один раз за
   * сессию — поэтому второй вызов не проходит дальше флага. Причин отказа
   * несколько (не авторизован, уже оценивал, запрос уже был), и все они
   * нормальны: оценка — не то, что можно требовать.
   *
   * Возвращает, поставил ли игрок оценку.
   */
  async requestReview(): Promise<boolean> {
    if (this.reviewRequested) return false;
    this.reviewRequested = true;
    if (this.isMock) {
      mockLog('requestReview');
      return true;
    }
    try {
      const can = await Promise.race([
        this.ysdk.feedback.canReview(),
        timeout(CALL_TIMEOUT_MS, { value: false, reason: 'TIMEOUT' }),
      ]);
      if (!can?.value) {
        console.log('оценку сейчас не спрашиваем:', can?.reason);
        return false;
      }
      const result = await Promise.race([
        this.ysdk.feedback.requestReview(),
        timeout(CALL_TIMEOUT_MS, { feedbackSent: false }),
      ]);
      return Boolean(result?.feedbackSent);
    } catch (e) {
      console.warn('requestReview не удался', e);
      return false;
    }
  }
}

/**
 * Создаёт и подключает <script src="/sdk.js"> программно.
 *
 * Обработчики назначены как JS-свойства (.onload/.onerror), а не атрибутами в
 * разметке: инлайновые обработчики подпадают под ограничения CSP, а сам
 * элемент создаётся и слушатели вешаются синхронно — гонки состояний нет.
 */
function loadSdkScript(): Promise<boolean> {
  return new Promise((resolve) => {
    const script = document.createElement('script');
    script.async = true;
    script.src = '/sdk.js';
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
}

export async function initPlatform(): Promise<Platform> {
  let ysdk: AnySdk = null;
  const loaded = await Promise.race([loadSdkScript(), timeout(INIT_TIMEOUT_MS, false)]);
  const w = window as unknown as { YaGames?: { init(): Promise<AnySdk> } };
  if (loaded && w.YaGames) {
    try {
      // На части встраиваний init() зависает без reject — ограничиваем
      // ожидание, иначе игра навсегда останется на экране загрузки.
      ysdk = (await Promise.race([w.YaGames.init(), timeout(INIT_TIMEOUT_MS, null)])) ?? null;
    } catch (e) {
      console.warn('YaGames.init не удался, переходим в режим заглушки', e);
    }
  }
  const platform = new Platform(ysdk);
  // Часы игры переводятся на серверное время ДО загрузки профиля: календарные
  // награды считаются уже при первом чтении сохранения.
  installClock(() => platform.now());
  try {
    await Promise.race([platform.init(), timeout(INIT_TIMEOUT_MS, undefined)]);
  } catch (e) {
    console.warn('инициализация обёртки не удалась', e);
  }
  // Для отладки в песочнице и для смоук-тестов.
  (window as unknown as { __platform?: Platform }).__platform = platform;
  return platform;
}
