/**
 * Фон сцены: градиент сезона, неоновые пятна и перспективная сетка «пола».
 *
 * Фон задаёт настроение всей игре, но не имеет права стоить производительности:
 * бюджет — слабый Android (план, §7). Поэтому здесь нет ни одного фильтра
 * (размытия в Pixi считаются на GPU каждый кадр), а мягкость пятен даётся
 * радиальными градиентами — они запекаются в маленькую текстуру один раз.
 * Анимация — только медленный сдвиг позиций уже нарисованных объектов.
 */

import { Container, FillGradient, Graphics } from 'pixi.js';
import { toNumber } from '../theme/color';
import type { SeasonTheme } from '../theme/seasons';

/** '#rrggbb' + альфа → '#rrggbbaa': Pixi понимает восьмизначный hex. */
function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hex}${a}`;
}

interface Blob {
  gfx: Graphics;
  /** Базовая позиция в долях экрана. */
  bx: number;
  by: number;
  /** Скорость и фаза дрейфа. */
  speed: number;
  phase: number;
  amp: number;
}

export class Background extends Container {
  private readonly gradient = new Graphics();
  private readonly grid = new Graphics();
  private readonly blobs: Blob[] = [];
  private theme: SeasonTheme;
  private width0 = 0;
  private height0 = 0;
  private time = 0;

  constructor(theme: SeasonTheme) {
    super();
    this.theme = theme;
    // Фон не участвует в попадании тапов: иначе он перехватывал бы промахи
    // мимо витрин, а промах должен просто сниматься выбор.
    this.eventMode = 'none';
    this.addChild(this.gradient);

    for (let i = 0; i < 3; i++) {
      const gfx = new Graphics();
      gfx.eventMode = 'none';
      this.addChild(gfx);
      this.blobs.push({
        gfx,
        bx: [0.16, 0.84, 0.5][i],
        by: [0.1, 0.24, 0.78][i],
        speed: [0.00006, 0.00009, 0.00005][i],
        phase: [0, 2.1, 4.2][i],
        amp: [0.05, 0.04, 0.035][i],
      });
    }

    this.addChild(this.grid);
  }

  setTheme(theme: SeasonTheme): void {
    this.theme = theme;
    this.resize(this.width0, this.height0);
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    this.width0 = width;
    this.height0 = height;

    // --- Основной градиент ------------------------------------------------
    const vertical = new FillGradient({
      type: 'linear',
      start: { x: 0, y: 0 },
      end: { x: 0, y: 1 },
      colorStops: [
        { offset: 0, color: toNumber(this.theme.bgTop) },
        { offset: 1, color: toNumber(this.theme.bgBottom) },
      ],
    });
    this.gradient.clear().rect(0, 0, width, height).fill(vertical);

    // --- Неоновые пятна ---------------------------------------------------
    const colors = [this.theme.glowA, this.theme.glowB, this.theme.accent];
    const radius = Math.max(width, height) * 0.55;
    this.blobs.forEach((blob, i) => {
      // Затухание задаётся альфой В СТОПАХ: без него радиальный градиент из
      // одного цвета даёт сплошной круг с резким краем, а нужно мягкое пятно.
      // Квадратичный спад по альфе выглядит ближе к настоящему свечению, чем
      // линейный: у линейного виден «обруч» на середине радиуса.
      const stops = [0, 0.3, 0.55, 0.78, 1].map((offset) => ({
        offset,
        color: withAlpha(colors[i], Math.pow(1 - offset, 2)),
      }));
      const radial = new FillGradient({
        type: 'radial',
        center: { x: 0.5, y: 0.5 },
        innerRadius: 0,
        outerCenter: { x: 0.5, y: 0.5 },
        outerRadius: 0.5,
        colorStops: stops,
      });
      blob.gfx.clear().circle(0, 0, radius).fill(radial);
      blob.gfx.alpha = [0.5, 0.42, 0.3][i];
      // Сплющиваем пятно: вытянутые по горизонтали пятна читаются как
      // подсветка сцены, а идеальные круги — как наложенные кружки.
      blob.gfx.scale.set(1, 0.68);
    });

    // --- Перспективная сетка пола ----------------------------------------
    // Витрины стоят «на полу», и сетка даёт сцене глубину практически даром.
    this.grid.clear();
    const horizon = height * 0.58;
    const accent = toNumber(this.theme.accentAlt);
    const lines = 9;
    for (let i = 0; i <= lines; i++) {
      const t = i / lines;
      // Сгущение к горизонту — квадратичный шаг вместо линейного.
      const y = horizon + (height - horizon) * t * t;
      this.grid
        .moveTo(0, y)
        .lineTo(width, y)
        .stroke({ width: 1, color: accent, alpha: 0.06 * (0.3 + t) });
    }
    const vanishX = width / 2;
    for (let i = -6; i <= 6; i++) {
      const spread = (i / 6) * width * 1.5;
      this.grid
        .moveTo(vanishX + spread * 0.12, horizon)
        .lineTo(vanishX + spread, height)
        .stroke({ width: 1, color: accent, alpha: 0.05 });
    }

    this.update(0);
  }

  /** dt в миллисекундах. */
  update(dt: number): void {
    this.time += dt;
    for (const blob of this.blobs) {
      const t = this.time * blob.speed + blob.phase;
      blob.gfx.position.set(
        (blob.bx + Math.sin(t) * blob.amp) * this.width0,
        (blob.by + Math.cos(t * 0.8) * blob.amp * 0.7) * this.height0
      );
    }
  }
}
