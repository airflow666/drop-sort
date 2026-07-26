"""
Правила сортировки и солвер — общая библиотека для генератора и тестов.

Правила ОБЯЗАНЫ совпадать с TypeScript-ядром (src/core/board.ts):
один ход переносит ровно одну фигурку; витрина, заполненная одним видом
целиком, закрывается стеклом и больше не может быть источником. Если эти
две реализации разойдутся, minMoves в паках станет ложью, и звёзды в игре
перестанут быть достижимыми. На этот случай есть tools/test_generator.py.

Состояние — кортеж кортежей: shelves[i] снизу вверх.
"""

from __future__ import annotations

import heapq
from typing import Iterator

State = tuple[tuple[int, ...], ...]


def canonical(state: State) -> State:
    """Витрины взаимозаменяемы — сортировка даёт единственное представление."""
    return tuple(sorted(state))


def is_locked(shelf: tuple[int, ...], capacity: int) -> bool:
    """Витрина закрыта стеклом: полна и однородна."""
    return len(shelf) == capacity and len(set(shelf)) == 1


def is_solved(state: State, capacity: int) -> bool:
    for shelf in state:
        if not shelf:
            continue
        if len(shelf) != capacity or len(set(shelf)) != 1:
            return False
    return True


def legal_moves(state: State, capacity: int, *, prune: bool = True) -> Iterator[tuple[int, int]]:
    """
    Допустимые ходы (from, to).

    prune=True включает две отсечки, которые не теряют оптимальных решений:
      * из нескольких пустых витрин рассматривается только первая — остальные
        дают состояния, эквивалентные с точностью до перестановки витрин;
      * однородную витрину не разбирают в пустую: это лишь дробит уже
        собранную группу, и всё, что после этого возможно, достижимо дешевле.
    """
    n = len(state)
    first_empty = -1
    if prune:
        for i in range(n):
            if not state[i]:
                first_empty = i
                break

    for src in range(n):
        shelf = state[src]
        if not shelf or is_locked(shelf, capacity):
            continue
        species = shelf[-1]
        homogeneous = len(set(shelf)) == 1
        for dst in range(n):
            if dst == src:
                continue
            target = state[dst]
            if len(target) >= capacity:
                continue
            if not target:
                if prune and (dst != first_empty or homogeneous):
                    continue
                yield (src, dst)
            elif target[-1] == species:
                yield (src, dst)


def apply_move(state: State, src: int, dst: int) -> State:
    shelves = list(state)
    moved = shelves[src][-1]
    shelves[src] = shelves[src][:-1]
    shelves[dst] = shelves[dst] + (moved,)
    return tuple(shelves)


def heuristic(state: State) -> int:
    """
    Допустимая оценка снизу на число оставшихся ходов.

    Максимум двух независимых нижних границ (каждая считает фигурки, которые
    обязаны сдвинуться хотя бы раз, — а один ход двигает ровно одну):

      h_above  — всё, что лежит выше нижнего однородного слоя витрины;
      h_split  — для каждого вида: все его фигурки, кроме лежащих в витрине,
                 где их больше всего (эта витрина может стать целевой).
    """
    h_above = 0
    counts: dict[int, dict[int, int]] = {}
    for idx, shelf in enumerate(state):
        if not shelf:
            continue
        run = 1
        while run < len(shelf) and shelf[run] == shelf[0]:
            run += 1
        h_above += len(shelf) - run
        for species in shelf:
            counts.setdefault(species, {})
            counts[species][idx] = counts[species].get(idx, 0) + 1

    h_split = 0
    for per_shelf in counts.values():
        total = sum(per_shelf.values())
        h_split += total - max(per_shelf.values())

    return max(h_above, h_split)


class SolverBudgetExceeded(Exception):
    """Поиск не уложился в бюджет узлов — уровень отбрасывается, а не принимается на веру."""


def solve_min_moves(
    state: State,
    capacity: int,
    *,
    node_budget: int = 400_000,
    max_moves: int = 60,
) -> int | None:
    """
    Точное минимальное число ходов методом A* с допустимой эвристикой.

    Возвращает:
      int   — найденный оптимум;
      None  — состояние нерешаемо (в пределах max_moves).
    Бросает SolverBudgetExceeded, если исчерпан бюджет узлов: тогда мы НЕ знаем
    точного minMoves и не имеем права записать уровень в пак.
    """
    start = canonical(state)
    if is_solved(start, capacity):
        return 0

    # (f, g, state); tie-break по g не нужен — heapq сравнит кортежи состояний.
    heap: list[tuple[int, int, State]] = [(heuristic(start), 0, start)]
    best_g: dict[State, int] = {start: 0}
    nodes = 0

    while heap:
        f, g, current = heapq.heappop(heap)
        if f > max_moves:
            # Все оставшиеся варианты не дешевле — дальше смысла нет.
            return None
        if best_g.get(current, -1) < g:
            continue
        if is_solved(current, capacity):
            return g

        nodes += 1
        if nodes > node_budget:
            raise SolverBudgetExceeded(f'{nodes} узлов, g={g}')

        for src, dst in legal_moves(current, capacity):
            nxt = canonical(apply_move(current, src, dst))
            ng = g + 1
            if ng >= best_g.get(nxt, 1 << 30):
                continue
            nh = heuristic(nxt)
            if ng + nh > max_moves:
                continue
            best_g[nxt] = ng
            heapq.heappush(heap, (ng + nh, ng, nxt))

    return None


def greedy_solution_length(state: State, capacity: int, limit: int = 400) -> int | None:
    """
    Длина решения жадным спуском — быстрая проверка «решаемо вообще».
    Используется как дешёвый фильтр перед дорогим A*.
    """
    current = state
    moves = 0
    while moves < limit:
        if is_solved(current, capacity):
            return moves
        best: tuple[int, tuple[int, int]] | None = None
        for src, dst in legal_moves(current, capacity):
            shelf, target = current[src], current[dst]
            species = shelf[-1]
            score = 0
            if len(target) + 1 == capacity and all(x == species for x in target):
                score += 100
            if target and target[-1] == species:
                score += 30
            if len(shelf) == 1:
                score += 20
            if len(shelf) > 1 and shelf[-2] != species:
                score += 10
            if not target:
                score -= 15
            if best is None or score > best[0]:
                best = (score, (src, dst))
        if best is None:
            return None
        current = apply_move(current, *best[1])
        moves += 1
    return None
