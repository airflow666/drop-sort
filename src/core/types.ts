/**
 * Типы ядра сортировки.
 *
 * Ядро не знает ничего о графике, звуке и платформе: только состояние поля,
 * правила и валидация. Благодаря этому оно тестируется без браузера, а скин
 * меняется без правок логики (см. README, раздел «Архитектура»).
 */

/** Вид фигурки — индекс в палитре уровня, 0..speciesCount-1. */
export type Species = number;

/** Витрина: снизу вверх. shelves[i][0] — самая нижняя фигурка. */
export type Shelf = Species[];

/** Уровень как он лежит в JSON-паке (см. tools/generate_levels.py). */
export interface LevelSpec {
  /** Стабильный идентификатор: `${pack}-${index}`. */
  id: string;
  /** Сид генератора — уровень воспроизводим по нему. */
  seed: number;
  /** Начальное состояние витрин, снизу вверх. */
  shelves: Shelf[];
  /** Сколько фигурок вмещает одна витрина. */
  capacity: number;
  /** Число различных видов фигурок. Равно числу непустых витрин в решении. */
  speciesCount: number;
  /** Минимальное число ходов по солверу — база для расчёта звёзд. */
  minMoves: number;
}

/** Что произошло в ответ на тап — рендер по этому строит анимацию. */
export type TapResult =
  /** Тап в пустоту/по заблокированной витрине — ничего не изменилось. */
  | { kind: 'ignored' }
  /** Подняли верхнюю фигурку витрины `from`. */
  | { kind: 'lift'; from: number; species: Species }
  /** Отменили подъём, фигурка вернулась на место. */
  | { kind: 'cancel'; from: number; species: Species }
  /** Перенесли выбор на другую витрину, не сделав хода. */
  | { kind: 'reselect'; from: number; to: number; species: Species }
  /** Ход состоялся. */
  | { kind: 'move'; move: AppliedMove }
  /** Ход невозможен: сверху другой вид или витрина полна. */
  | { kind: 'reject'; from: number; to: number; reason: RejectReason };

export type RejectReason = 'full' | 'mismatch' | 'locked';

/** Совершённый ход — хранится в стеке отмены. */
export interface AppliedMove {
  from: number;
  to: number;
  species: Species;
  /** Витрина `to` закрылась стеклом именно этим ходом (нужно для undo). */
  closed: boolean;
  /**
   * Номер хода по счёту, начиная с 1. Комбо считается по разнице номеров
   * ходов между двумя закрытиями, а не по времени: так оно честное и на
   * медленном устройстве.
   */
  moveNumber: number;
}
