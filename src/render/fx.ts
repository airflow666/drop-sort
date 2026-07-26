/**
 * Эффекты обратной связи: частицы, вспышка комбо, тряска экрана.
 *
 * План (§3) прямо говорит: экономить можно на числе видов фигурок, но не на
 * ощущениях — в этом жанре выигрывают именно тактильностью. Всё здесь
 * привязано к событиям правил (закрылась витрина, сложилось комбо), а не к
 * таймерам, иначе эффект перестаёт быть наградой и становится шумом.
 *
 * Частицы пулятся: закрытие витрины рождает до 28 частиц, за уровень таких
 * событий до восьми, и создавать Graphics заново на каждое — гарантированные
 * подёргивания сборщика мусора на слабом Android.
 */

import { Container, Graphics } from 'pixi.js';
import { toNumber } from '../theme/color';

interface Particle {
  gfx: Graphics;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  spin: number;
  size: number;
}

const GRAVITY = 0.0011;
const POOL_LIMIT = 120;

export class Particles extends Container {
  private readonly pool: Graphics[] = [];
  private readonly active: Particle[] = [];

  constructor() {
    super();
    this.eventMode = 'none';
  }

  private take(): Graphics {
    const reused = this.pool.pop();
    if (reused) {
      reused.visible = true;
      return reused;
    }
    const gfx = new Graphics();
    gfx.eventMode = 'none';
    this.addChild(gfx);
    return gfx;
  }

  private give(gfx: Graphics): void {
    gfx.visible = false;
    gfx.clear();
    if (this.pool.length < POOL_LIMIT) this.pool.push(gfx);
    else {
      this.removeChild(gfx);
      gfx.destroy();
    }
  }

  /**
   * Салют из закрывшейся витрины. Частицы окрашены в цвет собранного вида —
   * связь «что именно я собрал» держится цветом, а не текстом.
   */
  burst(x: number, y: number, colors: string[], count = 24): void {
    for (let i = 0; i < count; i++) {
      const gfx = this.take();
      const color = toNumber(colors[i % colors.length]);
      const size = 2.5 + Math.random() * 4;
      // Половина частиц — квадратики, половина — круги: смесь форм читается
      // как конфетти, а однородные точки — как технический эффект.
      gfx.clear();
      if (i % 2 === 0) gfx.rect(-size, -size, size * 2, size * 2).fill(color);
      else gfx.circle(0, 0, size).fill(color);
      gfx.position.set(x, y);
      gfx.alpha = 1;

      // Конус вверх: витрина «выстреливает» содержимым, а не рассыпает его.
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.9;
      const speed = 0.18 + Math.random() * 0.36;
      this.active.push({
        gfx,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0,
        maxLife: 620 + Math.random() * 420,
        spin: (Math.random() - 0.5) * 0.02,
        size,
      });
    }
  }

  /** Короткий сноп искр — подтверждение удачной укладки фигурки. */
  spark(x: number, y: number, color: string, count = 7): void {
    for (let i = 0; i < count; i++) {
      const gfx = this.take();
      const size = 1.5 + Math.random() * 2;
      gfx.clear().circle(0, 0, size).fill(toNumber(color));
      gfx.position.set(x, y);
      gfx.alpha = 0.9;
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.06 + Math.random() * 0.12;
      this.active.push({
        gfx,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 0.05,
        life: 0,
        maxLife: 260 + Math.random() * 180,
        spin: 0,
        size,
      });
    }
  }

  update(dt: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i];
      p.life += dt;
      if (p.life >= p.maxLife) {
        this.give(p.gfx);
        this.active.splice(i, 1);
        continue;
      }
      p.vy += GRAVITY * dt;
      p.gfx.x += p.vx * dt;
      p.gfx.y += p.vy * dt;
      p.gfx.rotation += p.spin * dt;
      const t = p.life / p.maxLife;
      // Гаснут в последней трети жизни: раннее затухание съедает эффект.
      p.gfx.alpha = t < 0.65 ? 1 : 1 - (t - 0.65) / 0.35;
    }
  }

  clear(): void {
    for (const p of this.active) this.give(p.gfx);
    this.active.length = 0;
  }
}

/**
 * Вспышка на весь экран — только для комбо (две витрины подряд). Держится
 * редким событием намеренно: вспышка на каждое закрытие быстро начинает
 * раздражать и обесценивает само комбо.
 */
export class ComboFlash extends Container {
  private readonly gfx = new Graphics();
  private life = 0;
  private duration = 0;

  constructor() {
    super();
    this.eventMode = 'none';
    this.addChild(this.gfx);
    this.visible = false;
  }

  fire(width: number, height: number, color: string, duration = 420): void {
    this.gfx.clear().rect(0, 0, width, height).fill(toNumber(color));
    this.life = 0;
    this.duration = duration;
    this.visible = true;
  }

  update(dt: number): void {
    if (!this.visible) return;
    this.life += dt;
    const t = this.life / this.duration;
    if (t >= 1) {
      this.visible = false;
      return;
    }
    // Резкий приход, плавный уход.
    this.alpha = t < 0.15 ? (t / 0.15) * 0.34 : 0.34 * (1 - (t - 0.15) / 0.85);
  }
}

/**
 * Тряска камеры. Смещает контейнер сцены, а не сам холст: сдвиг холста
 * обнажил бы края и заставил браузер переслаивать страницу.
 */
export class Shake {
  private life = 0;
  private duration = 0;
  private strength = 0;

  fire(strength: number, duration = 260): void {
    // Новая тряска не складывается с текущей, а берёт максимум: сумма
    // нескольких закрытий подряд выглядела бы как поломка.
    this.strength = Math.max(this.strength, strength);
    this.duration = Math.max(this.duration - this.life, duration);
    this.life = 0;
  }

  /** Возвращает смещение сцены на этот кадр. */
  update(dt: number): { x: number; y: number } {
    if (this.duration <= 0) return { x: 0, y: 0 };
    this.life += dt;
    if (this.life >= this.duration) {
      this.duration = 0;
      this.strength = 0;
      return { x: 0, y: 0 };
    }
    const decay = 1 - this.life / this.duration;
    const amount = this.strength * decay * decay;
    return {
      x: (Math.random() - 0.5) * amount * 2,
      y: (Math.random() - 0.5) * amount * 2,
    };
  }
}
