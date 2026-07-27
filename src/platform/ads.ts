/**
 * Рекламная политика.
 *
 * Весь смысл этого файла — держать рекламу подальше от активного геймплея.
 * Случайные клики Рекламная сеть Яндекса трактует как фрод и режет доход по
 * всей игре целиком (план, §8), поэтому здесь единственная точка, через
 * которую вообще можно позвать рекламу, и она сама:
 *
 *  * останавливает геймплей через GameplayAPI и глушит звук;
 *  * показывает плашку «Реклама через 3, 2, 1» перед фулскрином, чтобы палец
 *    игрока успел уйти с экрана;
 *  * возвращает управление только после явного закрытия ролика;
 *  * считает показы для метрик из плана (§10): rewarded на сессию и доля
 *    сессий хотя бы с одним rewarded.
 *
 * ── Про частоту фулскринов ────────────────────────────────────────────────
 * Площадка действительно ограничивает интервал между фулскринами (по
 * умолчанию 60 секунд, настраивается в консоли) и просто не покажет ролик,
 * если позвать раньше: `onClose` придёт с `wasShown = false`. То есть лишние
 * вызовы дохода не приносят и не отнимают.
 *
 * Но полагаться на это одно оказалось нельзя. Уровень в бесконечной ленте
 * проходится секунд за пятнадцать, и на КАЖДОМ переходе игрок видел плашку
 * «Реклама через 3, 2, 1», три секунды ждал — а ролика не было, потому что
 * площадка его отклоняла. Три потерянные секунды и обманутое ожидание на
 * каждом уровне, причём без единого показа. В локальной сборке, где заглушка
 * ничего не ограничивает, было хуже: реклама шла буквально каждый уровень.
 *
 * Поэтому интервал держим и на своей стороне: с запасом к лимиту площадки и
 * дополнительно не чаще, чем раз в несколько уровней. Если показывать рано,
 * отсчёт вообще не запускается — переход к следующему уровню мгновенный.
 */

import type { Platform } from './sdk';
import type { Audio } from './audio';
import { t } from '../i18n';

/** Поводы для rewarded из плана (§8). */
export type RewardedPlacement =
  | 'extraShelf'
  | 'undo'
  | 'hint'
  | 'doubleCoins'
  | 'blindBox'
  | 'blitzRetry';


export interface AdStats {
  interstitialsShown: number;
  rewardedShown: number;
  rewardedByPlacement: Partial<Record<RewardedPlacement, number>>;
}

const COUNTDOWN_MS = 1000;

/**
 * Свой интервал между фулскринами. Заметно больше лимита площадки (60 секунд
 * по умолчанию): вызов ровно на границе почти всегда упирался бы в её счётчик,
 * и игрок получал бы отсчёт впустую. Запас снимает эту гонку.
 */
const INTERSTITIAL_COOLDOWN_MS = 100_000;

/**
 * И не чаще, чем раз в столько переходов между уровнями. Одного таймера мало:
 * на длинном уровне минуты набегают сами, и реклама снова оказалась бы на
 * каждом переходе.
 */
const INTERSTITIAL_MIN_TRANSITIONS = 3;

export class Ads {
  private readonly platform: Platform;
  private readonly audio: Audio;
  private overlay: HTMLDivElement | null = null;
  private busy = false;
  /** Шёл ли геймплей перед роликом — его и возобновляем после. */
  private resumeGameplay = false;

  /**
   * Когда последний раз показывали полноэкранную рекламу. Отсчёт стартует с
   * запуска игры, поэтому первые полторы минуты сессии проходят без фулскрина:
   * знакомство с игрой не должно начинаться с рекламы.
   */
  private lastInterstitialAt = Date.now();
  private transitionsSinceInterstitial = 0;

  readonly stats: AdStats = {
    interstitialsShown: 0,
    rewardedShown: 0,
    rewardedByPlacement: {},
  };

  constructor(platform: Platform, audio: Audio) {
    this.platform = platform;
    this.audio = audio;
  }

  /** Идёт показ рекламы — интерфейс должен игнорировать ввод. */
  get isBusy(): boolean {
    return this.busy;
  }

  /**
   * Фулскрин между уровнями. Единственное место вызова — экран «Витрина
   * закрыта», и только оно (план, §8).
   *
   * Возвращает true, если ролик действительно был показан: по этому флагу
   * экран победы решает, нужно ли ему заново запросить внимание игрока.
   */
  async interstitial(): Promise<boolean> {
    if (this.busy) return false;

    this.transitionsSinceInterstitial += 1;
    if (!this.interstitialAllowed()) {
      // Молча и мгновенно: ни отсчёта, ни паузы. Игрок просто переходит
      // на следующий уровень.
      return false;
    }

    this.busy = true;
    try {
      await this.showCountdown(t('ads.countdown'));
      this.beforeAd();
      const { wasShown } = await this.platform.showInterstitial();
      if (wasShown) this.stats.interstitialsShown += 1;
      // Отсчёт сбрасывается независимо от того, показала площадка ролик или
      // отклонила: попытка уже стоила игроку трёх секунд ожидания, и повторять
      // её на следующем же переходе — худшее, что можно сделать.
      this.noteAdShown();
      return wasShown;
    } finally {
      this.hideOverlay();
      this.afterAd();
      this.busy = false;
    }
  }

  private interstitialAllowed(): boolean {
    if (this.transitionsSinceInterstitial < INTERSTITIAL_MIN_TRANSITIONS) return false;
    return Date.now() - this.lastInterstitialAt >= INTERSTITIAL_COOLDOWN_MS;
  }

  private noteAdShown(): void {
    this.lastInterstitialAt = Date.now();
    this.transitionsSinceInterstitial = 0;
  }

  /** Сколько секунд осталось до следующего допустимого фулскрина — для отладки. */
  get interstitialCooldownLeft(): number {
    return Math.max(0, INTERSTITIAL_COOLDOWN_MS - (Date.now() - this.lastInterstitialAt)) / 1000;
  }

  /**
   * Разрешить фулскрин прямо сейчас. Только для смоук-теста: без этого проверить
   * показ рекламы можно было бы, лишь прождав интервал в реальном времени.
   */
  debugAllowInterstitial(): void {
    this.lastInterstitialAt = 0;
    this.transitionsSinceInterstitial = INTERSTITIAL_MIN_TRANSITIONS;
  }

  /**
   * Реклама за вознаграждение. Награда выдаётся только при rewarded=true —
   * решение принимает SDK по событию onRewarded, а не мы.
   *
   * Перед rewarded плашки с обратным отсчётом нет: игрок сам нажал кнопку
   * «смотреть», он к ролику готов, и лишний экран только раздражает.
   */
  async rewarded(placement: RewardedPlacement): Promise<boolean> {
    if (this.busy) return false;
    this.busy = true;
    try {
      this.beforeAd();
      const { rewarded } = await this.platform.showRewarded();
      if (rewarded) {
        this.stats.rewardedShown += 1;
        this.stats.rewardedByPlacement[placement] =
          (this.stats.rewardedByPlacement[placement] ?? 0) + 1;
      }
      // Ролик за награду тоже отодвигает фулскрин. Площадка их не смешивает —
      // это ограничение ради игрока: два ролика подряд ощущаются как один
      // сплошной рекламный блок, даже если первый он включил сам.
      this.noteAdShown();
      return rewarded;
    } finally {
      this.afterAd();
      this.busy = false;
    }
  }

  /** Sticky-баннер на всю сессию (план, §8). */
  async showSticky(): Promise<void> {
    await this.platform.showBanner();
  }

  private beforeAd(): void {
    // Порядок важен: сначала сказать платформе, что геймплей встал, потом
    // глушить звук. Иначе на части устройств слышен хвост игрового звука
    // поверх первых кадров ролика.
    this.resumeGameplay = this.platform.isGameplayRunning;
    this.platform.gameplayStop();
    this.audio.setDucked(true);
  }

  /**
   * После ролика возобновляем ровно то, что он прервал.
   *
   * Раньше здесь не было ничего, а start() оставался на совести экрана — и
   * три места его не звали: подсказка, отмена хода и свободная витрина за
   * ролик берутся посреди живого уровня, игрок возвращается в ту же партию, а
   * платформа до конца уровня считала геймплей остановленным. Документация
   * прямо называет возобновление после рекламы случаем для GameplayAPI.start().
   *
   * Запоминание «шёл ли геймплей ДО ролика» решает и обратную задачу: после
   * фулскрина на переходе и после ×2 на экране победы геймплея не было, и
   * ложный start туда не попадёт.
   */
  private afterAd(): void {
    this.audio.setDucked(false);
    if (this.resumeGameplay) {
      this.resumeGameplay = false;
      this.platform.gameplayStart();
    }
  }

  /** Плашка обратного отсчёта: даёт игроку убрать палец с экрана. */
  private showCountdown(label: string): Promise<void> {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'ad-countdown';
      overlay.innerHTML = `<div class="ad-countdown__box">
        <span class="ad-countdown__label">${label}</span>
        <b class="ad-countdown__num">3</b>
      </div>`;
      document.body.appendChild(overlay);
      this.overlay = overlay;
      const num = overlay.querySelector('.ad-countdown__num') as HTMLElement;

      let left = 3;
      const step = () => {
        left -= 1;
        if (left <= 0) {
          resolve();
          return;
        }
        num.textContent = String(left);
        // Перезапуск анимации счётчика: без снятия класса она не повторяется.
        num.classList.remove('is-pulse');
        void num.offsetWidth;
        num.classList.add('is-pulse');
        setTimeout(step, COUNTDOWN_MS);
      };
      setTimeout(step, COUNTDOWN_MS);
    });
  }

  private hideOverlay(): void {
    this.overlay?.remove();
    this.overlay = null;
  }
}
