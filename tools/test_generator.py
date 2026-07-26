#!/usr/bin/env python3
"""
Тесты солвера и генератора. Запуск: python3 tools/test_generator.py

Самое важное здесь — не «солвер работает», а две вещи, ошибка в которых
тихо портит игру:

  * A* находит именно ОПТИМУМ (сверяется с полным обходом в ширину на
    маленьких задачах). Если minMoves завышен, три звезды становятся
    недостижимыми, и игрок это чувствует, но не понимает причины.
  * Правила в Python и в TypeScript-ядре совпадают. Для этого тест
    выгружает набор состояний с эталонными списками допустимых ходов в
    test/fixtures/parity.json, а тест ядра (test/core.test.ts) сверяется
    с ними. Разъехавшиеся реализации — это неверный minMoves во всех паках.
"""

from __future__ import annotations

import json
import random
import sys
from collections import deque
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from generate_levels import CAPACITY, deal, encode, move_corridor, tier_for  # noqa: E402
from sortlib import (  # noqa: E402
    State,
    apply_move,
    canonical,
    heuristic,
    is_locked,
    is_solved,
    legal_moves,
    solve_min_moves,
)

passed = 0
failed = 0
failures: list[str] = []


def check(name: str, condition: bool, detail: str = '') -> None:
    global passed, failed
    if condition:
        passed += 1
        print(f'  ✓ {name}')
    else:
        failed += 1
        failures.append(f'{name}' + (f'\n    {detail}' if detail else ''))
        print(f'  ✗ {name}')


def group(name: str) -> None:
    print(f'\n{name}')


def bfs_min_moves(state: State, capacity: int, limit: int = 40) -> int | None:
    """Эталон: полный обход в ширину. Медленно, но заведомо оптимально."""
    start = canonical(state)
    if is_solved(start, capacity):
        return 0
    seen = {start}
    queue = deque([(start, 0)])
    while queue:
        current, dist = queue.popleft()
        if dist >= limit:
            continue
        for src, dst in legal_moves(current, capacity, prune=False):
            nxt = canonical(apply_move(current, src, dst))
            if nxt in seen:
                continue
            if is_solved(nxt, capacity):
                return dist + 1
            seen.add(nxt)
            queue.append((nxt, dist + 1))
    return None


# ---------------------------------------------------------------------------
group('Солвер: оптимальность')

rng = random.Random(4242)
mismatches: list[str] = []
compared = 0
for _ in range(120):
    species = rng.choice([2, 3])
    free = rng.choice([1, 2])
    capacity = rng.choice([2, 3])
    bag = [s for s in range(species) for _ in range(capacity)]
    rng.shuffle(bag)
    shelves = [tuple(bag[i * capacity : (i + 1) * capacity]) for i in range(species)]
    state = tuple(shelves + [()] * free)
    reference = bfs_min_moves(state, capacity)
    astar = solve_min_moves(state, capacity, max_moves=40)
    compared += 1
    if reference != astar:
        mismatches.append(f'{state} cap={capacity}: BFS={reference} A*={astar}')

check(
    f'A* совпадает с полным обходом на {compared} случайных задачах',
    not mismatches,
    '\n    '.join(mismatches[:5]),
)

# ---------------------------------------------------------------------------
group('Эвристика: допустимость')

overestimates: list[str] = []
sampled = 0
rng = random.Random(99)
for _ in range(150):
    species = rng.choice([2, 3])
    capacity = 3
    bag = [s for s in range(species) for _ in range(capacity)]
    rng.shuffle(bag)
    shelves = [tuple(bag[i * capacity : (i + 1) * capacity]) for i in range(species)]
    state = tuple(shelves + [()] * rng.choice([1, 2]))
    # Проверяем не только старт, но и состояния по ходу решения.
    for _step in range(4):
        truth = solve_min_moves(state, capacity, max_moves=40)
        if truth is None:
            break
        sampled += 1
        if heuristic(state) > truth:
            overestimates.append(f'{state}: h={heuristic(state)} > оптимум={truth}')
        moves = list(legal_moves(state, capacity))
        if not moves:
            break
        state = apply_move(state, *rng.choice(moves))

check(
    f'эвристика никогда не переоценивает остаток ({sampled} состояний)',
    not overestimates,
    '\n    '.join(overestimates[:5]),
)

# ---------------------------------------------------------------------------
group('Правила: закрытие витрин')

check(
    'полная однородная витрина закрыта',
    is_locked((1, 1, 1, 1), 4) and not is_locked((1, 1, 1), 4) and not is_locked((1, 1, 2, 1), 4),
)
check(
    'из закрытой витрины нет ходов',
    not any(src == 0 for src, _ in legal_moves(((2, 2, 2, 2), (1,), ()), 4, prune=False)),
)
check(
    'в закрытую витрину нет ходов',
    not any(dst == 0 for _, dst in legal_moves(((2, 2, 2, 2), (1,), ()), 4, prune=False)),
)
check(
    'решённое поле распознаётся',
    is_solved(((0, 0, 0, 0), (1, 1, 1, 1), ()), 4)
    and not is_solved(((0, 0, 0, 1), (1, 1, 1, 0), ()), 4),
)
check(
    'тупик: ходов нет, но и не решено',
    not list(legal_moves(((0, 1, 0, 1), (1, 0, 1, 0)), 4, prune=False))
    and not is_solved(((0, 1, 0, 1), (1, 0, 1, 0)), 4),
)

# ---------------------------------------------------------------------------
group('Отсечки поиска не теряют оптимум')

# prune=True отбрасывает ветки; оптимум обязан сохраниться.
prune_mismatches: list[str] = []
rng = random.Random(555)
for _ in range(60):
    species = rng.choice([2, 3])
    capacity = 3
    bag = [s for s in range(species) for _ in range(capacity)]
    rng.shuffle(bag)
    shelves = [tuple(bag[i * capacity : (i + 1) * capacity]) for i in range(species)]
    state = tuple(shelves + [()] * 2)
    with_prune = solve_min_moves(state, capacity, max_moves=40)
    reference = bfs_min_moves(state, capacity)
    if with_prune != reference:
        prune_mismatches.append(f'{state}: с отсечками={with_prune} без={reference}')

check(
    'оптимум одинаков с отсечками и без',
    not prune_mismatches,
    '\n    '.join(prune_mismatches[:5]),
)

# ---------------------------------------------------------------------------
group('Генератор: коридоры сложности')

check('коридор растёт с числом видов', move_corridor(3, 2)[1] < move_corridor(8, 2)[1])
check('одна свободная витрина сдвигает коридор вверх', move_corridor(7, 1)[0] > move_corridor(7, 2)[0])
check(
    'разгрузочный коридор ниже обычного',
    move_corridor(5, 2, relief=True)[1] < move_corridor(5, 2)[1],
)
check('коридор не выходит за 60 ходов', all(move_corridor(s, 1)[1] <= 60 for s in range(3, 9)))
check(
    'кривая сложности покрывает номера уровней без разрывов',
    [tier_for(i).name for i in (1, 20, 21, 80, 81, 200, 201, 500, 501, 2000)]
    == ['intro', 'intro', 'early', 'early', 'mid', 'mid', 'late', 'late', 'expert', 'expert'],
)

check(
    'раздача даёт ровно заявленное число пустых витрин',
    all(
        sum(1 for shelf in deal(species, free, random.Random(i)) if not shelf) == free
        for i, (species, free) in enumerate([(3, 2), (5, 2), (8, 1), (7, 1)])
    ),
)
check('кодирование витрин обратимо на глаз', encode(((0, 1), (), (2,))) == '01||2')

# ---------------------------------------------------------------------------
group('Собранный пак')

pack_path = Path(__file__).parent.parent / 'src' / 'levels' / 'packs.json'
if not pack_path.exists():
    print('  — packs.json ещё не собран, проверка пропущена (npm run levels)')
else:
    payload = json.loads(pack_path.read_text(encoding='utf-8'))
    capacity = payload['capacity']
    problems: list[str] = []
    total = 0

    for pack_name, levels in payload['packs'].items():
        for idx, lvl in enumerate(levels):
            total += 1
            shelves = tuple(tuple(int(c) for c in part) for part in lvl['s'].split('|'))
            where = f'{pack_name}[{idx}]'

            counts: dict[int, int] = {}
            for shelf in shelves:
                if len(shelf) > capacity:
                    problems.append(f'{where}: витрина переполнена')
                for x in shelf:
                    counts[x] = counts.get(x, 0) + 1
            if lvl['n'] != len(counts):
                problems.append(f'{where}: заявлено {lvl["n"]} видов, в поле {len(counts)}')
            if any(c != capacity for c in counts.values()):
                problems.append(f'{where}: у вида не {capacity} фигурок — {counts}')
            if any(is_locked(shelf, capacity) for shelf in shelves):
                problems.append(f'{where}: витрина собрана уже на старте')

            # Дорогая, но единственная проверка, которая действительно важна:
            # уровень решаем, и записанный minMoves — точный оптимум.
            try:
                best = solve_min_moves(shelves, capacity, max_moves=60)
            except Exception as exc:  # noqa: BLE001
                problems.append(f'{where}: солвер упал — {exc}')
                continue
            if best is None:
                problems.append(f'{where}: НЕРЕШАЕМ')
            elif best != lvl['m']:
                problems.append(f'{where}: minMoves={lvl["m"]}, а оптимум {best}')

    check(f'все {total} уровней решаемы, minMoves точны', not problems, '\n    '.join(problems[:8]))

# ---------------------------------------------------------------------------
group('Эталон для проверки правил в TypeScript-ядре')

fixtures = []
rng = random.Random(777)
# Плюс несколько вручную подобранных краевых случаев.
handmade: list[tuple[tuple[tuple[int, ...], ...], int]] = [
    (((0, 1, 0, 1), (1, 0, 1, 0)), 4),              # тупик
    (((0, 0, 0, 0), (1, 1, 1, 1)), 4),              # решено
    (((2, 2, 2, 2), (0, 1), ()), 4),                # закрытая витрина рядом с пустой
    (((0,), (0,), (0,), (0,)), 4),                  # один вид, всё раздроблено
    (((1, 2), (2, 1), (), ()), 4),                  # две пустые витрины
]
for state, capacity in handmade:
    fixtures.append({'shelves': encode(state), 'capacity': capacity})

for _ in range(45):
    species = rng.choice([2, 3, 4])
    capacity = rng.choice([3, 4])
    free = rng.choice([0, 1, 2])
    bag = [s for s in range(species) for _ in range(capacity)]
    rng.shuffle(bag)
    shelves = [tuple(bag[i * capacity : (i + 1) * capacity]) for i in range(species)]
    # Часть фигурок снимаем, чтобы попадались и неполные витрины.
    shelves = [shelf[: rng.randint(0, capacity)] for shelf in shelves]
    state = tuple(shelves + [()] * free)
    fixtures.append({'shelves': encode(state), 'capacity': capacity})

for fixture in fixtures:
    state = tuple(tuple(int(c) for c in part) for part in fixture['shelves'].split('|'))
    capacity = fixture['capacity']
    # prune=False: эталон описывает ПРАВИЛА, а не эвристики поиска.
    moves = sorted(set(legal_moves(state, capacity, prune=False)))
    fixture['moves'] = [[src, dst] for src, dst in moves]
    fixture['locked'] = [1 if is_locked(shelf, capacity) else 0 for shelf in state]
    fixture['solved'] = 1 if is_solved(state, capacity) else 0

fixture_path = Path(__file__).parent.parent / 'test' / 'fixtures' / 'parity.json'
fixture_path.parent.mkdir(parents=True, exist_ok=True)
fixture_path.write_text(
    json.dumps(fixtures, separators=(',', ':')) + '\n',
    encoding='utf-8',
)
check(f'выгружено {len(fixtures)} состояний в test/fixtures/parity.json', True)

# ---------------------------------------------------------------------------
print(f'\n{"-" * 52}')
if failures:
    print('\nПодробности падений:\n')
    for f in failures:
        print(f'  ✗ {f}\n')
print(f'Пройдено: {passed}, упало: {failed}')
raise SystemExit(1 if failed else 0)
