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
import type { Particles } from './fx';
import { easeBack, easeElastic, easeIn, easeOut, type Tweens } from './tween';

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

export class BoardView extends Container {
  private readonly board: Board;
  private readonly species: FigurineDef[];
  private readonly theme: SeasonTheme;
  /** Конструкция витрин: приходит из надетого скина. */
  private readonly shelfStyle: ShelfStyle;
  private readonly tweens: Tweens;
  private readonly particles: Particles;
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

  constructor(opts: {
    board: Board;
    species: FigurineDef[];
    theme: SeasonTheme;
    shelfStyle: ShelfStyle;
    tweens: Tweens;
    particles: Particles;
    callbacks?: BoardCallbacks;
  }) {
    super();
    this.board = opts.board;
    this.species = opts.species;
    this.theme = opts.theme;
    this.shelfStyle = opts.shelfStyle;
    this.tweens = opts.tweens;
    this.particles = opts.particles;
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

    // В портрете два ряда выгоднее одного почти всегда: при пяти витринах в один
    // ряд размер места упирается в ширину экрана (~77 пикселей), поле занимает
    // меньше половины доступной высоты, и сверху остаётся большая пустота.
    // Два ряда по три дают и место крупнее, и заполненную вертикаль.
    const rows = portrait
      ? count <= 3
        ? 1
        : count <= 10
          ? 2
          : 3
      : count <= 7
        ? 1
        : 2;
    const perRow = Math.ceil(count / rows);

    // Подбираем высоту места так, чтобы всё влезло и по ширине, и по высоте.
    const capacity = this.board.capacity;
    const gapX = 8;
    const byWidth = (width - gapX * (perRow + 1)) / perRow / 0.94;
    const rowHeight = (h: number) => h * capacity + h * 0.32 + h * ROW_GAP_RATIO;
    let slot = Math.min(byWidth, height / rowHeight(1) / rows);
    slot = Math.max(26, Math.min(slot, 88));

    this.metrics = shelfMetrics(Math.round(slot), capacity);
    const shelfH = this.metrics.height;
    const rowStride = shelfH + slot * ROW_GAP_RATIO;
    const totalH = rowStride * rows - slot * ROW_GAP_RATIO;
    // Поле смещено вниз от центра: на телефоне витрины должны попадать в зону
    // большого пальца, а не в середину экрана, куда до них надо тянуться.
    // Наверху при этом остаётся воздух под HUD, и поле не выглядит прижатым.
    const startY = (height - totalH) * VERTICAL_BIAS + shelfH;

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
    this.refreshShelfStates();
  }

  private applyPieceSizes(): void {
    // Содержимое кадра должно занять почти всё место в витрине; остальное —
    // запас под свечение, он специально выходит за границы места.
    const contentH = this.metrics.slot * 0.9;
    const frameH = contentH / CONTENT_RATIO.h;
    const frameW = frameH * (132 / 150);
    for (const stack of this.stacks) {
      for (const piece of stack) {
        piece.sprite.setSize(frameW, frameH);
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
    source.setState('selected');
    target.setState('available');
    const piece = this.stacks[from][this.stacks[from].length - 1];
    if (piece) {
      const base = piece.sprite.y;
      // Три коротких подскока: заметно, но не задерживает игрока.
      for (let i = 0; i < 3; i++) {
        await this.tweens.add({
          duration: 190,
          ease: easeOut,
          onUpdate: (t) => {
            piece.sprite.y = base - Math.sin(t * Math.PI) * this.metrics.slot * 0.3;
          },
        });
      }
      piece.sprite.y = base;
    }
    this.refreshShelfStates();
  }

  // --- Анимации ----------------------------------------------------------

  private async animateLift(shelf: number): Promise<void> {
    const stack = this.stacks[shelf];
    const piece = stack[stack.length - 1];
    if (!piece) return;
    this.shelves[shelf].setState('selected');
    // Поднятая фигурка должна быть выше всех остальных.
    this.piecesLayer.setChildIndex(piece.sprite, this.piecesLayer.children.length - 1);

    const from = { x: piece.sprite.x, y: piece.sprite.y };
    const to = this.liftPosition(shelf);
    await this.tweens.add({
      duration: 150,
      ease: easeOut,
      onUpdate: (t) => {
        piece.sprite.x = from.x + (to.x - from.x) * t;
        piece.sprite.y = from.y + (to.y - from.y) * t;
        // Небольшое увеличение — фигурка «ближе к игроку», в руке.
        const s = 1 + 0.08 * t;
        piece.sprite.scale.set(piece.sprite.scale.x >= 0 ? s : -s, s);
      },
    });
    this.applyPieceSizesTo(piece, 1.08);
  }

  private async animateDrop(shelf: number): Promise<void> {
    const stack = this.stacks[shelf];
    const piece = stack[stack.length - 1];
    if (!piece) return;
    this.shelves[shelf].setState('idle');
    const from = { x: piece.sprite.x, y: piece.sprite.y };
    const to = this.slotPosition(shelf, stack.length - 1);
    await this.tweens.add({
      duration: 170,
      ease: easeIn,
      onUpdate: (t) => {
        piece.sprite.x = from.x + (to.x - from.x) * t;
        piece.sprite.y = from.y + (to.y - from.y) * t;
      },
    });
    this.applyPieceSizesTo(piece, 1);
  }

  /** Отказ: витрина коротко дрожит по горизонтали. */
  private async animateReject(shelf: number): Promise<void> {
    const view = this.shelves[shelf];
    const baseX = view.x;
    await this.tweens.add({
      duration: 220,
      onUpdate: (t) => {
        view.x = baseX + Math.sin(t * Math.PI * 4) * (1 - t) * 6;
      },
    });
    view.x = baseX;
  }

  private async animateMove(result: Extract<TapResult, { kind: 'move' }>): Promise<void> {
    this.busy = true;
    const { from, to, closed, moveNumber } = result.move;

    // Переносим спрайт между стеками синхронно с ядром.
    const piece = this.stacks[from].pop()!;
    const targetSlot = this.stacks[to].length;
    this.stacks[to].push(piece);

    this.shelves[from].setState('idle');
    const start = { x: piece.sprite.x, y: piece.sprite.y };
    const over = this.liftPosition(to);
    const land = this.slotPosition(to, targetSlot);

    // 1. Перелёт по дуге до точки над целевой витриной.
    const arcHeight = Math.min(60, Math.abs(over.x - start.x) * 0.35 + 18);
    // В блице уровень сменяется потоком, и поле может быть уничтожено прямо
    // посреди анимации. После каждого ожидания проверяем, живы ли ещё —
    // иначе следующая строка обратится к разрушенному спрайту.
    if (this.destroyed) return;
    await this.tweens.add({
      duration: 190,
      ease: easeOut,
      onUpdate: (t) => {
        piece.sprite.x = start.x + (over.x - start.x) * t;
        piece.sprite.y = start.y + (over.y - start.y) * t - Math.sin(t * Math.PI) * arcHeight;
        piece.sprite.rotation = Math.sin(t * Math.PI) * (over.x > start.x ? 0.16 : -0.16);
      },
    });
    if (this.destroyed) return;
    piece.sprite.rotation = 0;

    // 2. Падение в паз с перелётом — это и есть «магнит» из плана (§3).
    await this.tweens.add({
      duration: 190,
      ease: easeBack,
      onUpdate: (t) => {
        piece.sprite.x = over.x + (land.x - over.x) * t;
        piece.sprite.y = over.y + (land.y - over.y) * t;
      },
    });
    if (this.destroyed) return;
    this.applyPieceSizesTo(piece, 1);
    piece.sprite.position.set(land.x, land.y);

    this.callbacks.onPlace?.(result.move.species);
    this.callbacks.onMove?.();
    const def = this.species[piece.species % this.species.length];
    this.particles.spark(land.x, land.y - this.metrics.slot * 0.3, def.colors.rim);

    // 3. Приплюснуться и отпружинить — вес фигурки.
    void this.squash(piece);

    if (closed) {
      await this.closeShelf(to, piece.species, moveNumber);
    }

    this.busy = false;
    this.refreshShelfStates();

    if (this.board.isSolved) {
      this.callbacks.onSolved?.();
    } else if (this.board.isDeadlock) {
      this.callbacks.onDeadlock?.();
    }
  }

  private async squash(piece: Piece): Promise<void> {
    const contentH = this.metrics.slot * 0.9;
    const frameH = contentH / CONTENT_RATIO.h;
    const frameW = frameH * (132 / 150);
    await this.tweens.add({
      duration: 260,
      ease: easeElastic,
      onUpdate: (t) => {
        // t идёт 0→1 с колебанием: в начале сплющено, к концу — норма.
        const squash = (1 - t) * 0.16;
        piece.sprite.setSize(frameW * (1 + squash), frameH * (1 - squash));
      },
    });
    piece.sprite.setSize(frameW, frameH);
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

    this.particles.burst(
      view.x,
      view.y - this.metrics.height * 0.55,
      [def.colors.base, def.colors.light, def.colors.rim],
      this.comboLength > 1 ? 34 : 24
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

    const piece = this.stacks[undone.to].pop()!;
    this.stacks[undone.from].push(piece);
    if (undone.closed) this.shelves[undone.to].setGlassDrop(0);

    const start = { x: piece.sprite.x, y: piece.sprite.y };
    const land = this.slotPosition(undone.from, this.stacks[undone.from].length - 1);
    const arc = Math.min(70, Math.abs(land.x - start.x) * 0.4 + 24);
    this.piecesLayer.setChildIndex(piece.sprite, this.piecesLayer.children.length - 1);

    await this.tweens.add({
      duration: 300,
      ease: easeOut,
      onUpdate: (t) => {
        piece.sprite.x = start.x + (land.x - start.x) * t;
        piece.sprite.y = start.y + (land.y - start.y) * t - Math.sin(t * Math.PI) * arc;
      },
    });
    piece.sprite.position.set(land.x, land.y);
    this.busy = false;
    this.refreshShelfStates();
  }

  private applyPieceSizesTo(piece: Piece, factor: number): void {
    const contentH = this.metrics.slot * 0.9 * factor;
    const frameH = contentH / CONTENT_RATIO.h;
    piece.sprite.setSize(frameH * (132 / 150), frameH);
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

  /** dt в миллисекундах — гонит пульсацию доступных витрин. */
  update(dt: number): void {
    for (const view of this.shelves) view.tick(dt);
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
