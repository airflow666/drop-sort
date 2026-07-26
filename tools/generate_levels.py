#!/usr/bin/env python3
"""
Офлайн-генератор уровней DROP.

Уровни не рисуются руками (план, §6) — это главная экономия проекта.

  1. Раздать все фигурки случайно по рабочим витринам, оставив ровно столько
     пустых, сколько предписывает участок кривой сложности.
  2. Точно решить состояние солвером A* (tools/sortlib.py).
  3. Оставить уровень, только если оптимум попал в целевой коридор ходов.
     Отбросить нерешаемое, слишком лёгкое, требующее больше 60 ходов
     и всё, что солвер не осилил в пределах бюджета узлов.

ОТКЛОНЕНИЕ ОТ ПЛАНА (§6, шаги 1–2). План предлагал строить уровень обратными
ходами от решённого состояния, чтобы решаемость была гарантирована построением.
Так не получается: в решённом состоянии каждая витрина полна и однородна, то
есть закрыта стеклом, и обратное блуждание вынуждено сначала занять пустые
витрины — а вернуть их в пустое состояние оно уже не может. На практике из
25 попыток нужное число пустых витрин не давала ни одна.

Поэтому решаемость обеспечивается не построением, а солвером — тем самым
шагом 3, который план и так требовал. Каждый уровень в паке доказанно решаем,
и его minMoves — точный оптимум, а не оценка. Цена: при одной свободной
витрине случайная раздача решаема примерно в 2% случаев, но нерешаемость
распознаётся за ~2 мс, так что отбор всё равно дешёвый.

Запуск: python3 tools/generate_levels.py
"""

from __future__ import annotations

import argparse
import json
import math
import os
import random
import sys
import time
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from sortlib import (  # noqa: E402
    SolverBudgetExceeded,
    State,
    is_locked,
    solve_min_moves,
)

CAPACITY = 4
MAX_MOVES = 60

# Каждый N-й уровень — «разгрузочный»: заведомо лёгкий, выравнивает
# эмоциональную кривую и снижает отвал (план, §6).
RELIEF_EVERY = 11


@dataclass(frozen=True)
class Tier:
    """
    Участок кривой сложности.

    Витрин всегда `species + free`: по одной витрине на каждый вид плюс
    заявленный запас пустых. В таблице плана (§6) колонка «Витрин» местами
    не сходится с двумя другими — 7–8 видов при 1 свободной витрине дают
    8–9 витрин, а не 10–12. Ведущими считаем виды и свободные витрины:
    именно они определяют сложность, число витрин из них следует.
    """

    name: str
    first_level: int
    species: tuple[int, ...]
    free: tuple[int, ...]


TIERS = (
    Tier('intro', 1, species=(3,), free=(2,)),
    Tier('early', 21, species=(4, 5), free=(2,)),
    Tier('mid', 81, species=(5, 6), free=(2,)),
    Tier('late', 201, species=(6, 7), free=(2, 2, 1)),
    Tier('expert', 501, species=(7, 8), free=(1,)),
)


def tier_for(level_index: int) -> Tier:
    chosen = TIERS[0]
    for tier in TIERS:
        if level_index >= tier.first_level:
            chosen = tier
    return chosen


def move_corridor(species: int, free: int, *, relief: bool = False) -> tuple[int, int]:
    """
    Целевой коридор оптимального числа ходов.

    Коэффициенты выведены замером фактического распределения A*, а не из
    общих соображений: при 4 фигурках в витрине и двух свободных витринах
    оптимум держится около 3.6 × число видов (3 вида → медиана 10 ходов,
    8 видов → 30). Одна свободная витрина сдвигает распределение вверх.

    Коридор привязан к числу видов, а не к номеру уровня: абсолютный порог
    сделал бы поздние уровни либо тривиальными, либо непроходимыми.
    """
    if relief:
        # Нижний хвост распределения — уровень должен читаться как передышка.
        return max(5, math.ceil(2.1 * species)), math.floor(3.2 * species)
    if free <= 1:
        return math.ceil(3.6 * species), min(math.floor(5.6 * species), MAX_MOVES)
    return math.ceil(3.2 * species), min(math.floor(4.6 * species), MAX_MOVES)


def deal(species: int, free: int, rng: random.Random) -> State:
    """Случайная раздача всех фигурок по рабочим витринам; пустые — в конец."""
    bag = [s for s in range(species) for _ in range(CAPACITY)]
    rng.shuffle(bag)
    shelves = [tuple(bag[i * CAPACITY : (i + 1) * CAPACITY]) for i in range(species)]
    shelves.extend([()] * free)
    return tuple(shelves)


def encode(state: State) -> str:
    """Компактная запись: витрины через '|', виды — цифрами снизу вверх."""
    return '|'.join(''.join(str(x) for x in shelf) for shelf in state)


def make_level(job: tuple[int, int, bool]) -> dict | None:
    """
    Сгенерировать один проверенный уровень.

    Полностью детерминирован по (level_index, seed) — уровень воспроизводим,
    и генерацию можно безопасно раскладывать по процессам.
    """
    level_index, seed, relief = job
    tier = tier_for(level_index)
    rng = random.Random((seed * 1_000_003 + level_index) & 0x7FFFFFFF)

    if relief:
        # Разгрузочный: минимум видов участка и максимум свободных витрин.
        species, free = min(tier.species), max(tier.free)
    else:
        species, free = rng.choice(tier.species), rng.choice(tier.free)

    lo, hi = move_corridor(species, free, relief=relief)

    # Свободных витрин мало → раздача решаема редко (при free=1 около 2%),
    # но нерешаемость распознаётся за считанные миллисекунды.
    attempts = 4000 if free <= 1 else 400

    for _ in range(attempts):
        state = deal(species, free, rng)
        # Витрина, уже собранная на старте, — бесплатный подарок и выглядит
        # как ошибка генератора.
        if any(is_locked(shelf, CAPACITY) for shelf in state):
            continue
        try:
            best = solve_min_moves(state, CAPACITY, max_moves=MAX_MOVES)
        except SolverBudgetExceeded:
            continue
        if best is None or not (lo <= best <= hi):
            continue
        return {
            's': encode(state),
            'm': best,
            'n': species,
            **({'r': 1} if relief else {}),
        }

    return None


def build_pack(
    name: str,
    count: int,
    *,
    start_index: int,
    seed: int,
    relief: bool = True,
    workers: int,
) -> list[dict]:
    jobs: list[tuple[int, int, bool]] = []
    for i in range(count):
        level_index = start_index + i
        is_relief = relief and level_index > RELIEF_EVERY and level_index % RELIEF_EVERY == 0
        jobs.append((level_index, seed, is_relief))

    started = time.time()
    levels: list[dict] = []
    skipped = 0

    with ProcessPoolExecutor(max_workers=workers) as pool:
        for done, result in enumerate(pool.map(make_level, jobs, chunksize=4), start=1):
            if result is None:
                skipped += 1
            else:
                levels.append(result)
            if done % 100 == 0:
                print(
                    f'  {name}: {done}/{count}, {time.time() - started:.0f} с',
                    file=sys.stderr,
                    flush=True,
                )

    print(
        f'  {name}: готово — {len(levels)} уровней за {time.time() - started:.0f} с'
        + (f', отброшено {skipped}' if skipped else ''),
        file=sys.stderr,
        flush=True,
    )
    return levels


def report_curve(campaign: list[dict]) -> None:
    print('\nКривая сложности кампании:', file=sys.stderr)
    by_tier: dict[str, list[int]] = {}
    relief_moves: list[int] = []
    for i, lvl in enumerate(campaign, start=1):
        if 'r' in lvl:
            relief_moves.append(lvl['m'])
        else:
            by_tier.setdefault(tier_for(i).name, []).append(lvl['m'])
    for tier in TIERS:
        moves = by_tier.get(tier.name)
        if not moves:
            continue
        print(
            f'  {tier.name:<9} уровней {len(moves):>3}   ходов {min(moves):>2}–{max(moves):<2}'
            f'  в среднем {sum(moves) / len(moves):.1f}',
            file=sys.stderr,
        )
    if relief_moves:
        print(
            f'  {"разгрузка":<9} уровней {len(relief_moves):>3}   ходов'
            f' {min(relief_moves):>2}–{max(relief_moves):<2}'
            f'  в среднем {sum(relief_moves) / len(relief_moves):.1f}',
            file=sys.stderr,
        )


def main() -> int:
    parser = argparse.ArgumentParser(description='Генератор уровней DROP')
    parser.add_argument(
        '--out',
        default=str(Path(__file__).parent.parent / 'src' / 'levels' / 'packs.json'),
    )
    parser.add_argument('--campaign', type=int, default=520, help='уровней кампании')
    parser.add_argument('--daily', type=int, default=200, help='уровней ежедневного вызова')
    parser.add_argument('--blitz', type=int, default=120, help='коротких уровней для блица')
    parser.add_argument('--seed', type=int, default=20260726)
    parser.add_argument('--workers', type=int, default=max(1, (os.cpu_count() or 2)))
    args = parser.parse_args()

    print(
        f'Генерация уровней в {args.workers} процессах (солвер проверяет каждый):',
        file=sys.stderr,
        flush=True,
    )

    campaign = build_pack(
        'кампания', args.campaign, start_index=1, seed=args.seed, workers=args.workers
    )
    # Ежедневный вызов — один и тот же уровень для всех игроков в сутки.
    # Берётся из середины кривой: по силам новичку, не тривиален для опытного.
    daily = build_pack(
        'ежедневный',
        args.daily,
        start_index=140,
        seed=args.seed + 1,
        relief=False,
        workers=args.workers,
    )
    # Блиц — поток коротких уровней на 60 секунд. Сложность низкая и
    # фиксированная: там соревнуются в скорости, а не в думании над тупиком.
    blitz = build_pack(
        'блиц',
        args.blitz,
        start_index=30,
        seed=args.seed + 2,
        relief=False,
        workers=args.workers,
    )

    payload = {
        'version': 1,
        'capacity': CAPACITY,
        'generatedAt': time.strftime('%Y-%m-%d'),
        'seed': args.seed,
        'packs': {'campaign': campaign, 'daily': daily, 'blitz': blitz},
    }

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, separators=(',', ':'), ensure_ascii=False), encoding='utf-8')

    print(
        f'\nЗаписано {out}: {len(campaign)} + {len(daily)} + {len(blitz)} уровней,'
        f' {out.stat().st_size / 1024:.1f} КБ',
        file=sys.stderr,
    )
    report_curve(campaign)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
