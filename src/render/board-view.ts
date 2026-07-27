/**
 * Игровое поле: раскладка витрин, спрайты фигурок, вся анимация ходов.
 *
 * Здесь живёт то, что план (§3) называет «ощущениями» и запрещает экономить:
 * магнит при укладке, защёлкивание стекла, комбо-вспышка, отдача. Правила
 * при этом целиком остаются в ядре — этот класс только отражает то, что
 * вернул `Board.tap`, и никогда не решает сам, допустим ли ход.
 */

import { Container, Sprite, Texture } from 'pixi.js';
import type { Board, Species, TapResult } from '../core';
import { COMBO_WINDOW } from '../core';
import type { FigurineDef, SeasonTheme } from '../theme/seasons';
import type { ShelfStyle } from '../theme/skins';
import { cachedFigurine, CONTENT_RATIO } from './textures';
import { ShelfView, shelfMetrics, type ShelfMetrics } from './shelf';
import type { Particles, Popups, Rings } from './fx';
import { easeBack, easeElastic, easeIn, easeInOut, easeOut, type Tweens } from './tween';

/** Обратная связь наружу: звук, вибрация, счёт, экраны. */
export interface BoardCallbacks {
  onLift?(species: Species): void;
  onPlace?(species: Species): void;
  onReject?(): void;
  /** Витрина закрылась. `combo` — длина текущей серии закрытий. */
  onClose?(shelfIndex: number, species: Species, combo: number): void;
  onCombo?(combo: number, color: string): void;
  onSolved?(): void;
  /** Ходов больше нет — момент для предложения «+1 витрина». */
  onDeadlock?(): void;
  /** Любой состоявшийся ход — чтобы обновить счётчик ходов в HUD. */
  onMove?(): void;
}

interface Piece {
  sprite: Sprite;
  species: Species;
}

/**
 * Зазор между рядами в долях высоты места. При 0.26 нижняя кромка верхнего ряда
 * почти касалась верхней кромки нижнего, и два ряда читались как одна сплошная
 * масса. Плата за увеличение — меньше процента размера места.
 */
const ROW_GAP_RATIO = 0.4;
/** 0.5 — точный центр области, больше — ниже. */
const VERTICAL_BIAS = 0.62;

/**
 * Насколько крупнее фигурка «в руке». Держится маленьким осознанно: поднятая
 * фигурка должна читаться как приподнятая над полем, а не как другая фигурка.
 */
const LIFT_SCALE = 1.09;

/**
 * Запас высоты над верхним рядом, в долях высоты места.
 *
 * Складывается из подъёма фигурки над витриной (0.42 места, см.
 * `ShelfView.liftY`) и высоты её содержимого (0.9 места), увеличенной на
 * LIFT_SCALE, плюс немного воздуха, чтобы фигурка не касалась HUD.
 */
const HEADROOM_RATIO = 0.42 + 0.9 * LIFT_SCALE + 0.12;

/**
 * Запас высоты под нижним рядом, в долях высоты места.
 *
 * Точка отсчёта витрины — её дно, но рисуется она и ниже него: цоколь и пятно
 * подсветки на «полу». Без этого запаса нижний ряд на десктопе упирался ровно
 * в границу области, и подсветка пола заезжала под кнопки инструментов.
 */
const FOOTROOM_RATIO = 0.3;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export class BoardView extends Container {
  private readonly board: Board;
  private readonly species: FigurineDef[];
  private readonly theme: SeasonTheme;
  /** Конструкция витрин: приходит из надетого скина. */
  private readonly shelfStyle: ShelfStyle;
  private readonly tweens: Tweens;
  private readonly particles: Particles;
  private readonly rings: Rings;
  private readonly popups: Popups;
  private readonly callbacks: BoardCallbacks;

  private readonly shelvesLayer = new Container();
  private readonly piecesLayer = new Container();

  private shelves: ShelfView[] = [];
  /** Спрайты фигурок, параллельно board.shelves: снизу вверх. */
  private stacks: Piece[][] = [];
  private metrics: ShelfMetrics = shelfMetrics(64, 4);

  /** Ход анимируется — ввод заблокирован, иначе стек рассинхронизируется. */
  private busy = false;
  /** Номер хода, на котором закрылась предыдущая витрина, — для комбо. */
  private lastCloseMove = -99;
  private comboLength = 0;
  private viewWidth = 0;
  private viewHeight = 0;

  /**
   * Фигурка «в руке»: пока она поднята, она мягко покачивается.
   *
   * Без этого поднятая фигурка стоит неподвижно, и состояние «я держу её»
   * ничем не отличается от «она просто нарисована выше». Покачивание — самый
   * дешёвый способ показать, что ход ещё не сделан и его можно отменить.
   */
  private held: { piece: Piece; baseY: number; phase: number } | null = null;

  constructor(opts: {
    board: Board;
    species: FigurineDef[];
    theme: SeasonTheme;
    shelfStyle: ShelfStyle;
    tweens: Tweens;
    particles: Particles;
    rings: Rings;
    popups: Popups;
    callbacks?: BoardCallbacks;
  }) {
    super();
    this.board = opts.board;
    this.species = opts.species;
    this.theme = opts.theme;
    this.shelfStyle = opts.shelfStyle;
    this.tweens = opts.tweens;
    this.particles = opts.particles;
    this.rings = opts.rings;
    this.popups = opts.popups;
    this.callbacks = opts.callbacks ?? {};

    this.addChild(this.shelvesLayer, this.piecesLayer);
    this.build();
  }

  // --- Построение ---------------------------------------------------------

  private build(): void {
    this.shelvesLayer.removeChildren();
    this.piecesLayer.removeChildren();
    this.shelves = [];
    this.stacks = [];

    for (let i = 0; i < this.board.shelfCount; i++) {
      this.addShelfView(i);
    }
  }

  private addShelfView(index: number): void {
    const view = new ShelfView(index, this.metrics, this.theme, this.shelfStyle);
    view.on('pointertap', () => void this.tap(index));
    this.shelvesLayer.addChild(view);
    this.shelves[index] = view;

    const stack: Piece[] = [];
    for (const species of this.board.shelves[index]) {
      stack.push(this.createPiece(species));
    }
    this.stacks[index] = stack;
  }

  private createPiece(species: Species): Piece {
    const def = this.species[species % this.species.length];
    const sprite = new Sprite(cachedFigurine(def.key) ?? Texture.EMPTY);
    // Опорная точка — низ содержимого, а не низ кадра: в кадре есть запас
    // под свечение и тень, и по низу кадра фигурки встали бы вразнобой.
    sprite.anchor.set(0.5, CONTENT_RATIO.y + CONTENT_RATIO.h);
    sprite.eventMode = 'none';
    this.piecesLayer.addChild(sprite);
    return { sprite, species };
  }

  /** Текстуры доезжают асинхронно — доставить их в уже созданные спрайты. */
  refreshTextures(): void {
    for (const stack of this.stacks) {
      for (const piece of stack) {
        if (piece.sprite.texture !== Texture.EMPTY) continue;
        const def = this.species[piece.species % this.species.length];
        const texture = cachedFigurine(def.key);
        if (texture) piece.sprite.texture = texture;
      }
    }
    this.applyPieceSizes();
  }

  // --- Раскладка ---------------------------------------------------------

  /**
   * Разместить витрины в доступной области.
   *
   * Число рядов выбирается по числу витрин и форме экрана: на телефоне в
   * портрете 12 витрин в один ряд дали бы фигурки размером со спичечную
   * головку, а на десктопе два ряда по три выглядят потерянными.
   */
  layout(width: number, height: number): void {
    this.viewWidth = width;
    this.viewHeight = height;
    const count = this.board.shelfCount;
    const portrait = height > width;
    const capacity = this.board.capacity;
    const gapX = 8;

    /**
     * Какой высоты выйдет место при заданном числе рядов.
     *
     * «По высоте» — это не только сами витрины. Над верхним рядом обязан
     * остаться воздух под фигурку в руке: поднятая фигурка висит над витриной
     * (liftY) и рисуется вверх от точки опоры на высоту своего содержимого.
     * Без этого запаса поднятая из верхнего ряда фигурка наполовину уезжала за
     * край экрана и налезала на HUD — а поднятие происходит в каждом первом
     * ходе, то есть ломалось это постоянно.
     */
    const slotFor = (rowCount: number): number => {
      const perRow = Math.ceil(count / rowCount);
      const byWidth = (width - gapX * (perRow + 1)) / perRow / 0.94;
      // Всё в долях высоты места: корпус витрины (capacity + запас на рамку),
      // зазоры между рядами и запас под фигурку в руке сверху.
      const totalRatio =
        (capacity + 0.32) * rowCount +
        ROW_GAP_RATIO * (rowCount - 1) +
        HEADROOM_RATIO +
        FOOTROOM_RATIO;
      return Math.min(byWidth, height / totalRatio);
    };

    // В портрете два ряда выгоднее одного почти всегда: при пяти витринах в один
    // ряд размер места упирается в ширину экрана (~77 пикселей), поле занимает
    // меньше половины доступной высоты, и сверху остаётся большая пустота.
    // Два ряда по три дают и место крупнее, и заполненную вертикаль.
    //
    // В альбомной ориентации всё наоборот, и жёсткое правило «больше семи
    // витрин — два ряда» там вредило: восемь витрин в два ряда на мониторе
    // 1920×1080 упирались в высоту, поле съёживалось в узкую колонку по центру
    // и по бокам оставалось две трети пустого экрана. Ширины же там с запасом,
    // поэтому число рядов выбирается по результату — какой вариант даёт место
    // крупнее, тот и берётся.
    const rows = portrait
      ? count <= 3
        ? 1
        : count <= 10
          ? 2
          : 3
      : slotFor(1) >= slotFor(2)
        ? 1
        : 2;
    const perRow = Math.ceil(count / rows);

    // Верхняя граница размера места тоже зависит от экрана. Фиксированные 88
    // пикселей задумывались как защита от гигантских фигурок на телефоне, но
    // на десктопе именно они и держали поле маленьким: высоты хватало на
    // полуторакратно более крупные витрины, а размер упирался в константу.
    const maxSlot = clamp(Math.min(width, height) * 0.17, 88, 140);
    let slot = slotFor(rows);
    slot = clamp(slot, 26, maxSlot);

    this.metrics = shelfMetrics(Math.round(slot), capacity);
    const shelfH = this.metrics.height;
    const rowStride = shelfH + slot * ROW_GAP_RATIO;
    const totalH = rowStride * rows - slot * ROW_GAP_RATIO;
    const headroom = slot * HEADROOM_RATIO;
    const footroom = slot * FOOTROOM_RATIO;
    // Поле смещено вниз от центра: на телефоне витрины должны попадать в зону
    // большого пальца, а не в середину экрана, куда до них надо тянуться.
    // Смещается при этом только тот остаток высоты, который остался после
    // вычета запасов сверху и снизу, — иначе смещение съедало бы сами запасы.
    const free = Math.max(0, height - totalH - headroom - footroom);
    const startY = headroom + free * VERTICAL_BIAS + shelfH;

    for (let i = 0; i < count; i++) {
      const row = Math.floor(i / perRow);
      const inRow = i % perRow;
      const rowCount = Math.min(perRow, count - row * perRow);
      const rowWidth = rowCount * this.metrics.width + (rowCount - 1) * gapX;
      const x = (width - rowWidth) / 2 + inRow * (this.metrics.width + gapX) + this.metrics.width / 2;
      const y = startY + row * rowStride;

      const view = this.shelves[i];
      view.position.set(x, y);
      // Метрики зависят от размера экрана, поэтому витрины пересобираются:
      // это дешевле, чем тянуть изменяемую геометрию через все состояния.
      view.rebuild(this.metrics);
    }

    this.applyPieceSizes();
    this.snapAllPieces();
    this.restoreHeld();
    this.refreshShelfStates();
  }

  /**
   * Вернуть поднятую фигурку «в руку» после пересчёта раскладки.
   *
   * `snapAllPieces` расставляет всё по местам, в том числе и ту фигурку,
   * которую игрок держит. При повороте экрана она молча падала обратно в
   * витрину, а ядро продолжало считать её выбранной: следующий тап делал ход
   * фигуркой, которая визуально лежит на месте.
   */
  private restoreHeld(): void {
    this.held = null;
    const selected = this.board.selected;
    if (selected === null) return;
    const stack = this.stacks[selected];
    const piece = stack?.[stack.length - 1];
    if (!piece) return;
    const to = this.liftPosition(selected);
    piece.sprite.position.set(to.x, to.y);
    this.applyPieceSizesTo(piece, LIFT_SCALE);
    this.piecesLayer.setChildIndex(piece.sprite, this.piecesLayer.children.length - 1);
    this.held = { piece, baseY: to.y, phase: 0 };
  }

  /**
   * Размер кадра фигурки при масштабе `factor`.
   *
   * Единственный источник размера спрайта во всём классе. Раньше анимация
   * подъёма трогала `sprite.scale` напрямую — и это было главной поломкой
   * движения: `setSize` задаёт масштаб как «нужные пиксели ÷ размер текстуры»
   * (у текстуры фигурки это 232×264 при DPR 2), то есть рабочий масштаб
   * спрайта — около 0.25. Присвоение `scale.set(1)` в анимации подъёма
   * означало не «обычный размер», а «размер текстуры»: фигурка на время
   * подъёма раздувалась вчетверо и схлопывалась обратно в конце. На телефоне,
   * где всё быстрее, это и выглядело как сломанная анимация.
   */
  private frameSize(factor = 1): { w: number; h: number } {
    // Содержимое кадра должно занять почти всё место в витрине; остальное —
    // запас под свечение, он специально выходит за границы места.
    const contentH = this.metrics.slot * 0.9 * factor;
    const h = contentH / CONTENT_RATIO.h;
    return { w: h * (132 / 150), h };
  }

  private applyPieceSizes(): void {
    const { w, h } = this.frameSize();
    for (const stack of this.stacks) {
      for (const piece of stack) {
        piece.sprite.setSize(w, h);
      }
    }
  }

  /** Поставить все фигурки по местам без анимации. */
  private snapAllPieces(): void {
    for (let s = 0; s < this.stacks.length; s++) {
      const view = this.shelves[s];
      this.stacks[s].forEach((piece, slot) => {
        const local = view.slotCenter(slot);
        piece.sprite.position.set(view.x + local.x, view.y + local.y + this.metrics.slot / 2);
        piece.sprite.rotation = 0;
        piece.sprite.alpha = 1;
      });
    }
  }

  /** Экранная позиция места `slot` в витрине `shelf`. */
  private slotPosition(shelf: number, slot: number): { x: number; y: number } {
    const view = this.shelves[shelf];
    const local = view.slotCenter(slot);
    return { x: view.x + local.x, y: view.y + local.y + this.metrics.slot / 2 };
  }

  private liftPosition(shelf: number): { x: number; y: number } {
    const view = this.shelves[shelf];
    return { x: view.x, y: view.y + view.liftY };
  }

  /**
   * Координаты поля → координаты сцены.
   *
   * Слои эффектов (частицы, кольца, всплывающие числа) живут на сцене, а не
   * внутри поля: в блице поле уничтожается и пересоздаётся на каждом уровне, а
   * салют от последнего закрытого сета должен долететь. Плата за это — ручной
   * перевод координат: поле сдвинуто вниз на высоту HUD, и без перевода искры
   * от укладки вылетали на эту высоту выше самой фигурки.
   */
  private toStage(x: number, y: number): { x: number; y: number } {
    return { x: this.x + x, y: this.y + y };
  }

  // --- Ввод --------------------------------------------------------------

  /** Обработать тап по витрине. Публичный: тот же путь используют подсказки. */
  async tap(index: number): Promise<void> {
    if (this.busy) return;
    const before = this.board.selected;
    const result = this.board.tap(index);

    switch (result.kind) {
      case 'ignored':
        return;

      case 'lift':
        await this.animateLift(result.from);
        this.callbacks.onLift?.(result.species);
        this.refreshShelfStates();
        return;

      case 'cancel':
        await this.animateDrop(result.from);
        this.refreshShelfStates();
        return;

      case 'reselect':
        // Опускаем прежнюю и поднимаем новую — иначе непонятно, что выбор ушёл.
        if (before !== null) await this.animateDrop(before);
        await this.animateLift(result.to);
        this.callbacks.onLift?.(result.species);
        this.refreshShelfStates();
        return;

      case 'reject':
        this.callbacks.onReject?.();
        await this.animateReject(result.to);
        return;

      case 'move':
        await this.animateMove(result);
        return;
    }
  }

  /** Подсветить подсказанный ход, не выполняя его. */
  async showHint(from: number, to: number): Promise<void> {
    const source = this.shelves[from];
    const target = this.shelves[to];
    if (!source || !target) return;
    source.setState('selected');
    target.setState('available');

    // Покачивание «в руке» на время подсказки выключается: иначе оно спорит с
    // подскоками за ту же координату и фигурка дёргается.
    const wasHeld = this.held;
    this.held = null;

    const piece = this.stacks[from][this.stacks[from].length - 1];
    if (piece) {
      const base = piece.sprite.y;
      // Три коротких подскока: заметно, но не задерживает игрока.
      for (let i = 0; i < 3; i++) {
        if (this.destroyed) return;
        await this.tweens.add({
          duration: 190,
          ease: easeOut,
          onUpdate: (t) => {
            piece.sprite.y = base - Math.sin(t * Math.PI) * this.metrics.slot * 0.3;
          },
        });
      }
      if (this.destroyed) return;
      piece.sprite.y = base;
    }

    // Целевая витрина коротко подпрыгивает — подсказка называет и «откуда», и
    // «куда», а подсветкой рамки одно от другого не отличить.
    void this.nudgeShelf(
      to,
      (t) => ({ dx: 0, dy: -Math.sin(t * Math.PI) * this.metrics.slot * 0.16 }),
      300
    );

    this.held = wasHeld;
    this.refreshShelfStates();
  }

  // --- Анимации ----------------------------------------------------------

  private async animateLift(shelf: number): Promise<void> {
    const stack = this.stacks[shelf];
    const piece = stack[stack.length - 1];
    if (!piece) return;
    this.held = null;
    this.shelves[shelf].setState('selected');
    // Поднятая фигурка должна быть выше всех остальных.
    this.piecesLayer.setChildIndex(piece.sprite, this.piecesLayer.children.length - 1);

    const from = { x: piece.sprite.x, y: piece.sprite.y };
    const to = this.liftPosition(shelf);
    await this.tweens.add({
      duration: 170,
      ease: easeOut,
      onUpdate: (t) => {
        piece.sprite.x = from.x + (to.x - from.x) * t;
        piece.sprite.y = from.y + (to.y - from.y) * t;
        // Небольшое увеличение — фигурка «ближе к игроку», в руке.
        this.applyPieceSizesTo(piece, 1 + (LIFT_SCALE - 1) * t);
      },
    });
    if (this.destroyed) return;
    this.applyPieceSizesTo(piece, LIFT_SCALE);
    piece.sprite.position.set(to.x, to.y);
    // С этого момента фигурка «в руке» и покачивается — см. update().
    this.held = { piece, baseY: to.y, phase: 0 };
  }

  private async animateDrop(shelf: number): Promise<void> {
    const stack = this.stacks[shelf];
    const piece = stack[stack.length - 1];
    if (!piece) return;
    this.held = null;
    this.shelves[shelf].setState('idle');
    const from = { x: piece.sprite.x, y: piece.sprite.y };
    const to = this.slotPosition(shelf, stack.length - 1);
    await this.tweens.add({
      duration: 180,
      ease: easeIn,
      onUpdate: (t) => {
        piece.sprite.x = from.x + (to.x - from.x) * t;
        piece.sprite.y = from.y + (to.y - from.y) * t;
        piece.sprite.rotation = 0;
        this.applyPieceSizesTo(piece, LIFT_SCALE + (1 - LIFT_SCALE) * t);
      },
    });
    if (this.destroyed) return;
    piece.sprite.position.set(to.x, to.y);
    this.applyPieceSizesTo(piece, 1);
  }

  /**
   * Сдвинуть витрину вместе с её содержимым.
   *
   * Фигурки лежат в отдельном слое и позиционируются в мировых координатах, а
   * не внутри витрины (иначе перелёт между витринами пришлось бы вести через
   * смену родителя посреди анимации). Значит, любой сдвиг витрины обязан
   * тащить за собой её стопку — иначе шкаф уезжает, а фигурки остаются висеть
   * на прежнем месте. Именно так и выглядела тряска при недопустимом ходе.
   */
  private async nudgeShelf(
    index: number,
    offset: (t: number) => { dx: number; dy: number },
    duration: number
  ): Promise<void> {
    const view = this.shelves[index];
    if (!view) return;
    const baseX = view.x;
    const baseY = view.y;
    const stack = this.stacks[index];
    const pieceBase = stack.map((p) => ({ x: p.sprite.x, y: p.sprite.y }));

    const restore = () => {
      view.position.set(baseX, baseY);
      stack.forEach((p, i) => {
        const base = pieceBase[i];
        if (base) p.sprite.position.set(base.x, base.y);
      });
    };

    await this.tweens.add({
      duration,
      onUpdate: (t) => {
        const { dx, dy } = offset(t);
        view.position.set(baseX + dx, baseY + dy);
        stack.forEach((p, i) => {
          const base = pieceBase[i];
          if (base) p.sprite.position.set(base.x + dx, base.y + dy);
        });
      },
    });
    if (this.destroyed) return;
    restore();
  }

  /** Отказ: витрина коротко дрожит по горизонтали — вместе с содержимым. */
  private async animateReject(shelf: number): Promise<void> {
    const amplitude = Math.max(5, this.metrics.slot * 0.13);
    await this.nudgeShelf(
      shelf,
      (t) => ({ dx: Math.sin(t * Math.PI * 4) * (1 - t) * amplitude, dy: 0 }),
      240
    );
  }

  private async animateMove(result: Extract<TapResult, { kind: 'move' }>): Promise<void> {
    this.busy = true;
    this.held = null;
    const { from, to, closed, moveNumber } = result.move;

    // Переносим спрайт между стеками синхронно с ядром.
    const piece = this.stacks[from].pop()!;
    const targetSlot = this.stacks[to].length;
    this.stacks[to].push(piece);

    this.shelves[from].setState('idle');
    // Летящая фигурка обязана быть поверх всех: между рядами она проходит
    // прямо над чужими витринами, и уход под их содержимое читается как
    // мигание.
    this.piecesLayer.setChildIndex(piece.sprite, this.piecesLayer.children.length - 1);

    const start = { x: piece.sprite.x, y: piece.sprite.y };
    const over = this.liftPosition(to);
    const land = this.slotPosition(to, targetSlot);

    // 1. Перелёт по дуге до точки над целевой витриной.
    //
    // Длительность считается от расстояния, а не берётся фиксированной.
    // Раньше и соседняя витрина, и витрина через весь экран пролетались за
    // одни и те же 190 мс: короткий ход выглядел вялым, а длинный — рывком.
    // При двухрядной раскладке на телефоне длинными оказываются почти все
    // ходы, поэтому там ломалось заметнее всего.
    const distance = Math.hypot(over.x - start.x, over.y - start.y);
    const flyMs = clamp(150 + distance * 0.42, 170, 340);
    // Дуга тоже в долях размера места, а не в абсолютных пикселях: на
    // маленьком поле дуга в 60 пикселей была выше самой витрины.
    const arcHeight = clamp(distance * 0.22, this.metrics.slot * 0.3, this.metrics.slot * 1.1);
    const tilt = clamp((over.x - start.x) / (this.metrics.width * 4), -0.2, 0.2);

    // В блице уровень сменяется потоком, и поле может быть уничтожено прямо
    // посреди анимации. После каждого ожидания проверяем, живы ли ещё —
    // иначе следующая строка обратится к разрушенному спрайту.
    if (this.destroyed) return;
    await this.tweens.add({
      duration: flyMs,
      ease: easeInOut,
      onUpdate: (t) => {
        piece.sprite.x = start.x + (over.x - start.x) * t;
        piece.sprite.y = start.y + (over.y - start.y) * t - Math.sin(t * Math.PI) * arcHeight;
        piece.sprite.rotation = Math.sin(t * Math.PI) * tilt;
      },
    });
    if (this.destroyed) return;
    piece.sprite.rotation = 0;

    // 2. Падение в паз.
    //
    // Здесь стояла кривая easeBack — перелёт с возвратом. На бумаге это
    // «магнит», на деле — перелёт считается в долях всего пути падения (от
    // точки над витриной до места), то есть фигурка проваливалась на десятки
    // пикселей НИЖЕ дна витрины и возвращалась обратно. Именно это читалось
    // как «фигурка проехала сквозь витрину». Ощущение защёлкивания даёт не
    // промах мимо паза, а разгон под конец падения и удар с приплющиванием:
    // фигурка приезжает ровно в паз и отыгрывает вес уже на месте.
    const dropMs = clamp(Math.abs(land.y - over.y) * 0.55, 130, 230);
    await this.tweens.add({
      duration: dropMs,
      ease: easeIn,
      onUpdate: (t) => {
        piece.sprite.x = over.x + (land.x - over.x) * t;
        piece.sprite.y = over.y + (land.y - over.y) * t;
        this.applyPieceSizesTo(piece, LIFT_SCALE + (1 - LIFT_SCALE) * t);
      },
    });
    if (this.destroyed) return;
    this.applyPieceSizesTo(piece, 1);
    piece.sprite.position.set(land.x, land.y);

    this.callbacks.onPlace?.(result.move.species);
    this.callbacks.onMove?.();
    const def = this.species[piece.species % this.species.length];
    const impact = this.toStage(land.x, land.y);
    this.particles.spark(impact.x, impact.y - this.metrics.slot * 0.3, def.colors.rim);
    // Кольцо в точке касания: показывает, куда именно приземлилась фигурка.
    this.rings.fire(impact.x, impact.y, def.colors.rim, this.metrics.width * 0.62, 340);

    // 3. Приплюснуться и отпружинить — вес фигурки.
    void this.squash(piece);

    if (closed) {
      await this.closeShelf(to, piece.species, moveNumber);
    }
    if (this.destroyed) return;

    this.busy = false;
    this.refreshShelfStates();

    if (this.board.isSolved) {
      this.callbacks.onSolved?.();
    } else if (this.board.isDeadlock) {
      this.callbacks.onDeadlock?.();
    }
  }

  private async squash(piece: Piece): Promise<void> {
    const { w, h } = this.frameSize();
    await this.tweens.add({
      duration: 300,
      ease: easeElastic,
      onUpdate: (t) => {
        // t идёт 0→1 с колебанием: в начале сплющено, к концу — норма.
        const squash = (1 - t) * 0.18;
        piece.sprite.setSize(w * (1 + squash), h * (1 - squash));
      },
    });
    if (this.destroyed) return;
    piece.sprite.setSize(w, h);
  }

  /** Витрина собрана: опускается стекло, проходит блик, летит салют. */
  private async closeShelf(shelf: number, species: Species, moveNumber: number): Promise<void> {
    const view = this.shelves[shelf];
    const def = this.species[species % this.species.length];

    // Комбо — по номерам ходов, а не по секундам: временное окно наказывало бы
    // игрока за лаги на слабом устройстве.
    if (moveNumber - this.lastCloseMove <= COMBO_WINDOW) this.comboLength += 1;
    else this.comboLength = 1;
    this.lastCloseMove = moveNumber;

    view.setState('locked');
    this.callbacks.onClose?.(shelf, species, this.comboLength);

    const centre = this.toStage(view.x, view.y - this.metrics.height * 0.55);
    this.particles.burst(
      centre.x,
      centre.y,
      [def.colors.base, def.colors.light, def.colors.rim],
      this.comboLength > 1 ? 34 : 24
    );
    // Кольцо во всю витрину: собранный сет должен «выстрелить», а не просто
    // накрыться стеклом.
    this.rings.fire(centre.x, centre.y, def.colors.rim, this.metrics.width * 1.6, 520);
    // Отдача: витрина оседает под весом последней фигурки и отпружинивает —
    // вместе с содержимым, иначе стопка осталась бы висеть в воздухе.
    void this.nudgeShelf(
      shelf,
      (t) => ({ dx: 0, dy: Math.sin(t * Math.PI) * (1 - t) * this.metrics.slot * 0.12 }),
      360
    );

    if (this.comboLength > 1) {
      this.callbacks.onCombo?.(this.comboLength, def.colors.rim);
    }

    // Стекло опускается, потом по нему пробегает блик.
    await this.tweens.add({
      duration: 240,
      ease: easeIn,
      onUpdate: (t) => view.setGlassDrop(t),
    });
    if (this.destroyed) return;
    void this.tweens.add({
      duration: 520,
      ease: easeOut,
      onUpdate: (t) => view.setShine(t),
      onComplete: () => view.setShine(2),
    });
  }

  /**
   * Всплывающее число над витриной. Зовётся снаружи: сколько именно очков и
   * секунд даёт закрытый сет, решает режим, а не поле.
   */
  popup(shelfIndex: number, text: string, color: string): void {
    const view = this.shelves[shelfIndex];
    if (!view) return;
    const at = this.toStage(view.x, view.y - this.metrics.height - this.metrics.slot * 0.3);
    this.popups.fire(at.x, at.y, text, color, {
      size: clamp(this.metrics.slot * 0.42, 16, 30),
    });
  }

  /** Бонус «+1 витрина» за rewarded: витрина въезжает, поле пересобирается. */
  async grantExtraShelf(): Promise<void> {
    const index = this.board.addShelf();
    this.addShelfView(index);
    this.layout(this.viewWidth, this.viewHeight);

    const view = this.shelves[index];
    const targetY = view.y;
    view.alpha = 0;
    await this.tweens.add({
      duration: 380,
      ease: easeBack,
      onUpdate: (t) => {
        view.alpha = Math.min(1, t * 1.6);
        view.y = targetY + (1 - t) * this.metrics.slot * 1.4;
      },
    });
    view.y = targetY;
    view.alpha = 1;
  }

  /** Отмена хода за rewarded. */
  async undo(): Promise<void> {
    if (this.busy) return;
    const undone = this.board.undo();
    if (!undone) return;
    this.busy = true;
    this.held = null;

    const piece = this.stacks[undone.to].pop()!;
    this.stacks[undone.from].push(piece);
    if (undone.closed) {
      this.shelves[undone.to].setGlassDrop(0);
      this.shelves[undone.to].setShine(2);
    }

    const start = { x: piece.sprite.x, y: piece.sprite.y };
    const land = this.slotPosition(undone.from, this.stacks[undone.from].length - 1);
    const distance = Math.hypot(land.x - start.x, land.y - start.y);
    const arc = clamp(distance * 0.26, this.metrics.slot * 0.35, this.metrics.slot * 1.2);
    this.piecesLayer.setChildIndex(piece.sprite, this.piecesLayer.children.length - 1);

    await this.tweens.add({
      duration: clamp(180 + distance * 0.42, 220, 380),
      ease: easeInOut,
      onUpdate: (t) => {
        piece.sprite.x = start.x + (land.x - start.x) * t;
        piece.sprite.y = start.y + (land.y - start.y) * t - Math.sin(t * Math.PI) * arc;
        piece.sprite.rotation = Math.sin(t * Math.PI) * -0.14;
      },
    });
    if (this.destroyed) return;
    piece.sprite.rotation = 0;
    piece.sprite.position.set(land.x, land.y);
    this.applyPieceSizesTo(piece, 1);
    void this.squash(piece);
    this.busy = false;
    this.refreshShelfStates();
  }

  private applyPieceSizesTo(piece: Piece, factor: number): void {
    const { w, h } = this.frameSize(factor);
    piece.sprite.setSize(w, h);
  }

  /** Пересчитать состояния витрин: что выбрано, куда можно положить. */
  private refreshShelfStates(): void {
    const selected = this.board.selected;
    for (let i = 0; i < this.shelves.length; i++) {
      if (this.board.locked[i]) {
        this.shelves[i].setState('locked');
      } else if (selected === i) {
        this.shelves[i].setState('selected');
      } else if (selected !== null && this.board.canMove(selected, i)) {
        // Подсветка «куда можно» — без неё игрок тапает наугад и быстро
        // набирает бессмысленные ходы, теряя звёзды на ровном месте.
        this.shelves[i].setState('available');
      } else {
        this.shelves[i].setState('idle');
      }
    }
  }

  /** dt в миллисекундах — гонит пульсацию витрин и покачивание фигурки в руке. */
  update(dt: number): void {
    for (const view of this.shelves) view.tick(dt);

    const held = this.held;
    if (held && !this.busy) {
      held.phase = (held.phase + dt / 1500) % 1;
      const wave = Math.sin(held.phase * Math.PI * 2);
      held.piece.sprite.y = held.baseY + wave * this.metrics.slot * 0.06;
      // Едва заметный крен в такт подъёму: фигурка «висит в руке», а не
      // ездит по вертикальной направляющей.
      held.piece.sprite.rotation = wave * 0.045;
    }
  }

  get isBusy(): boolean {
    return this.busy;
  }

  /**
   * Экранные центры витрин. Нужны смоук-тесту: он тапает по холсту реальными
   * координатами, а раскладка зависит от размера экрана и числа витрин.
   * Захардкоженные доли экрана в тесте ломались от любой правки раскладки и
   * при этом выглядели как поломка игры.
   */
  shelfPoints(): Array<{ x: number; y: number }> {
    return this.shelves.map((view) => ({
      x: this.x + view.x,
      y: this.y + view.y - this.metrics.height * 0.4,
    }));
  }
}
