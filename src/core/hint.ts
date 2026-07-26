import { Board } from './board';

/**
 * Подсказка «какой ход сделать» — бонус за rewarded (см. план, §8).
 *
 * Сохранять путь решения в JSON уровня бесполезно: игрок почти сразу уходит
 * с оптимальной траектории, и заготовленный путь становится неприменим.
 * Поэтому поиск идёт в рантайме от ТЕКУЩЕГО состояния.
 *
 * Алгоритм — IDA* с эвристикой «сколько фигурок обязаны сдвинуться хотя бы
 * раз». Эвристика допустимая (один ход перемещает ровно одну фигурку), так
 * что при полном обходе найденный путь оптимален. Поиск ограничен бюджетом
 * узлов: на поле 12×4 полный обход может быть дорогим, а подсказка обязана
 * возвращаться мгновенно — если бюджет исчерпан, отдаём эвристически лучший
 * ход. Он не гарантированно оптимален, но всегда осмыслен.
 */

export interface Hint {
  from: number;
  to: number;
  /** true — ход лежит на доказанно решающем пути; false — эвристический. */
  optimal: boolean;
}

const NODE_BUDGET = 120_000;
const MAX_THRESHOLD = 80;

/**
 * Число фигурок, которые обязаны сдвинуться хотя бы раз: всё, что лежит
 * выше нижнего однородного слоя витрины. Никогда не переоценивает
 * оставшееся число ходов.
 */
function heuristic(shelves: number[][]): number {
  let h = 0;
  for (const shelf of shelves) {
    if (shelf.length === 0) continue;
    let run = 1;
    while (run < shelf.length && shelf[run] === shelf[0]) run++;
    h += shelf.length - run;
  }
  return h;
}

interface SearchState {
  shelves: number[][];
  capacity: number;
  speciesCount: number;
}

function isSolved(s: SearchState): boolean {
  for (const shelf of s.shelves) {
    if (shelf.length === 0) continue;
    if (shelf.length !== s.capacity) return false;
    for (let i = 1; i < shelf.length; i++) if (shelf[i] !== shelf[0]) return false;
  }
  return true;
}

/** Витрина закрыта стеклом: полна и однородна — брать из неё нельзя. */
function isLocked(shelf: number[], capacity: number): boolean {
  if (shelf.length !== capacity) return false;
  for (let i = 1; i < shelf.length; i++) if (shelf[i] !== shelf[0]) return false;
  return true;
}

function legalMoves(s: SearchState): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const n = s.shelves.length;
  // Пустые витрины взаимозаменяемы — рассматриваем только первую из них,
  // иначе поиск размножает эквивалентные ветки.
  let firstEmpty = -1;
  for (let i = 0; i < n; i++) {
    if (s.shelves[i].length === 0) {
      firstEmpty = i;
      break;
    }
  }
  for (let from = 0; from < n; from++) {
    const src = s.shelves[from];
    if (src.length === 0 || isLocked(src, s.capacity)) continue;
    // Разбирать однородную витрину, стоящую на своём месте, бессмысленно.
    const homogeneous = src.every((x) => x === src[0]);
    const species = src[src.length - 1];
    for (let to = 0; to < n; to++) {
      if (to === from) continue;
      const dst = s.shelves[to];
      if (dst.length >= s.capacity) continue;
      if (isLocked(dst, s.capacity)) continue;
      if (dst.length === 0) {
        if (to !== firstEmpty) continue;
        // Переставлять однородную витрину в пустую — чистая потеря хода.
        if (homogeneous) continue;
        out.push([from, to]);
      } else if (dst[dst.length - 1] === species) {
        out.push([from, to]);
      }
    }
  }
  // Сначала ходы, которые дособирают витрину: и поиск быстрее, и
  // эвристический fallback осмысленнее.
  out.sort((a, b) => moveScore(s, b) - moveScore(s, a));
  return out;
}

/** Насколько ход выглядит полезным — для сортировки ветвей и для fallback. */
function moveScore(s: SearchState, [from, to]: [number, number]): number {
  const src = s.shelves[from];
  const dst = s.shelves[to];
  const species = src[src.length - 1];
  let score = 0;
  // Закрывает витрину прямо сейчас.
  if (dst.length + 1 === s.capacity && dst.every((x) => x === species)) score += 100;
  // Кладём на такой же вид — всегда лучше, чем занимать пустую витрину.
  if (dst.length > 0 && dst[dst.length - 1] === species) score += 30;
  // Освобождает витрину полностью.
  if (src.length === 1) score += 20;
  // Снимает фигурку с чужой однородной кладки.
  if (src.length > 1 && src[src.length - 2] !== species) score += 10;
  // Занимать пустую витрину — крайняя мера.
  if (dst.length === 0) score -= 15;
  return score;
}

/**
 * Найти следующий ход. `timeBudgetMs` ограничивает поиск сверху — подсказка
 * не должна ощущаться как подвисание.
 */
export function findHint(board: Board, timeBudgetMs = 80): Hint | null {
  const state: SearchState = {
    shelves: board.shelves.map((s) => s.slice()),
    capacity: board.capacity,
    speciesCount: board.speciesCount,
  };
  if (isSolved(state)) return null;

  const initial = legalMoves(state);
  if (initial.length === 0) return null;

  const deadline = Date.now() + timeBudgetMs;
  let nodes = 0;
  let exhausted = false;

  // path хранит только первый ход ветки — больше для подсказки не нужно.
  const seen = new Set<string>();

  function key(s: SearchState): string {
    return s.shelves
      .map((x) => x.join(','))
      .sort()
      .join('|');
  }

  function dfs(s: SearchState, g: number, threshold: number): boolean {
    const h = heuristic(s.shelves);
    if (g + h > threshold) return false;
    if (isSolved(s)) return true;
    if (++nodes > NODE_BUDGET || Date.now() > deadline) {
      exhausted = true;
      return false;
    }
    for (const [from, to] of legalMoves(s)) {
      const species = s.shelves[from].pop()!;
      s.shelves[to].push(species);
      const k = key(s);
      let ok = false;
      if (!seen.has(k)) {
        seen.add(k);
        ok = dfs(s, g + 1, threshold);
        // Ключи не снимаем: в задаче о сортировке повторный приход в то же
        // состояние на большей глубине никогда не выгоден.
      }
      s.shelves[to].pop();
      s.shelves[from].push(species);
      if (ok) return true;
      if (exhausted) return false;
    }
    return false;
  }

  for (let threshold = heuristic(state.shelves); threshold <= MAX_THRESHOLD; threshold++) {
    for (const [from, to] of initial) {
      const species = state.shelves[from].pop()!;
      state.shelves[to].push(species);
      seen.clear();
      seen.add(key(state));
      const solved = dfs(state, 1, threshold);
      state.shelves[to].pop();
      state.shelves[from].push(species);
      if (solved) return { from, to, optimal: true };
      if (exhausted) break;
    }
    if (exhausted) break;
  }

  // Бюджет исчерпан — отдаём лучший ход по эвристике.
  const best = initial[0];
  return { from: best[0], to: best[1], optimal: false };
}
