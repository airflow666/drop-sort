/**
 * Минимальный твин-движок.
 *
 * Готовая библиотека анимаций (GSAP и подобные) — это 30–70 КБ в бандле при
 * бюджете старта 5 секунд, а нужна здесь ровно одна возможность: гнать
 * числовое значение по кривой и дёргать колбэк. Всё «ощущение» жанра
 * (см. план, §3) строится на четырёх кривых ниже, поэтому они и вынесены
 * отдельно с объяснением, за что каждая отвечает.
 */

export type Easing = (t: number) => number;

/** Плавно с обоих концов. Основа для всего, где нет удара. */
export const easeInOut: Easing = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

/** Быстрый старт, мягкое торможение. Подъём фигурки. */
export const easeOut: Easing = (t) => 1 - Math.pow(1 - t, 3);

/** Медленный старт, разгон. Падение фигурки в витрину. */
export const easeIn: Easing = (t) => t * t * t;

/**
 * Перелёт с возвратом — «магнит» при укладке фигурки. Именно эта кривая
 * даёт ощущение, что фигурка защёлкнулась в паз, а не приехала в точку.
 */
export const easeBack: Easing = (t) => {
  const c = 1.70158 + 1;
  return 1 + c * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2);
};

/** Затухающие колебания — отдача закрывшейся витрины. */
export const easeElastic: Easing = (t) => {
  if (t === 0 || t === 1) return t;
  return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
};

/** Подпрыгивание — приземление фигурки из блайнд-бокса. */
export const easeBounce: Easing = (t) => {
  const n = 7.5625;
  const d = 2.75;
  if (t < 1 / d) return n * t * t;
  if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
  if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
  return n * (t -= 2.625 / d) * t + 0.984375;
};

interface TweenEntry {
  elapsed: number;
  duration: number;
  delay: number;
  ease: Easing;
  onUpdate: (t: number) => void;
  onComplete?: () => void;
  /**
   * Резолв промиса твина хранится отдельно от onComplete: при отмене нужно
   * разбудить того, кто ждёт твин, НЕ выполняя onComplete (иначе анимация
   * доигралась бы в состоянии, которое уже сменилось).
   */
  settle: () => void;
  cancelled: boolean;
}

/**
 * Планировщик твинов. Один экземпляр на игру, шагается из тикера Pixi —
 * так анимации автоматически замирают вместе с игрой на рекламе и при
 * сворачивании вкладки, а не продолжают идти в фоне.
 */
export class Tweens {
  private entries: TweenEntry[] = [];

  /**
   * Возвращает промис завершения — удобно для последовательностей.
   *
   * Промис резолвится и при отмене твина. Это важно: почти вся анимация ходов
   * выстроена как цепочка `await`, и невозвращённый промис навсегда оставил бы
   * поле в состоянии «идёт анимация» — то есть игра просто перестала бы
   * реагировать на тапы.
   */
  add(opts: {
    duration: number;
    ease?: Easing;
    delay?: number;
    onUpdate: (t: number) => void;
    onComplete?: () => void;
  }): Promise<void> {
    return new Promise((resolve) => {
      let settled = false;
      const settle = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      this.entries.push({
        elapsed: 0,
        duration: Math.max(1, opts.duration),
        delay: opts.delay ?? 0,
        ease: opts.ease ?? easeInOut,
        onUpdate: opts.onUpdate,
        cancelled: false,
        settle,
        ...(opts.onComplete ? { onComplete: opts.onComplete } : {}),
      });
    });
  }

  /** Пауза на заданное время, прерываемая вместе с остальными твинами. */
  wait(ms: number): Promise<void> {
    return this.add({ duration: ms, onUpdate: () => {} });
  }

  /** deltaMs — реальное время кадра. */
  update(deltaMs: number): void {
    if (this.entries.length === 0) return;
    // Идём по копии: onComplete может добавить новые твины.
    const list = this.entries;
    this.entries = [];
    for (const entry of list) {
      if (entry.cancelled) {
        entry.settle();
        continue;
      }
      if (entry.delay > 0) {
        entry.delay -= deltaMs;
        this.entries.push(entry);
        continue;
      }
      entry.elapsed += deltaMs;
      const raw = Math.min(1, entry.elapsed / entry.duration);
      entry.onUpdate(entry.ease(raw));
      if (raw < 1) {
        this.entries.push(entry);
      } else {
        entry.onComplete?.();
        entry.settle();
      }
    }
  }

  /**
   * Сбросить все твины. Вызывается при смене экрана и уровня: недоигранная
   * анимация прошлого уровня, дотянувшая до нового, выглядит как баг.
   *
   * Ожидающие промисы обязательно резолвятся. Пока они просто помечались
   * отменёнными, любой `await this.tweens.add(...)` в цепочке анимации хода
   * зависал навсегда, и вместе с ним — флаг «идёт анимация»: поле переставало
   * принимать тапы до перезагрузки. В блице, где уровень сменяется прямо
   * посреди анимации, это происходило гарантированно.
   */
  clear(): void {
    const list = this.entries;
    this.entries = [];
    for (const entry of list) {
      entry.cancelled = true;
      entry.settle();
    }
  }

  get active(): number {
    return this.entries.length;
  }
}
