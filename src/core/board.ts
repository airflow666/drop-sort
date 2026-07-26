import type { AppliedMove, LevelSpec, Shelf, Species, TapResult } from './types';

/**
 * Состояние поля и правила сортировки.
 *
 * Правила (см. план, §3):
 *  1. Тап по витрине поднимает верхнюю фигурку.
 *  2. Тап по другой витрине кладёт её, если сверху лежит такой же вид или
 *     витрина пуста. Один тап переносит РОВНО одну фигурку.
 *  3. Витрина, целиком заполненная одним видом, закрывается стеклом
 *     (`locked`) — из неё больше нельзя брать.
 *  4. Уровень пройден, когда закрыты все витрины по числу видов.
 */
export class Board {
  readonly capacity: number;
  readonly speciesCount: number;

  /** Витрины снизу вверх. Длина может вырасти от бонуса «+1 витрина». */
  shelves: Shelf[];
  /** Закрытые стеклом витрины. Индексы совпадают с shelves. */
  locked: boolean[];
  /** Индекс витрины, с которой поднята фигурка, либо null. */
  selected: number | null = null;
  /** Совершённых ходов. Отмена уменьшает счётчик — игрок видит честное число. */
  moves = 0;
  /** Сколько раз применяли бонус «+1 витрина». */
  extraShelves = 0;

  private readonly history: AppliedMove[] = [];

  constructor(spec: LevelSpec) {
    this.capacity = spec.capacity;
    this.speciesCount = spec.speciesCount;
    this.shelves = spec.shelves.map((s) => s.slice());
    this.locked = this.shelves.map(() => false);
    // Уровень может прийти из генератора с уже собранной витриной — закрываем
    // её сразу, чтобы правила не зависели от того, как уровень попал в игру.
    this.shelves.forEach((_, i) => this.lockIfComplete(i));
  }

  // --- Запросы -----------------------------------------------------------

  get shelfCount(): number {
    return this.shelves.length;
  }

  /** Вид поднятой фигурки, либо null если ничего не поднято. */
  get heldSpecies(): Species | null {
    if (this.selected === null) return null;
    const shelf = this.shelves[this.selected];
    return shelf.length ? shelf[shelf.length - 1] : null;
  }

  top(index: number): Species | null {
    const shelf = this.shelves[index];
    return shelf && shelf.length ? shelf[shelf.length - 1] : null;
  }

  isFull(index: number): boolean {
    return this.shelves[index].length >= this.capacity;
  }

  /** Закрытых стеклом витрин — по нему считается прогресс уровня. */
  get closedCount(): number {
    return this.locked.reduce((n, l) => n + (l ? 1 : 0), 0);
  }

  get isSolved(): boolean {
    return this.closedCount >= this.speciesCount;
  }

  get canUndo(): boolean {
    return this.history.length > 0;
  }

  /** Ход `from` → `to` допустим по правилам. */
  canMove(from: number, to: number): boolean {
    if (from === to) return false;
    if (!this.shelves[from] || !this.shelves[to]) return false;
    if (this.locked[from] || this.locked[to]) return false;
    if (this.shelves[from].length === 0) return false;
    if (this.isFull(to)) return false;
    const dest = this.top(to);
    return dest === null || dest === this.top(from);
  }

  /**
   * Есть ли хоть один допустимый ход. Тупик (`false`) — единственный
   * корректный момент для предложения «+1 витрина» (см. план, §10):
   * предложение по таймеру убивает конверсию rewarded.
   */
  hasAnyMove(): boolean {
    for (let from = 0; from < this.shelves.length; from++) {
      if (this.locked[from] || this.shelves[from].length === 0) continue;
      for (let to = 0; to < this.shelves.length; to++) {
        if (this.canMove(from, to)) return true;
      }
    }
    return false;
  }

  get isDeadlock(): boolean {
    return !this.isSolved && !this.hasAnyMove();
  }

  // --- Ввод --------------------------------------------------------------

  /**
   * Единственная точка ввода: игрок тапнул по витрине `index`.
   * Возвращает описание произошедшего — рендер по нему строит анимацию.
   */
  tap(index: number): TapResult {
    const shelf = this.shelves[index];
    if (!shelf) return { kind: 'ignored' };

    // Ничего не поднято — пытаемся поднять.
    if (this.selected === null) {
      if (this.locked[index]) return { kind: 'ignored' };
      if (shelf.length === 0) return { kind: 'ignored' };
      this.selected = index;
      return { kind: 'lift', from: index, species: shelf[shelf.length - 1] };
    }

    const from = this.selected;
    const species = this.top(from)!;

    // Повторный тап по той же витрине — отмена подъёма.
    if (from === index) {
      this.selected = null;
      return { kind: 'cancel', from, species };
    }

    if (this.canMove(from, index)) {
      this.selected = null;
      return { kind: 'move', move: this.applyMove(from, index) };
    }

    // Ход невозможен. Если в целевой витрине есть что поднять — это почти
    // всегда означает, что игрок передумал и выбирает новую витрину, а не
    // ошибся. Молча переносим выбор: так меньше «мёртвых» тапов.
    if (!this.locked[index] && shelf.length > 0) {
      this.selected = index;
      return { kind: 'reselect', from, to: index, species: shelf[shelf.length - 1] };
    }

    const reason = this.locked[index] ? 'locked' : this.isFull(index) ? 'full' : 'mismatch';
    return { kind: 'reject', from, to: index, reason };
  }

  /** Снять выбор (например, при открытии оверлея). */
  clearSelection(): void {
    this.selected = null;
  }

  // --- Мутации -----------------------------------------------------------

  /** Применить ход без проверок вызывающей стороной. Используется и в tap, и в солвере подсказок. */
  private applyMove(from: number, to: number): AppliedMove {
    const species = this.shelves[from].pop()!;
    this.shelves[to].push(species);
    this.moves += 1;
    const closed = this.lockIfComplete(to);
    const move: AppliedMove = { from, to, species, closed, moveNumber: this.moves };
    this.history.push(move);
    return move;
  }

  /**
   * Отменить последний ход (бонус за rewarded «Отмена хода»).
   * Возвращает отменённый ход или null, если история пуста.
   */
  undo(): AppliedMove | null {
    const last = this.history.pop();
    if (!last) return null;
    if (last.closed) this.locked[last.to] = false;
    const species = this.shelves[last.to].pop()!;
    this.shelves[last.from].push(species);
    this.moves = Math.max(0, this.moves - 1);
    this.selected = null;
    return last;
  }

  /**
   * Бонус «+1 свободная витрина» за rewarded. Добавляет пустую витрину
   * в конец. Главный источник показов по плану (§8), поэтому он обязан
   * гарантированно расшивать тупик — пустая витрина всегда даёт ход.
   */
  addShelf(): number {
    this.shelves.push([]);
    this.locked.push(false);
    this.extraShelves += 1;
    return this.shelves.length - 1;
  }

  /** Закрыть витрину стеклом, если она заполнена одним видом. */
  private lockIfComplete(index: number): boolean {
    if (this.locked[index]) return false;
    const shelf = this.shelves[index];
    if (shelf.length !== this.capacity) return false;
    const first = shelf[0];
    for (let i = 1; i < shelf.length; i++) {
      if (shelf[i] !== first) return false;
    }
    this.locked[index] = true;
    return true;
  }

  // --- Сериализация ------------------------------------------------------

  /** Компактный снимок для сохранения партии через ysdk.player. */
  serialize(): BoardSnapshot {
    return {
      shelves: this.shelves.map((s) => s.slice()),
      moves: this.moves,
      extraShelves: this.extraShelves,
      capacity: this.capacity,
      speciesCount: this.speciesCount,
    };
  }

  /** Восстановить партию из снимка. История отмены не переживает перезагрузку. */
  static restore(snap: BoardSnapshot): Board {
    const board = new Board({
      id: 'restored',
      seed: 0,
      shelves: snap.shelves,
      capacity: snap.capacity,
      speciesCount: snap.speciesCount,
      minMoves: 0,
    });
    board.moves = snap.moves;
    board.extraShelves = snap.extraShelves ?? 0;
    return board;
  }

  /** Ключ состояния для солвера и детекции повторов. */
  key(): string {
    // Витрины взаимозаменяемы: одно и то же по смыслу состояние с
    // переставленными витринами — один ключ. Это сильно сокращает поиск.
    return this.shelves
      .map((s) => s.join(','))
      .sort()
      .join('|');
  }

}

export interface BoardSnapshot {
  shelves: Species[][];
  moves: number;
  extraShelves: number;
  capacity: number;
  speciesCount: number;
}
