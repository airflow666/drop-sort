/**
 * Витрина — стеклянный шкаф, в который укладываются фигурки.
 *
 * Витрина одновременно игровой объект и полка коллекции (план, §1), поэтому у
 * неё много состояний, и каждое обязано читаться мгновенно, без подписей:
 *
 *   обычная   — тёмное стекло, тонкая рама;
 *   выбранная — рама светится акцентом, витрина чуть приподнята;
 *   доступная — пульсирует, когда в руке есть фигурка, которую сюда можно
 *               положить: это подсказка «куда», и без неё игрок тапает наугад;
 *   закрытая  — опустилось стекло, по нему прошёл блик, рама горит ровно.
 *
 * Рисуется через Graphics, а не текстурой: высота зависит от вместимости, а
 * состояния меняются каждый кадр — перерисовка вектора здесь дешевле, чем
 * набор картинок под каждый размер.
 */

import { Container, Graphics } from 'pixi.js';
import { toNumber } from '../theme/color';
import type { SeasonTheme } from '../theme/seasons';

export interface ShelfMetrics {
  width: number;
  height: number;
  /** Высота одного места под фигурку. */
  slot: number;
  /** Отступ от рамы до фигурок. */
  pad: number;
  radius: number;
}

export function shelfMetrics(slotHeight: number, capacity: number): ShelfMetrics {
  const pad = Math.round(slotHeight * 0.16);
  // Витрина уже, чем фигурка: фигурка немного выступает за раму по бокам,
  // и от этого стоящий в витрине предмет читается как объёмный.
  const width = Math.round(slotHeight * 0.94);
  return {
    width,
    height: slotHeight * capacity + pad * 2,
    slot: slotHeight,
    pad,
    radius: Math.round(width * 0.3),
  };
}

export type ShelfState = 'idle' | 'selected' | 'available' | 'locked';

export class ShelfView extends Container {
  readonly index: number;
  /** Не readonly: метрики зависят от размера экрана и меняются при повороте. */
  private metrics: ShelfMetrics;
  private readonly theme: SeasonTheme;

  private readonly frame = new Graphics();
  private readonly glass = new Graphics();
  private readonly highlight = new Graphics();
  /** Маска силуэта витрины: держит блик внутри рамы. Строится один раз. */
  private readonly clip = new Graphics();


  private state: ShelfState = 'idle';
  /** Фаза пульсации доступной витрины. */
  private pulse = 0;
  /** 0 — стекло поднято, 1 — опущено полностью. */
  private glassDrop = 0;
  /** Позиция блика по стеклу, >1 — блик прошёл. */
  private shine = 2;

  constructor(index: number, metrics: ShelfMetrics, theme: SeasonTheme) {
    super();
    this.index = index;
    this.metrics = metrics;
    this.theme = theme;

    this.highlight.mask = this.clip;
    this.addChild(this.frame, this.glass, this.highlight, this.clip);

    this.eventMode = 'static';
    this.cursor = 'pointer';

    this.rebuild(metrics);
  }

  /**
   * Пересобрать под новые метрики: вызывается при повороте экрана и при
   * добавлении витрины бонусом, когда все места пересчитываются.
   */
  rebuild(metrics: ShelfMetrics): void {
    this.metrics = metrics;

    this.clip
      .clear()
      .roundRect(-metrics.width / 2, -metrics.height, metrics.width, metrics.height, metrics.radius)
      .fill(0xffffff);

    // Область нажатия — вся витрина с запасом: попасть пальцем по рамке
    // толщиной 2 пикселя на телефоне невозможно.
    const padX = metrics.width / 2 + 4;
    this.hitArea = {
      contains: (x: number, y: number) =>
        x >= -padX && x <= padX && y >= -metrics.height - 10 && y <= 12,
    };

    this.redraw();
  }

  setState(state: ShelfState): void {
    if (this.state === state) return;
    this.state = state;
    if (state !== 'available') this.pulse = 0;
    this.redraw();
  }

  getState(): ShelfState {
    return this.state;
  }

  /** Прогресс опускания стекла (0..1) — гонится твином при закрытии. */
  setGlassDrop(v: number): void {
    this.glassDrop = v;
    this.redraw();
  }

  /** Прогресс блика по стеклу (0..1); за пределами — блик не рисуется. */
  setShine(v: number): void {
    this.shine = v;
    this.redraw();
  }

  /** Анимация пульсации. dt в миллисекундах. */
  tick(dt: number): void {
    if (this.state !== 'available') return;
    this.pulse = (this.pulse + dt / 900) % 1;
    this.redraw();
  }

  /** Локальная координата центра места `slotIndex` (снизу вверх). */
  slotCenter(slotIndex: number): { x: number; y: number } {
    const { pad, slot } = this.metrics;
    return { x: 0, y: -pad - slot * slotIndex - slot / 2 };
  }

  /** Координата над витриной — оттуда фигурка «падает» и туда поднимается. */
  get liftY(): number {
    return -this.metrics.height - this.metrics.slot * 0.42;
  }

  private redraw(): void {
    const { width, height, radius } = this.metrics;
    const x = -width / 2;
    const y = -height;

    const frameColor = toNumber(this.theme.frame);
    const accent = toNumber(this.theme.accent);
    const glassColor = toNumber(this.theme.glass);

    // --- Рама и внутренность --------------------------------------------
    this.frame.clear();

    // Подсветка под витриной: пятно на «полу», привязывает шкаф к сцене.
    this.frame
      .ellipse(0, 4, width * 0.52, width * 0.16)
      .fill({ color: this.state === 'locked' ? accent : frameColor, alpha: 0.28 });

    // Внутренний объём: сверху темнее, чтобы фигурки читались на фоне.
    this.frame.roundRect(x, y, width, height, radius).fill({ color: 0x000000, alpha: 0.32 });

    // Толщина и яркость рамы — главный носитель состояния.
    const selected = this.state === 'selected';
    const locked = this.state === 'locked';
    const available = this.state === 'available';
    const pulseAmount = available ? 0.5 + 0.5 * Math.sin(this.pulse * Math.PI * 2) : 0;

    const strokeColor = locked || selected ? accent : available ? accent : frameColor;
    const strokeAlpha = locked ? 0.95 : selected ? 1 : available ? 0.45 + pulseAmount * 0.5 : 0.6;
    const strokeWidth = locked || selected ? 3 : available ? 2 + pulseAmount : 2;

    this.frame
      .roundRect(x, y, width, height, radius)
      .stroke({ width: strokeWidth, color: strokeColor, alpha: strokeAlpha });

    // Вертикальный блик по левому краю — единственная деталь, от которой
    // тёмный прямоугольник начинает читаться как стекло.
    const gx = x + width * 0.14;
    this.frame
      .roundRect(gx, y + height * 0.06, width * 0.08, height * 0.86, width * 0.04)
      .fill({ color: glassColor, alpha: 0.1 });

    // Основание: плита с неоновой полосой под ней.
    this.frame
      .roundRect(x - 2, -radius * 0.5, width + 4, radius * 0.5, radius * 0.25)
      .fill({ color: frameColor, alpha: 0.55 });
    this.frame
      .roundRect(x + width * 0.2, -3, width * 0.6, 2.5, 1.25)
      .fill({ color: locked ? accent : glassColor, alpha: locked ? 0.9 : 0.32 });

    // --- Опустившееся стекло --------------------------------------------
    this.glass.clear();
    if (this.glassDrop > 0) {
      const panelHeight = height * this.glassDrop;
      this.glass
        .roundRect(x + 2, y, width - 4, panelHeight, radius * 0.9)
        .fill({ color: glassColor, alpha: 0.14 });
      // Кромка опускающегося стекла — по ней видно движение.
      this.glass
        .roundRect(x + 2, y + panelHeight - 3, width - 4, 3, 1.5)
        .fill({ color: glassColor, alpha: 0.5 });
    }

    // --- Блик, пробегающий по стеклу ------------------------------------
    this.highlight.clear();
    if (this.shine >= 0 && this.shine <= 1) {
      // Диагональная полоса идёт сверху вниз; она и есть визуальная
      // «печать» на собранном сете.
      const t = this.shine;
      const bandHeight = height * 0.3;
      const top = y - bandHeight + (height + bandHeight * 2) * t;
      const alpha = Math.sin(t * Math.PI) * 0.5;
      this.highlight
        .moveTo(x, top)
        .lineTo(x + width, top - bandHeight * 0.5)
        .lineTo(x + width, top - bandHeight * 0.5 + bandHeight)
        .lineTo(x, top + bandHeight)
        .fill({ color: 0xffffff, alpha });
    }
  }
}
