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
 * Частоту фулскринов регулирует платформа. Мы зовём их на каждом переходе
 * между уровнями и читаем фактический результат из onClose — лишнее
 * платформа отфильтрует сама, а угадывать её лимиты за неё вредно.
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

export class Ads {
  private readonly platform: Platform;
  private readonly audio: Audio;
  private overlay: HTMLDivElement | null = null;
  private busy = false;

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
    this.busy = true;
    try {
      await this.showCountdown(t('ads.countdown'));
      this.beforeAd();
      const { wasShown } = await this.platform.showInterstitial();
      if (wasShown) this.stats.interstitialsShown += 1;
      return wasShown;
    } finally {
      this.hideOverlay();
      this.afterAd();
      this.busy = false;
    }
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
    this.platform.gameplayStop();
    this.audio.setDucked(true);
  }

  private afterAd(): void {
    this.audio.setDucked(false);
    // GameplayAPI.start намеренно НЕ зовём: геймплей возобновляет экран, а не
    // рекламный слой. После фулскрина игрок попадает на экран результата, где
    // геймплея нет, и ложный start исказил бы платформенную статистику.
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
