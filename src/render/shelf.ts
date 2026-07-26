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
 *
 * Конструкцию задаёт скин (ShelfStyle): от скругления углов до заклёпок,
 * ламп маркизы и деревянных планок между ярусами. Состояния при этом общие для
 * всех скинов — иначе купленный скин ломал бы обучение игрока: подсветка
 * «сюда можно положить» обязана выглядеть одинаково всегда.
 */

import { Container, Graphics } from 'pixi.js';
import { mix, toNumber } from '../theme/color';
import type { SeasonTheme } from '../theme/seasons';
import type { ShelfStyle } from '../theme/skins';

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

/** Смешанный цвет сразу числом — Pixi принимает только его. */
function mixNumber(a: string, b: string, t: number): number {
  return toNumber(mix(a, b, t));
}

export class ShelfView extends Container {
  readonly index: number;
  /** Не readonly: метрики зависят от размера экрана и меняются при повороте. */
  private metrics: ShelfMetrics;
  private readonly theme: SeasonTheme;
  private readonly style: ShelfStyle;

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

  constructor(index: number, metrics: ShelfMetrics, theme: SeasonTheme, style: ShelfStyle) {
    super();
    this.index = index;
    this.metrics = metrics;
    this.theme = theme;
    this.style = style;

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
      .roundRect(
        -metrics.width / 2,
        -metrics.height,
        metrics.width,
        metrics.height,
        this.cornerRadius()
      )
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

  /**
   * Скругление углов витрины. Форма — самое заметное отличие скина: угол в
   * шесть пикселей у «Аркады» и в треть ширины у «Ретро» видно раньше, чем
   * любой оттенок.
   */
  private cornerRadius(): number {
    const w = this.metrics.width;
    switch (this.style) {
      case 'arcade':
        return Math.round(w * 0.06);
      case 'crystal':
        return Math.round(w * 0.1);
      case 'chrome':
        return Math.round(w * 0.16);
      case 'brass':
        return Math.round(w * 0.22);
      case 'wood':
        return Math.round(w * 0.34);
      default:
        return this.metrics.radius;
    }
  }

  /** Восемь точек контура со срезанными углами — форма «Кристалла». */
  private facetPoints(): number[] {
    const { width, height } = this.metrics;
    const x = -width / 2;
    const y = -height;
    const c = Math.min(width * 0.28, height * 0.18);
    return [
      x + c, y,
      x + width - c, y,
      x + width, y + c,
      x + width, y + height - c,
      x + width - c, y + height,
      x + c, y + height,
      x, y + height - c,
      x, y + c,
    ];
  }

  private redraw(): void {
    const { width, height } = this.metrics;
    const x = -width / 2;
    const y = -height;
    const radius = this.cornerRadius();
    const faceted = this.style === 'crystal';

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
    if (faceted) {
      this.frame.poly(this.facetPoints()).fill({ color: 0x000000, alpha: 0.32 });
    } else {
      this.frame.roundRect(x, y, width, height, radius).fill({ color: 0x000000, alpha: 0.32 });
    }

    this.drawSkinDecor();

    // Толщина и яркость рамы — главный носитель состояния. Он общий для всех
    // скинов: «сюда можно положить» обязано выглядеть одинаково всегда.
    const selected = this.state === 'selected';
    const locked = this.state === 'locked';
    const available = this.state === 'available';
    const pulseAmount = available ? 0.5 + 0.5 * Math.sin(this.pulse * Math.PI * 2) : 0;

    const strokeColor = locked || selected ? accent : available ? accent : frameColor;
    const strokeAlpha = locked ? 0.95 : selected ? 1 : available ? 0.45 + pulseAmount * 0.5 : 0.6;
    // Литая латунь и деревянный корпус толще стеклянной витрины — это и
    // делает их «тяжёлыми» на вид.
    const heavy = this.style === 'brass' || this.style === 'wood' ? 1.4 : 0;
    const strokeWidth = (locked || selected ? 3 : available ? 2 + pulseAmount : 2) + heavy;

    if (faceted) {
      this.frame
        .poly(this.facetPoints())
        .stroke({ width: strokeWidth, color: strokeColor, alpha: strokeAlpha });
    } else {
      this.frame
        .roundRect(x, y, width, height, radius)
        .stroke({ width: strokeWidth, color: strokeColor, alpha: strokeAlpha });
    }

    this.drawBase(locked);

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
    this.drawShine();
  }

  /**
   * Детали конструкции: то, ради чего скин вообще покупают. Рисуются ПОД
   * рамкой состояния, чтобы подсветка «выбрано»/«сюда можно» всегда была
   * сверху и читалась поверх любого декора.
   */
  private drawSkinDecor(): void {
    const { width, height, slot, pad } = this.metrics;
    const x = -width / 2;
    const y = -height;
    const g = this.frame;
    const frameColor = toNumber(this.theme.frame);
    const glassColor = toNumber(this.theme.glass);
    const accentAlt = toNumber(this.theme.accentAlt);

    // Вертикальный блик по левому краю: деталь, от которой тёмный
    // прямоугольник начинает читаться как стекло. У дерева и аркады стекла
    // нет — там корпус, и блик выглядел бы царапиной.
    const glassStrip = () => {
      g.roundRect(x + width * 0.14, y + height * 0.06, width * 0.08, height * 0.86, width * 0.04)
        .fill({ color: glassColor, alpha: 0.1 });
    };

    switch (this.style) {
      case 'brass': {
        glassStrip();
        // Заклёпки по углам — их четыре, потому что пятая уже читается как шум.
        const r = Math.max(1.6, width * 0.035);
        const inset = width * 0.13;
        for (const [cx, cy] of [
          [x + inset, y + inset],
          [x + width - inset, y + inset],
          [x + inset, -inset],
          [x + width - inset, -inset],
        ]) {
          g.circle(cx, cy, r).fill({ color: glassColor, alpha: 0.55 });
          g.circle(cx - r * 0.3, cy - r * 0.3, r * 0.45).fill({ color: 0xffffff, alpha: 0.5 });
        }
        // Шильдик на нижней трети — «гравировка» с номером витрины.
        const plateW = width * 0.44;
        g.roundRect(-plateW / 2, -height * 0.16, plateW, Math.max(4, slot * 0.13), 2).fill({
          color: frameColor,
          alpha: 0.85,
        });
        break;
      }

      case 'arcade': {
        // Маркиза сверху с двумя лампами — главный признак автомата.
        const marqueeH = Math.max(6, slot * 0.22);
        g.rect(x, y, width, marqueeH).fill({ color: accentAlt, alpha: 0.32 });
        const lampR = Math.max(1.6, marqueeH * 0.26);
        g.circle(x + width * 0.2, y + marqueeH / 2, lampR).fill({ color: 0xffffff, alpha: 0.8 });
        g.circle(x + width * 0.8, y + marqueeH / 2, lampR).fill({ color: 0xffffff, alpha: 0.8 });
        // Боковые неонки во всю высоту.
        const strip = Math.max(1.5, width * 0.035);
        g.rect(x + strip, y + marqueeH, strip, height - marqueeH - strip * 2).fill({
          color: accentAlt,
          alpha: 0.75,
        });
        g.rect(x + width - strip * 2, y + marqueeH, strip, height - marqueeH - strip * 2).fill({
          color: accentAlt,
          alpha: 0.75,
        });
        break;
      }

      case 'wood': {
        // Планка под каждым ярусом: витрина превращается в этажерку, и
        // становится видно, сколько мест в ней осталось.
        const boardH = Math.max(2, slot * 0.06);
        for (let i = 1; i * slot + pad < height; i++) {
          g.roundRect(
            x + width * 0.07,
            -pad - slot * i - boardH / 2,
            width * 0.86,
            boardH,
            boardH / 2
          ).fill({ color: frameColor, alpha: 0.9 });
        }
        // Волокно: две вертикальные прожилки тёплого тона.
        g.rect(x + width * 0.24, y + height * 0.08, 1, height * 0.84).fill({
          color: mixNumber(this.theme.frame, '#ffffff', 0.35),
          alpha: 0.18,
        });
        g.rect(x + width * 0.7, y + height * 0.12, 1, height * 0.76).fill({
          color: mixNumber(this.theme.frame, '#000000', 0.4),
          alpha: 0.22,
        });
        break;
      }

      case 'chrome': {
        glassStrip();
        // Фаска: яркая полоса по верхней кромке и тёмная по нижней. Именно
        // эта пара делает металл металлом.
        const bevel = Math.max(2, height * 0.02);
        g.roundRect(x + 2, y + 2, width - 4, bevel, bevel / 2).fill({
          color: 0xffffff,
          alpha: 0.45,
        });
        g.roundRect(x + 2, -bevel - 2, width - 4, bevel, bevel / 2).fill({
          color: 0x000000,
          alpha: 0.4,
        });
        break;
      }

      case 'crystal': {
        // Грани: две диагонали через весь корпус, как преломление в стекле.
        g.moveTo(x, y + height * 0.34)
          .lineTo(x + width * 0.52, y)
          .stroke({ width: 1.4, color: glassColor, alpha: 0.4 });
        g.moveTo(x + width, y + height * 0.28)
          .lineTo(x + width * 0.28, -0)
          .stroke({ width: 1.2, color: glassColor, alpha: 0.22 });
        break;
      }

      default:
        glassStrip();
    }
  }

  /** Цоколь под витриной. У каждого скина он свой — это подпись конструкции. */
  private drawBase(locked: boolean): void {
    const { width } = this.metrics;
    const x = -width / 2;
    const radius = this.metrics.radius;
    const g = this.frame;
    const frameColor = toNumber(this.theme.frame);
    const accent = toNumber(this.theme.accent);
    const glassColor = toNumber(this.theme.glass);

    if (this.style === 'arcade') {
      // Плоская тумба во всю ширину: автомат стоит на полу, а не парит.
      g.rect(x - 3, -radius * 0.55, width + 6, radius * 0.55).fill({
        color: frameColor,
        alpha: 0.85,
      });
    } else if (this.style === 'wood') {
      // Две ножки вместо сплошной плиты.
      const legW = width * 0.16;
      g.roundRect(x + width * 0.1, -radius * 0.4, legW, radius * 0.4, 2).fill({
        color: frameColor,
        alpha: 0.9,
      });
      g.roundRect(x + width * 0.74, -radius * 0.4, legW, radius * 0.4, 2).fill({
        color: frameColor,
        alpha: 0.9,
      });
    } else {
      g.roundRect(x - 2, -radius * 0.5, width + 4, radius * 0.5, radius * 0.25).fill({
        color: frameColor,
        alpha: 0.55,
      });
    }

    // Светящаяся полоса под основанием: она же индикатор «витрина закрыта».
    g.roundRect(x + width * 0.2, -3, width * 0.6, 2.5, 1.25).fill({
      color: locked ? accent : glassColor,
      alpha: locked ? 0.9 : 0.32,
    });
  }

  private drawShine(): void {
    const { width, height } = this.metrics;
    const x = -width / 2;
    const y = -height;
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
