/**
 * Связующий слой: экраны, режимы, реклама, сохранения.
 *
 * Правила живут в src/core, картинка — в src/render, платформа — в
 * src/platform. Здесь только последовательности: что за чем происходит.
 *
 * Главное решение по рекламе (план, §8): фулскрин показывается на ПЕРЕХОДЕ к
 * следующему уровню, после того как игрок увидел награду и сам нажал «дальше».
 * Не перед экраном победы: перебивать роликом момент награды — это отдавать
 * удержание за один показ. И не два ролика подряд — если игрок только что
 * смотрел rewarded, фулскрин на этом переходе пропускается.
 */

import { Application, Container } from 'pixi.js';
import { Board, findHint, rateLevel, BLITZ_DURATION, BLITZ_TIME_BONUS, blitzSetPoints } from './core';
import type { LevelSpec } from './core';
import { blitzLevel, campaignLevel, dailyLevel } from './levels/provider';
import { BLIND_BOX_COST, isCompetitive, Profile, type GameMode } from './meta/profile';
import { Ads } from './platform/ads';
import { Audio, Haptics } from './platform/audio';
import type { Platform } from './platform/sdk';
import { Background } from './render/background';
import { BoardView } from './render/board-view';
import { ComboFlash, Particles, Popups, Rings, Shake } from './render/fx';
import { figurineTexture, preloadFigurines } from './render/textures';
import { Tweens } from './render/tween';
import {
  figurineByKey,
  figurineLook,
  figurineName,
  seasonById,
  seasonDaysLeft,
  type FigurineDef,
  type SeasonTheme,
} from './theme/seasons';
import { brand, setLanguage, t } from './i18n';
import { skinById, themeWithSkin } from './theme/skins';
import { applyThemeVars, el } from './ui/dom';
import { Hud, type HudState } from './ui/hud';
import {
  showBlitzResult,
  showBoxReveal,
  showConfirm,
  showDailyResult,
  showDeadlock,
  showPause,
  showSeasonAnnounce,
  showStreak,
  showTutorial,
  showVictory,
} from './ui/modals';
import {
  createCollection,
  createLeaderboard,
  createMenu,
  createShop,
  LEADERBOARD_BLITZ,
  LEADERBOARD_DAILY,
  type Screen,
} from './ui/screens';

/** Через сколько бездействия подсветить кнопку подсказки (план, §8). */
const IDLE_HINT_MS = 20_000;

/**
 * Расходуемые товары — те, которые можно купить повторно.
 *
 * «Убрать рекламу» и скины сюда не входят: факт владения ими хранит сама
 * платформа тем, что покупка остаётся непотреблённой (см.
 * redeemPendingPurchases).
 */
const CONSUMABLE_PRODUCTS = new Set(['hints_10', 'week_pass']);

function isConsumable(productId: string): boolean {
  return CONSUMABLE_PRODUCTS.has(productId);
}

interface Session {
  mode: GameMode;
  spec: LevelSpec;
  board: Board;
  view: BoardView;
  /** Номер уровня кампании; для других режимов 0. */
  levelNumber: number;
  usedHint: boolean;
  doubledCoins: boolean;
  /**
   * Блиц: момент окончания забега (timestamp). Остаток считается от него, а не
   * накоплением deltaMS: Pixi ограничивает deltaMS сверху при низком FPS
   * (Ticker.minFPS), и на слабом устройстве шестьдесят «секунд» растягивались
   * бы в реальные девяносто. Для режима, который кормит лидерборд, это прямая
   * несправедливость.
   */
  deadline: number;
  /** Остаток в секундах, пересчитывается каждый кадр из deadline. */
  timeLeft: number;
  score: number;
  setsClosed: number;
  step: number;
  /** Только что смотрели rewarded — фулскрин на переходе пропускаем. */
  sawRewarded: boolean;
}

export class App {
  private readonly pixi = new Application();
  private readonly platform: Platform;
  private readonly profile: Profile;
  private readonly audio: Audio;
  private readonly haptics: Haptics;
  private readonly ads: Ads;

  private readonly tweens = new Tweens();
  private readonly particles = new Particles();
  private readonly rings = new Rings();
  private readonly popups = new Popups();
  private readonly comboFlash = new ComboFlash();
  private readonly shake = new Shake();
  private background!: Background;
  /** Контейнер, который трясётся: сам холст сдвигать нельзя. */
  private readonly stage = new Container();

  private uiRoot!: HTMLElement;
  private hud: Hud | null = null;
  private currentScreen: Screen | null = null;
  private session: Session | null = null;

  private species: FigurineDef[] = [];
  private lastInputAt = Date.now();
  private idleHintShown = false;
  private paused = false;
  /** Когда началась пауза платформы — на это время продлевается забег блица. */
  private pausedAt = 0;

  constructor(platform: Platform) {
    this.platform = platform;
    this.profile = new Profile(platform);
    this.audio = new Audio();
    this.haptics = new Haptics();
    this.ads = new Ads(platform, this.audio);
  }

  /** Палитра сезона с наложенным скином витрин. */
  private theme(): SeasonTheme {
    return themeWithSkin(seasonById(this.profile.seasonId).theme, this.profile.activeSkin);
  }

  // --- Запуск -------------------------------------------------------------

  async start(root: HTMLElement): Promise<void> {
    // Язык — самое первое: он приходит от площадки (§2.14), и всё, что строится
    // ниже, читает словарь. Поставить его позже значит собрать часть
    // интерфейса на языке по умолчанию.
    setLanguage(this.platform.lang);
    document.title = t('app.title');
    // Загрузчик написан латиницей: он рисуется до ответа площадки. Язык уже
    // известен — приводим надпись к локали, чтобы игрок не увидел смену
    // начертания между экраном загрузки и меню.
    const bootLogo = document.querySelector('#boot .logo');
    if (bootLogo) bootLogo.textContent = brand();

    await this.profile.load();
    this.audio.setMuted(this.profile.settings.muted);
    this.haptics.setEnabled(this.profile.settings.haptics);

    this.species = this.profile.fieldSpecies();
    this.applyLook();

    await this.pixi.init({
      resizeTo: window,
      backgroundAlpha: 0,
      antialias: true,
      // Ограничиваем плотность: на телефоне с DPR 3 честный рендер в три
      // раза дороже, а разница на витринах не читается.
      resolution: Math.min(2, window.devicePixelRatio || 1),
      autoDensity: true,
      preference: 'webgl',
    });
    root.appendChild(this.pixi.canvas);

    this.background = new Background(this.theme());
    // Порядок слоёв: фон → (поле вставляется сюда) → кольца → частицы →
    // всплывающие числа → вспышка комбо. Числа выше частиц намеренно: салют
    // из закрывшейся витрины бьёт ровно туда, где всплывает «+2 с».
    this.stage.addChild(
      this.background,
      this.rings,
      this.particles,
      this.popups,
      this.comboFlash
    );
    this.pixi.stage.addChild(this.stage);

    this.uiRoot = el('div', 'ui');
    root.appendChild(this.uiRoot);

    // Фигурки, которые реально выйдут на поле, — единственное, что
    // растеризуется на старте.
    await this.preloadSpecies();

    // Pixi по умолчанию режет deltaMS до 100 мс (minFPS = 10). Тайминги
    // анимаций у нас временные, поэтому на слабом устройстве, где кадр идёт
    // 200–300 мс, ходы шли бы заметно медленнее положенного. Опускаем порог:
    // защита от гигантских прыжков остаётся, но анимации держатся ближе к
    // реальному времени. Таймер блица от этого уже не зависит вовсе — он
    // считается от метки времени.
    this.pixi.ticker.minFPS = 4;
    this.pixi.ticker.add((ticker) => this.tick(ticker.deltaMS));

    // Контекстное меню браузера в игровой области выключено — требование
    // площадки (§1.6). На телефоне оно всплывает от долгого нажатия, а долгое
    // нажатие здесь — обычный способ подумать над ходом, не отрывая палец:
    // без этого меню открывалось прямо посреди партии.
    root.addEventListener('contextmenu', (event) => event.preventDefault());

    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 120));
    this.resize();

    // Первый жест разблокирует звук: раньше браузер его не разрешит.
    const unlock = () => {
      this.audio.unlock();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);

    this.platform.onPauseResume(
      () => this.onPlatformPause(),
      () => this.onPlatformResume()
    );

    // Сообщаем платформе о готовности ровно один раз, когда игра реально
    // готова к вводу, — иначе модерация считает это ошибкой.
    this.platform.loadingReady();
    document.getElementById('boot')?.classList.add('hide');
    setTimeout(() => document.getElementById('boot')?.remove(), 400);

    // Sticky-баннер на всю сессию, но не для тех, кто купил «без рекламы».
    if (!this.profile.noAds) void this.ads.showSticky();

    this.exposeDebugApi();

    await this.showMenu();
    await this.runEntryRituals();
  }

  /** Награда за вход и анонс нового сезона — после того, как меню уже видно. */
  private async runEntryRituals(): Promise<void> {
    if (this.profile.seasonRolledOver) {
      const season = seasonById(this.profile.seasonId);
      await showSeasonAnnounce(this.uiRoot, season, seasonDaysLeft());
    }
    if (this.profile.streakClaimable) {
      const claim = this.profile.claimStreak();
      if (claim) {
        this.audio.coin();
        await showStreak(this.uiRoot, claim);
        this.refreshMenu();
      }
    }
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.background.resize(w, h);
    if (this.session) this.layoutBoard();
  }

  /**
   * Полю отдаётся вертикаль между HUD и кнопками.
   *
   * Границы измеряются по фактическим размерам строк HUD, а не берутся
   * константами. Константы 78/86 совпадали с отступами в styles.css ровно при
   * одном сочетании: без вырезов экрана, при системном шрифте обычного
   * размера и при видимых кнопках инструментов. На телефоне с «бровью» поле
   * заезжало под HUD, а в блице, где половины кнопок нет, снизу оставалась
   * полоса пустоты в размер несуществующего ряда.
   */
  private layoutBoard(): void {
    if (!this.session) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const { top, bottom } = this.hud?.metrics() ?? { top: 78, bottom: 86 };
    const area = Math.max(160, h - top - bottom);
    this.session.view.layout(w, area);
    this.session.view.y = top;
  }

  private tick(dt: number): void {
    this.tweens.update(dt);
    this.background.update(dt);
    this.rings.update(dt);
    this.particles.update(dt);
    this.popups.update(dt);
    this.comboFlash.update(dt);

    const offset = this.shake.update(dt);
    this.stage.position.set(offset.x, offset.y);

    const session = this.session;
    if (!session || this.paused || this.ads.isBusy) return;

    session.view.update(dt);

    if (session.mode === 'blitz') {
      const before = Math.ceil(session.timeLeft);
      session.timeLeft = Math.max(0, (session.deadline - Date.now()) / 1000);
      const after = Math.ceil(session.timeLeft);
      // Тиканье последних секунд — только на смене целой секунды.
      if (after !== before && after <= 5 && after > 0) this.audio.tick(after <= 3);
      if (session.timeLeft <= 0) {
        void this.finishBlitz();
        return;
      }
    }

    // Залипание: подсвечиваем подсказку, а не навязываем её.
    if (!this.idleHintShown && Date.now() - this.lastInputAt > IDLE_HINT_MS) {
      this.idleHintShown = true;
      this.hud?.toast(t('toast.idleHint'));
    }

    this.updateHud();
  }

  private updateHud(): void {
    const session = this.session;
    if (!session || !this.hud) return;
    const state: HudState = {
      title:
        session.mode === 'campaign'
          ? String(session.levelNumber)
          : session.mode === 'blitz'
            ? t('hud.blitz')
            : t('hud.daily'),
      moves: session.board.moves,
      minMoves: session.mode === 'blitz' ? 0 : session.spec.minMoves,
      coins: this.profile.coins,
      closed: session.board.closedCount,
      total: session.board.speciesCount,
      seconds: session.mode === 'blitz' ? session.timeLeft : null,
      score: session.mode === 'blitz' ? session.score : null,
      hints: this.profile.hints,
      canUndo: session.board.canUndo && !session.view.isBusy,
      muted: this.audio.isMuted,
      busy: session.view.isBusy || this.ads.isBusy,
      competitive: isCompetitive(session.mode),
    };
    this.hud.update(state);
  }

  // --- Экраны -------------------------------------------------------------

  private setScreen(screen: Screen | null): void {
    this.currentScreen?.destroy();
    this.currentScreen = screen;
    if (screen) this.uiRoot.appendChild(screen.root);
  }

  private async showMenu(): Promise<void> {
    this.teardownSession();
    this.platform.gameplayStop();
    this.setScreen(
      createMenu(this.profile, {
        onCampaign: () => void this.startCampaign(),
        onBlitz: () => void this.startBlitz(),
        onDaily: () => void this.startDaily(),
        onCollection: () => this.showCollection(),
        onShop: () => void this.showShop(),
        onLeaderboard: () => void this.showLeaderboard(),
        onHowToPlay: () => void this.showTutorialAgain(),
        onToggleSound: () => this.toggleSound(),
      })
    );
  }

  private refreshMenu(): void {
    if (this.currentScreen && this.session === null) void this.showMenu();
  }

  private showCollection(): void {
    this.audio.tap();
    this.setScreen(
      createCollection(this.profile, {
        onBack: () => void this.showMenu(),
        onBuyBox: () => void this.openBox('coins'),
        onAdBox: () => void this.openBox('ad'),
        onExchange: () => void this.openBox('duplicates'),
        onEquip: (key) => void this.equipFigurine(key),
      })
    );
  }

  /**
   * Выставить собранную фигурку на поле вместо стандартной. Повторный тап по
   * уже выставленной возвращает силуэту фигурку текущей серии — иначе отменить
   * выбор было бы нечем, а отдельная кнопка «сбросить» на карточке 78 пикселей
   * шириной не помещается.
   */
  private async equipFigurine(key: string): Promise<void> {
    const fig = figurineByKey(key);
    if (!fig) return;

    if (this.profile.equipped(fig.slot) === key) {
      const standard = seasonById(this.profile.seasonId).playable[fig.slot];
      // Стандартная фигурка серии уже стоит — сбрасывать нечего.
      if (standard.key === key) {
        this.toast(t('toast.alreadyInPlay'));
        return;
      }
      this.profile.unequip(fig.slot);
      this.toast(t('toast.asInSeries', { name: figurineName(standard) }));
    } else if (!this.profile.equip(key)) {
      return;
    } else {
      this.toast(t('toast.nowInPlay', { name: figurineName(fig) }));
    }

    this.audio.tap();
    this.species = this.profile.fieldSpecies();
    await this.preloadSpecies();
    this.showCollection();
  }

  /** Растеризовать текущий состав поля. Зовётся на старте и после замены вида. */
  private async preloadSpecies(): Promise<void> {
    await preloadFigurines(
      this.species.map((fig) => ({
        shape: fig.shape,
        colors: fig.colors,
        cacheKey: fig.key,
        options: figurineLook(fig),
      }))
    );
  }

  private async showLeaderboard(): Promise<void> {
    this.audio.tap();
    const [blitz, daily] = await Promise.all([
      this.platform.fetchLeaderboard(LEADERBOARD_BLITZ),
      this.platform.fetchLeaderboard(LEADERBOARD_DAILY),
    ]);
    this.setScreen(
      createLeaderboard({
        onBack: () => void this.showMenu(),
        blitz,
        daily,
      })
    );
  }

  private async showShop(): Promise<void> {
    this.audio.tap();
    const catalog = await this.platform.fetchCatalog();
    this.setScreen(
      createShop(this.profile, catalog, {
        onBack: () => void this.showMenu(),
        onBuy: (id) => void this.buy(id),
        onBuySkin: (id) => void this.buySkinForCoins(id),
        onApplySkin: (id) => void this.applySkin(id),
      })
    );
  }

  private toggleSound(): void {
    const muted = !this.audio.isMuted;
    this.audio.setMuted(muted);
    this.profile.setSetting('muted', muted);
    this.updateHud();
    if (this.session === null) void this.showMenu();
  }

  // --- Блайнд-боксы -------------------------------------------------------

  private async openBox(payment: 'coins' | 'ad' | 'duplicates'): Promise<void> {
    if (payment === 'coins') {
      if (!this.profile.spendCoins(BLIND_BOX_COST)) {
        this.toast(t('toast.noCoins'));
        return;
      }
    } else if (payment === 'duplicates') {
      if (!this.profile.exchangeDuplicates()) {
        this.toast(t('toast.noDuplicates'));
        return;
      }
    } else {
      const rewarded = await this.ads.rewarded('blindBox');
      if (!rewarded) {
        this.toast(t('toast.adNotCounted'));
        return;
      }
    }

    const result = this.profile.openBox();
    // Текстура редкой фигурки могла ещё не растеризоваться — она нужна для
    // экрана коллекции сразу после открытия.
    void figurineTexture({
      shape: result.figurine.shape,
      colors: result.figurine.colors,
      cacheKey: result.figurine.key,
      options: figurineLook(result.figurine),
    });

    this.audio.boxOpen();
    this.haptics.close();
    await showBoxReveal(this.uiRoot, {
      figurine: result.figurine,
      duplicate: result.duplicate,
      duplicates: this.profile.duplicates,
    });

    // Собрана вся серия — финальная награда сезона (план, §5).
    if (this.profile.isSeasonComplete(this.profile.seasonId)) {
      this.profile.addCoins(500);
      this.toast(t('toast.seasonComplete'));
    }
    this.showCollection();
  }

  // --- Покупки ------------------------------------------------------------

  private async buy(productId: string): Promise<void> {
    const token = await this.platform.purchase(productId);
    if (!token) {
      this.toast(t('toast.purchaseFailed'));
      return;
    }
    this.applyPurchase(productId);
    // Расходуемые товары нужно подтверждать, иначе их нельзя купить повторно.
    if (isConsumable(productId)) {
      await this.platform.consume(token);
    }
    await this.showShop();
  }

  /** Скин за внутриигровые монеты. */
  private async buySkinForCoins(id: string): Promise<void> {
    const skin = skinById(id);
    if (skin.coins === null) return;
    if (!this.profile.spendCoins(skin.coins)) {
      this.toast(t('toast.noCoins'));
      return;
    }
    this.profile.unlockSkin(id);
    await this.applySkin(id);
  }

  /**
   * Надеть скин: палитра трогает раму, стекло и акценты, поэтому перекрасить
   * нужно и фон холста, и CSS-переменные интерфейса.
   *
   * Экран НЕ перерисовывается: этот метод зовётся и при выдаче покупки,
   * оплаченной в прошлой сессии, — а это происходит на старте, когда игрок
   * смотрит на меню. Перерисовка магазина оттуда выбрасывала бы его в магазин.
   */
  private setSkin(id: string): void {
    this.profile.setActiveSkin(id);
    this.applyLook();
    this.background.setTheme(this.theme());
  }

  /** Палитра и форма интерфейса по текущему сезону и надетому скину. */
  private applyLook(): void {
    applyThemeVars(this.theme(), skinById(this.profile.activeSkin).ui ?? null);
  }

  /** Надеть скин по нажатию в магазине — с перерисовкой экрана. */
  private async applySkin(id: string): Promise<void> {
    this.setSkin(id);
    this.audio.tap();
    await this.showShop();
  }

  private applyPurchase(productId: string): void {
    switch (productId) {
      case 'hints_10':
        this.profile.addHints(10);
        this.toast(t('toast.hintsAdded'));
        break;
      case 'no_ads':
        this.profile.enableNoAds();
        void this.platform.hideBanner();
        this.toast(t('toast.adsDisabled'));
        break;
      case 'week_pass':
        // Пропуск начисляет награду сразу и далее по календарю входов —
        // серверной части нет, поэтому механика опирается на стрик.
        this.profile.addCoins(300);
        this.profile.addHints(5);
        this.toast(t('toast.passActive'));
        break;
      default:
        if (productId.startsWith('skin_')) {
          this.profile.unlockSkin(productId);
          this.setSkin(productId);
          this.toast(t('toast.skinApplied'));
        }
    }
  }

  /**
   * Незакрытые покупки с прошлого запуска: выдать товар, который уже оплачен.
   *
   * Подтверждаются (consume) только расходуемые товары. У платформы нет
   * отдельного типа «навсегда»: непотреблённая покупка просто продолжает
   * приходить в getPurchases при каждом запуске — именно так и хранится факт
   * владения. Раньше здесь потреблялось всё подряд, и «Убрать рекламу» с
   * купленным скином исчезали из списка покупок навсегда: на новом устройстве
   * или после сброса данных игрок остался бы без того, за что заплатил, и
   * восстановить это было бы уже нечем.
   */
  async redeemPendingPurchases(): Promise<void> {
    const pending = await this.platform.pendingPurchases();
    for (const purchase of pending) {
      this.applyPurchase(purchase.productID);
      if (isConsumable(purchase.productID)) {
        await this.platform.consume(purchase.purchaseToken);
      }
    }
  }

  // --- Запуск режимов -----------------------------------------------------

  /**
   * Гайд перед первой партией. Показывается ровно один раз и именно здесь, а не
   * на старте приложения: до нажатия «играть» игрок ещё не просил объяснений,
   * а после — уже готов слушать. Флаг пишется сразу, чтобы закрытая на середине
   * вкладка не вернула гайд при следующем заходе.
   */
  private async ensureTutorial(): Promise<void> {
    if (this.profile.tutorialSeen) return;
    this.profile.markTutorialSeen();
    await showTutorial(this.uiRoot, this.species);
  }

  /** Тот же гайд по кнопке в меню — для тех, кто его пропустил или забыл. */
  private async showTutorialAgain(): Promise<void> {
    this.audio.tap();
    await showTutorial(this.uiRoot, this.species);
  }

  private async startCampaign(): Promise<void> {
    this.audio.tap();
    await this.ensureTutorial();
    const resume = this.profile.resume;
    if (resume?.mode === 'campaign') {
      const keep = await showConfirm(this.uiRoot, {
        title: t('resume.title'),
        text: t('resume.note'),
        confirm: t('resume.keep'),
        cancel: t('resume.fresh'),
      });
      if (keep) {
        const board = Board.restore(resume.board);
        this.beginSession({
          mode: 'campaign',
          spec: {
            id: resume.levelId,
            seed: 0,
            shelves: resume.board.shelves,
            capacity: resume.board.capacity,
            speciesCount: resume.board.speciesCount,
            minMoves: resume.minMoves,
          },
          board,
          levelNumber: this.profile.campaignLevel,
          usedHint: resume.usedHint,
        });
        return;
      }
    }
    this.startCampaignLevel(this.profile.campaignLevel);
  }

  private startCampaignLevel(levelNumber: number): void {
    const spec = campaignLevel(levelNumber);
    this.beginSession({
      mode: 'campaign',
      spec,
      board: new Board(spec),
      levelNumber,
      usedHint: false,
    });
  }

  private async startBlitz(): Promise<void> {
    this.audio.tap();
    await this.ensureTutorial();
    if (!this.profile.consumeBlitzAttempt()) {
      const watch = await showConfirm(this.uiRoot, {
        title: t('blitz.noAttempts'),
        text: t('blitz.noAttemptsNote'),
        confirm: t('blitz.watchAd'),
      });
      if (!watch) return;
      const rewarded = await this.ads.rewarded('blitzRetry');
      if (!rewarded) {
        this.toast(t('toast.adNotCounted'));
        return;
      }
      this.profile.grantBlitzAttempt();
      this.profile.consumeBlitzAttempt();
    }
    const spec = blitzLevel(0);
    this.beginSession({
      mode: 'blitz',
      spec,
      board: new Board(spec),
      levelNumber: 0,
      usedHint: false,
    });
  }

  private async startDaily(): Promise<void> {
    this.audio.tap();
    await this.ensureTutorial();
    const spec = dailyLevel();
    this.beginSession({
      mode: 'daily',
      spec,
      board: new Board(spec),
      levelNumber: 0,
      usedHint: false,
    });
  }

  // --- Сессия -------------------------------------------------------------

  private beginSession(opts: {
    mode: GameMode;
    spec: LevelSpec;
    board: Board;
    levelNumber: number;
    usedHint: boolean;
  }): void {
    this.teardownSession();
    this.setScreen(null);

    const view = new BoardView({
      board: opts.board,
      species: this.species,
      theme: this.theme(),
      shelfStyle: skinById(this.profile.activeSkin).shelf,
      tweens: this.tweens,
      particles: this.particles,
      rings: this.rings,
      popups: this.popups,
      callbacks: {
        onLift: () => {
          this.audio.lift();
          this.noteInput();
        },
        onPlace: () => {
          this.haptics.place();
          this.noteInput();
        },
        onReject: () => {
          this.audio.reject();
          this.haptics.reject();
          this.noteInput();
        },
        onMove: () => this.persistResume(),
        onClose: (shelf, _species, combo) => {
          // Витрина закрылась — значит заполнена целиком: верхняя нота гаммы.
          this.audio.place(1);
          this.audio.glassClose();
          this.haptics.close();
          this.shake.fire(5);
          this.onSetClosed(combo, shelf);
        },
        onCombo: (length, color) => {
          this.audio.combo(length);
          this.haptics.combo();
          this.comboFlash.fire(window.innerWidth, window.innerHeight, color);
          this.shake.fire(9);
          this.hud?.toast(`Комбо ×${length}`);
        },
        onSolved: () => void this.onLevelSolved(),
        onDeadlock: () => void this.onDeadlock(),
      },
    });

    this.session = {
      mode: opts.mode,
      spec: opts.spec,
      board: opts.board,
      view,
      levelNumber: opts.levelNumber,
      usedHint: opts.usedHint,
      doubledCoins: false,
      deadline: opts.mode === 'blitz' ? Date.now() + BLITZ_DURATION * 1000 : 0,
      timeLeft: opts.mode === 'blitz' ? BLITZ_DURATION : 0,
      score: 0,
      setsClosed: 0,
      step: 0,
      sawRewarded: false,
    };

    this.stage.addChildAt(view, 1);
    view.refreshTextures();

    this.hud = new Hud({
      onBack: () => void this.onBack(),
      onHint: () => void this.useHint(),
      onUndo: () => void this.useUndo(),
      onExtraShelf: () => void this.useExtraShelf(),
      onToggleSound: () => this.toggleSound(),
    });
    this.uiRoot.appendChild(this.hud.root);

    // Сначала HUD, потом раскладка: раскладка измеряет строки HUD, а в
    // соревновательных режимах часть кнопок скрывается именно в update().
    // В обратном порядке поле в блице получало границы от кнопок, которых нет.
    this.updateHud();
    this.layoutBoard();
    this.noteInput();
    this.platform.gameplayStart();
  }

  private teardownSession(): void {
    if (this.session) {
      this.stage.removeChild(this.session.view);
      this.session.view.destroy({ children: true });
      this.session = null;
    }
    this.hud?.destroy();
    this.hud = null;
    this.tweens.clear();
    this.particles.clear();
    this.rings.clear();
    this.popups.clear();
  }

  private noteInput(): void {
    this.lastInputAt = Date.now();
    this.idleHintShown = false;
  }

  /** Сохранить незаконченную партию — но не в блице, он не восстанавливается. */
  private persistResume(): void {
    const session = this.session;
    if (!session || session.mode === 'blitz') return;
    this.profile.saveResume({
      mode: session.mode,
      levelId: session.spec.id,
      minMoves: session.spec.minMoves,
      board: session.board.serialize(),
      usedHint: session.usedHint,
    });
  }

  /** `combo` — длина текущей серии закрытий, её считает BoardView. */
  private onSetClosed(combo: number, shelfIndex: number): void {
    const session = this.session;
    if (!session) return;
    session.setsClosed += 1;
    if (session.mode !== 'blitz') return;

    // +2 секунды за каждый закрытый сет (план, §4).
    const before = session.deadline;
    session.deadline = Math.min(
      Date.now() + BLITZ_DURATION * 1000,
      session.deadline + BLITZ_TIME_BONUS * 1000
    );
    // Очки растут с длиной серии: забег получает кривую напряжения, а не
    // линейное накопление. Раньше здесь всегда стояла единица, и вся
    // комбо-математика из scoring.ts просто не работала.
    const points = blitzSetPoints(combo);
    session.score += points;

    // Обе прибавки показываются там, где начисляются: очки и время — единственные
    // две величины, ради которых игрок в блице вообще торопится, и молча
    // менять их в углу экрана значит не отдавать награду.
    const seconds = Math.round((session.deadline - before) / 1000);
    this.hud?.popScore(points);
    this.hud?.popTime(seconds);
    if (seconds > 0) session.view.popup(shelfIndex, `+${seconds} с`, '#ffd23f');
  }

  // --- Инструменты --------------------------------------------------------

  private async useHint(): Promise<void> {
    const session = this.session;
    if (!session || session.view.isBusy || this.ads.isBusy) return;
    this.noteInput();

    if (this.profile.hints > 0) {
      this.profile.useHint();
    } else if (isCompetitive(session.mode)) {
      // Добрать подсказку роликом здесь нельзя: результат идёт в общую
      // таблицу, а подсказка — это ход от солвера.
      this.toast('Подсказки закончились');
      return;
    } else {
      const rewarded = await this.ads.rewarded('hint');
      if (!rewarded) {
        this.toast('Ролик не засчитан');
        return;
      }
    }

    const hint = findHint(session.board);
    if (!hint) {
      this.toast(session.board.isDeadlock ? t('toast.noMoves') : t('toast.alreadySolved'));
      // Подсказку не нашли — заряд возвращаем: списывать за пустой ответ нечестно.
      this.profile.addHints(1);
      return;
    }
    session.usedHint = true;
    this.audio.tap();
    await session.view.showHint(hint.from, hint.to);
  }

  private async useUndo(): Promise<void> {
    const session = this.session;
    if (!session || !session.board.canUndo || session.view.isBusy || this.ads.isBusy) return;
    // Отмена уменьшает счётчик ходов — именно по нему ранжируется вызов дня.
    if (isCompetitive(session.mode)) return;
    this.noteInput();
    const rewarded = await this.ads.rewarded('undo');
    if (!rewarded) {
      this.toast(t('toast.adNotCounted'));
      return;
    }
    session.sawRewarded = true;
    await session.view.undo();
    this.persistResume();
    this.updateHud();
  }

  private async useExtraShelf(): Promise<void> {
    const session = this.session;
    if (!session || session.view.isBusy || this.ads.isBusy) return;
    // Свободная витрина решает уровень за игрока — в лидербордных режимах её
    // нет ни кнопкой, ни из тупика.
    if (isCompetitive(session.mode)) return;
    this.noteInput();
    const rewarded = await this.ads.rewarded('extraShelf');
    if (!rewarded) {
      this.toast(t('toast.adNotCounted'));
      return;
    }
    session.sawRewarded = true;
    await session.view.grantExtraShelf();
    this.layoutBoard();
    this.persistResume();
    this.updateHud();
  }

  // --- Исходы -------------------------------------------------------------

  private async onDeadlock(): Promise<void> {
    const session = this.session;
    if (!session) return;
    // В блице тупик не блокирует забег: просто выдаём следующий уровень,
    // иначе один неудачный расклад съедал бы всю попытку.
    if (session.mode === 'blitz') {
      this.nextBlitzLevel();
      return;
    }

    this.platform.gameplayStop();
    const choice = await showDeadlock(this.uiRoot, {
      canExtraShelf: !isCompetitive(session.mode),
    });
    if (choice === 'extraShelf') {
      const rewarded = await this.ads.rewarded('extraShelf');
      if (rewarded) {
        session.sawRewarded = true;
        await session.view.grantExtraShelf();
        this.layoutBoard();
        this.platform.gameplayStart();
        this.persistResume();
        return;
      }
      this.toast(t('toast.adNotCounted'));
      // Ролик не засчитан — даём витрину всё равно: тупик не должен стать
      // непроходимой стеной из-за проблем с сетью.
      await session.view.grantExtraShelf();
      this.layoutBoard();
      this.platform.gameplayStart();
      return;
    }
    if (choice === 'restart') {
      this.restartLevel();
      return;
    }
    this.profile.saveResume(null);
    await this.showMenu();
  }

  private restartLevel(): void {
    const session = this.session;
    if (!session) return;
    if (session.mode === 'campaign') this.startCampaignLevel(session.levelNumber);
    else if (session.mode === 'daily') void this.startDaily();
    else void this.startBlitz();
  }

  private async onLevelSolved(): Promise<void> {
    const session = this.session;
    if (!session) return;

    this.audio.win();

    if (session.mode === 'blitz') {
      this.nextBlitzLevel();
      return;
    }

    this.platform.gameplayStop();
    const result = rateLevel(session.spec.minMoves, session.board.moves, session.usedHint);
    this.profile.addCoins(result.coins);
    this.audio.coin();

    if (session.mode === 'campaign') {
      this.profile.completeCampaignLevel(session.levelNumber, result.stars);
      await this.campaignVictory(session, result.stars, result.coins);
    } else {
      const isRecord = this.profile.completeDaily(session.board.moves);
      await this.platform.submitScore(LEADERBOARD_DAILY, session.board.moves);
      const choice = await showDailyResult(this.uiRoot, {
        moves: session.board.moves,
        best: this.profile.dailyBestMoves,
        isRecord,
        coins: result.coins,
      });
      if (choice === 'leaderboard') await this.showLeaderboard();
      else await this.showMenu();
    }
  }

  private async campaignVictory(session: Session, stars: number, coins: number): Promise<void> {
    let awarded = coins;
    for (;;) {
      const choice = await showVictory(this.uiRoot, {
        title: t('victory.title'),
        stars,
        coins: awarded,
        moves: session.board.moves,
        minMoves: session.spec.minMoves,
        canDouble: !session.doubledCoins,
        nextLabel: t('victory.next'),
      });

      if (choice === 'double') {
        const rewarded = await this.ads.rewarded('doubleCoins');
        if (rewarded) {
          this.profile.addCoins(coins);
          awarded = coins * 2;
          session.doubledCoins = true;
          session.sawRewarded = true;
          this.audio.coin();
        } else {
          this.toast(t('toast.adNotCounted'));
          session.doubledCoins = true;
        }
        continue;
      }

      if (choice === 'collection') {
        this.teardownSession();
        this.showCollection();
        return;
      }
      if (choice === 'menu') {
        await this.showMenu();
        return;
      }

      // «Следующая витрина» — вот здесь и только здесь фулскрин.
      const next = session.levelNumber + 1;
      const skipAd = session.sawRewarded || this.profile.noAds;
      this.teardownSession();
      if (!skipAd) await this.ads.interstitial();
      this.startCampaignLevel(next);
      return;
    }
  }

  private nextBlitzLevel(): void {
    const session = this.session;
    if (!session) return;
    session.step += 1;
    const spec = blitzLevel(session.step);
    const board = new Board(spec);
    const view = new BoardView({
      board,
      species: this.species,
      theme: this.theme(),
      shelfStyle: skinById(this.profile.activeSkin).shelf,
      tweens: this.tweens,
      particles: this.particles,
      rings: this.rings,
      popups: this.popups,
      callbacks: {
        onLift: () => this.audio.lift(),
        onPlace: () => this.haptics.place(),
        onReject: () => {
          this.audio.reject();
          this.haptics.reject();
        },
        onClose: (shelf, _species, combo) => {
          this.audio.glassClose();
          this.haptics.close();
          this.shake.fire(5);
          this.onSetClosed(combo, shelf);
        },
        onCombo: (length, color) => {
          this.audio.combo(length);
          this.comboFlash.fire(window.innerWidth, window.innerHeight, color);
          this.shake.fire(9);
        },
        onSolved: () => void this.onLevelSolved(),
        onDeadlock: () => void this.onDeadlock(),
      },
    });

    // Твины прошлого уровня обязательно сбросить ДО уничтожения поля: иначе
    // они продолжат дёргать разрушенные спрайты.
    this.tweens.clear();
    this.stage.removeChild(session.view);
    session.view.destroy({ children: true });
    session.spec = spec;
    session.board = board;
    session.view = view;
    this.stage.addChildAt(view, 1);
    view.refreshTextures();
    this.layoutBoard();
  }

  private async finishBlitz(): Promise<void> {
    const session = this.session;
    if (!session) return;
    this.platform.gameplayStop();
    const score = session.score;
    const sets = session.setsClosed;
    const isRecord = this.profile.recordBlitz(score);
    // Монеты за забег — иначе блиц не кормит мету и остаётся тупиковым режимом.
    this.profile.addCoins(Math.round(score / 40));
    await this.platform.submitScore(LEADERBOARD_BLITZ, score);
    // Место запрашивается ПОСЛЕ отправки очков, иначе покажем позицию до забега.
    const rank = await this.platform.fetchPlayerRank(LEADERBOARD_BLITZ);

    const trophy = this.bestTrophy();
    this.teardownSession();

    for (;;) {
      const choice = await showBlitzResult(this.uiRoot, {
        score,
        best: this.profile.blitzBest,
        isRecord,
        sets,
        ...(trophy ? { trophy } : {}),
        rank,
        freeAttempts: this.profile.blitzAttempts,
        refillIn: this.profile.blitzRefillIn,
      });

      if (choice === 'share') {
        const text =
          t('blitz.shareText', { brand: brand(), score, sets }) +
          (rank !== null ? t('blitz.shareRank', { rank }) : '') +
          t('blitz.shareCall');
        const ok = await this.platform.copyText(text);
        this.toast(ok ? t('toast.copied') : t('toast.copyFailed'));
        continue;
      }
      if (choice === 'retry') {
        await this.startBlitz();
        return;
      }
      if (choice === 'retryAd') {
        const rewarded = await this.ads.rewarded('blitzRetry');
        if (!rewarded) {
          this.toast(t('toast.adNotCounted'));
          continue;
        }
        this.profile.grantBlitzAttempt();
        await this.startBlitz();
        return;
      }
      if (choice === 'leaderboard') {
        await this.showLeaderboard();
        return;
      }
      await this.showMenu();
      return;
    }
  }

  /** Самая редкая собранная фигурка — для карточки результата. */
  private bestTrophy(): FigurineDef | undefined {
    const season = seasonById(this.profile.seasonId);
    const order = { legendary: 0, rare: 1, common: 2 } as const;
    return season.figurines
      .filter((f) => this.profile.has(f.key))
      .sort((a, b) => order[a.rarity] - order[b.rarity])[0];
  }

  private async onBack(): Promise<void> {
    const session = this.session;
    if (!session) {
      await this.showMenu();
      return;
    }
    this.platform.gameplayStop();
    const choice = await showPause(this.uiRoot);
    if (choice === 'resume') {
      this.platform.gameplayStart();
      this.noteInput();
      return;
    }
    if (choice === 'restart') {
      this.restartLevel();
      return;
    }
    await this.showMenu();
  }

  // --- Пауза платформы ----------------------------------------------------

  private onPlatformPause(): void {
    if (this.paused) return;
    this.paused = true;
    this.pausedAt = Date.now();
    this.audio.setDucked(true);
    this.platform.gameplayStop();
    void this.profile.flush();
  }

  private onPlatformResume(): void {
    if (!this.paused) return;
    // Забег продлевается на всё время паузы: игрок не должен терять секунды,
    // пока смотрит рекламу или свернул вкладку.
    if (this.session && this.pausedAt > 0) {
      this.session.deadline += Date.now() - this.pausedAt;
    }
    this.pausedAt = 0;
    this.paused = false;
    this.audio.setDucked(false);
    this.noteInput();
    if (this.session) this.platform.gameplayStart();
  }

  // --- Отладочный доступ --------------------------------------------------

  /**
   * Минимальная поверхность для смоук-тестов (store/smoke.mjs).
   *
   * Автопрохождение идёт через тот же `BoardView.tap`, что и палец игрока, —
   * то есть тест проверяет настоящий путь ввода вместе с анимациями, а не
   * обходит его. Без этого самые важные сценарии (победа → фулскрин → следующий
   * уровень, итог блица) остались бы непроверенными: вручную их не прогнать, а
   * ошибки в них стоят дороже всего остального.
   */
  private exposeDebugApi(): void {
    (window as unknown as { __drop?: unknown }).__drop = {
      /** Досортировать текущий уровень по подсказкам солвера. */
      autoSolve: async (limit = 120): Promise<boolean> => {
        for (let i = 0; i < limit; i++) {
          const session = this.session;
          if (!session) return false;
          if (session.board.isSolved) return true;
          const hint = findHint(session.board);
          if (!hint) return false;
          // view читается заново на каждом шаге: в блице уровень сменяется
          // прямо посреди прохождения, и поле подменяется целиком.
          const view = session.view;
          if (view.destroyed) continue;
          await view.tap(hint.from);
          if (view.destroyed) continue;
          await view.tap(hint.to);
        }
        return this.session?.board.isSolved ?? false;
      },
      /** Оборвать таймер блица, чтобы не ждать 60 секунд. */
      endBlitzNow: (): void => {
        if (this.session?.mode === 'blitz') this.session.deadline = Date.now();
      },
      /** Экранные центры витрин — чтобы тест тапал по реальной раскладке. */
      shelfPoints: (): Array<{ x: number; y: number }> => this.session?.view.shelfPoints() ?? [],
      state: () => ({
        mode: this.session?.mode ?? null,
        moves: this.session?.board.moves ?? 0,
        closed: this.session?.board.closedCount ?? 0,
        solved: this.session?.board.isSolved ?? false,
        timeLeft: this.session?.timeLeft ?? 0,
        coins: this.profile.coins,
        level: this.profile.campaignLevel,
        stars: this.profile.totalStars,
        adStats: this.ads.stats,
      }),
    };
  }

  private toast(message: string): void {
    if (this.hud) {
      this.hud.toast(message);
      return;
    }
    // Вне игровой сессии HUD не существует — показываем сообщение сами.
    const node = el('div', 'toast', { text: message });
    this.uiRoot.appendChild(node);
    requestAnimationFrame(() => node.classList.add('is-open'));
    setTimeout(() => {
      node.classList.remove('is-open');
      setTimeout(() => node.remove(), 240);
    }, 2200);
  }
}
