/**
 * Юнит-тесты ядра. Запуск: npm run test:core
 *
 * Ядро специально не зависит от браузера — тесты гоняются в чистом Node
 * через tsx, без jsdom и без сборки.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Board } from '../src/core/board';
import { findHint } from '../src/core/hint';
import { rateLevel, blitzSetPoints } from '../src/core/scoring';
import type { LevelSpec, Shelf } from '../src/core/types';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    const msg = e instanceof Error ? e.message : String(e);
    failures.push(`${name}\n    ${msg.split('\n').join('\n    ')}`);
    console.log(`  ✗ ${name}`);
  }
}

function group(name: string, fn: () => void): void {
  console.log(`\n${name}`);
  fn();
}

function level(shelves: Shelf[], capacity = 4, speciesCount?: number): LevelSpec {
  const species = new Set<number>();
  shelves.forEach((s) => s.forEach((x) => species.add(x)));
  return {
    id: 'test',
    seed: 1,
    shelves,
    capacity,
    speciesCount: speciesCount ?? species.size,
    minMoves: 0,
  };
}

// ---------------------------------------------------------------------------

group('Board: базовые правила', () => {
  test('тап по пустой витрине ничего не поднимает', () => {
    const b = new Board(level([[], [0, 0]]));
    assert.equal(b.tap(0).kind, 'ignored');
    assert.equal(b.selected, null);
  });

  test('тап поднимает верхнюю фигурку', () => {
    const b = new Board(level([[0, 1], []]));
    const r = b.tap(0);
    assert.equal(r.kind, 'lift');
    assert.equal(r.kind === 'lift' && r.species, 1);
    assert.equal(b.selected, 0);
  });

  test('повторный тап по той же витрине отменяет подъём', () => {
    const b = new Board(level([[0, 1], []]));
    b.tap(0);
    const r = b.tap(0);
    assert.equal(r.kind, 'cancel');
    assert.equal(b.selected, null);
    assert.equal(b.moves, 0);
  });

  test('ход в пустую витрину разрешён', () => {
    const b = new Board(level([[0, 1], []]));
    b.tap(0);
    const r = b.tap(1);
    assert.equal(r.kind, 'move');
    assert.deepEqual(b.shelves, [[0], [1]]);
    assert.equal(b.moves, 1);
  });

  test('ход на такой же вид разрешён', () => {
    const b = new Board(level([[1], [1]]));
    b.tap(0);
    assert.equal(b.tap(1).kind, 'move');
    assert.deepEqual(b.shelves, [[], [1, 1]]);
  });

  test('один тап переносит ровно одну фигурку, а не всю серию', () => {
    const b = new Board(level([[1, 1, 1], [1]]));
    b.tap(0);
    b.tap(1);
    assert.deepEqual(b.shelves, [[1, 1], [1, 1]]);
  });

  test('ход на другой вид отклоняется, выбор переносится', () => {
    const b = new Board(level([[0], [1]]));
    b.tap(0);
    const r = b.tap(1);
    // В целевой витрине есть что поднять — это смена выбора, а не ошибка.
    assert.equal(r.kind, 'reselect');
    assert.equal(b.selected, 1);
    assert.equal(b.moves, 0);
  });

  test('ход в полную витрину отклоняется', () => {
    const b = new Board(level([[0], [1, 2, 1, 2]], 4));
    b.tap(0);
    const r = b.tap(1);
    // Витрина полна и разнородна — поднять из неё можно, значит reselect.
    assert.equal(r.kind, 'reselect');
    assert.equal(b.canMove(0, 1), false);
  });

  test('в полную однородную (закрытую) витрину положить нельзя', () => {
    const b = new Board(level([[0], [1, 1, 1, 1]], 4));
    assert.equal(b.locked[1], true);
    b.tap(0);
    const r = b.tap(1);
    assert.equal(r.kind, 'reject');
    assert.equal(r.kind === 'reject' && r.reason, 'locked');
  });
});

group('Board: закрытие витрин и победа', () => {
  test('витрина закрывается стеклом, когда заполнена одним видом', () => {
    const b = new Board(level([[0, 0, 0], [0]], 4));
    b.tap(1);
    const r = b.tap(0);
    assert.equal(r.kind, 'move');
    assert.equal(r.kind === 'move' && r.move.closed, true);
    assert.equal(b.locked[0], true);
  });

  test('из закрытой витрины нельзя брать', () => {
    const b = new Board(level([[0, 0, 0, 0], [1]], 4));
    assert.equal(b.tap(0).kind, 'ignored');
  });

  test('уровень пройден, когда закрыты все витрины по числу видов', () => {
    const b = new Board(level([[0, 0, 0], [1, 1, 1, 1], [0]], 4, 2));
    assert.equal(b.isSolved, false);
    b.tap(2);
    b.tap(0);
    assert.equal(b.isSolved, true);
    assert.equal(b.closedCount, 2);
  });

  test('уже собранная в спеке витрина закрыта сразу после конструктора', () => {
    const b = new Board(level([[2, 2, 2, 2], [0, 1]], 4));
    assert.equal(b.locked[0], true);
    assert.equal(b.closedCount, 1);
  });
});

group('Board: тупик и «+1 витрина»', () => {
  test('пустая витрина всегда означает наличие хода', () => {
    const b = new Board(level([[0, 1], [1, 0], []], 4));
    assert.equal(b.hasAnyMove(), true);
    assert.equal(b.isDeadlock, false);
  });

  test('тупик распознаётся: витрины полны и разнородны', () => {
    const b = new Board(level([[0, 1, 0, 1], [1, 0, 1, 0]], 4));
    assert.equal(b.hasAnyMove(), false);
    assert.equal(b.isDeadlock, true);
  });

  test('решённое поле — не тупик', () => {
    const b = new Board(level([[0, 0, 0, 0], [1, 1, 1, 1]], 4));
    assert.equal(b.hasAnyMove(), false);
    assert.equal(b.isDeadlock, false, 'победа не должна выглядеть как тупик');
  });

  test('«+1 витрина» гарантированно расшивает тупик', () => {
    const b = new Board(level([[0, 1, 0, 1], [1, 0, 1, 0]], 4));
    assert.equal(b.isDeadlock, true);
    b.addShelf();
    assert.equal(b.isDeadlock, false);
    assert.equal(b.hasAnyMove(), true);
    assert.equal(b.extraShelves, 1);
  });
});

group('Board: отмена хода', () => {
  test('отмена возвращает фигурку и уменьшает счётчик ходов', () => {
    const b = new Board(level([[0, 1], []], 4));
    b.tap(0);
    b.tap(1);
    assert.equal(b.moves, 1);
    const undone = b.undo();
    assert.ok(undone);
    assert.deepEqual(b.shelves, [[0, 1], []]);
    assert.equal(b.moves, 0);
  });

  test('отмена снимает стекло, если ход закрыл витрину', () => {
    const b = new Board(level([[0, 0, 0], [0]], 4));
    b.tap(1);
    b.tap(0);
    assert.equal(b.locked[0], true);
    b.undo();
    assert.equal(b.locked[0], false, 'стекло должно сниматься вместе с ходом');
    assert.deepEqual(b.shelves, [[0, 0, 0], [0]]);
  });

  test('отмена на пустой истории возвращает null', () => {
    const b = new Board(level([[0], []]));
    assert.equal(b.undo(), null);
    assert.equal(b.canUndo, false);
  });

  test('несколько отмен подряд разматывают историю', () => {
    const b = new Board(level([[0, 1, 2], [], []], 4));
    b.tap(0); b.tap(1);
    b.tap(0); b.tap(2);
    assert.deepEqual(b.shelves, [[0], [2], [1]]);
    b.undo();
    b.undo();
    assert.deepEqual(b.shelves, [[0, 1, 2], [], []]);
    assert.equal(b.moves, 0);
  });
});

group('Board: сериализация', () => {
  test('снимок восстанавливает поле полностью', () => {
    const b = new Board(level([[0, 1, 1], [1, 0, 0], []], 3));
    b.tap(0); b.tap(2);
    const restored = Board.restore(b.serialize());
    assert.deepEqual(restored.shelves, b.shelves);
    assert.equal(restored.moves, b.moves);
    assert.equal(restored.capacity, b.capacity);
    assert.equal(restored.speciesCount, b.speciesCount);
  });

  test('закрытые витрины восстанавливаются по содержимому', () => {
    const b = new Board(level([[0, 0, 0], [1, 1, 1], [0]], 3, 2));
    b.tap(2); b.tap(0);
    const restored = Board.restore(b.serialize());
    assert.deepEqual(restored.locked, b.locked);
    assert.equal(restored.isSolved, true);
  });

  test('key() не зависит от порядка витрин', () => {
    const a = new Board(level([[0, 1], [1, 0], []], 4));
    const c = new Board(level([[], [1, 0], [0, 1]], 4));
    assert.equal(a.key(), c.key());
  });
});

group('Подсказка', () => {
  test('находит ход, закрывающий витрину', () => {
    const b = new Board(level([[0, 0, 0], [0], [1, 1, 1, 1]], 4, 2));
    const hint = findHint(b);
    assert.ok(hint, 'подсказка должна найтись');
    assert.deepEqual([hint.from, hint.to], [1, 0]);
    assert.equal(hint.optimal, true);
  });

  test('на решённом поле подсказки нет', () => {
    const b = new Board(level([[0, 0, 0, 0], [1, 1, 1, 1]], 4));
    assert.equal(findHint(b), null);
  });

  test('в тупике подсказки нет', () => {
    const b = new Board(level([[0, 1, 0, 1], [1, 0, 1, 0]], 4));
    assert.equal(findHint(b), null);
  });

  test('подсказка ведёт к решению: идём по подсказкам до победы', () => {
    const b = new Board(level([[0, 1, 2], [2, 0, 1], [1, 2, 0], [], []], 3, 3));
    let guard = 0;
    while (!b.isSolved && guard++ < 200) {
      const hint = findHint(b);
      assert.ok(hint, `подсказка пропала на ходу ${b.moves}`);
      b.tap(hint.from);
      const r = b.tap(hint.to);
      assert.equal(r.kind, 'move', `подсказка предложила недопустимый ход ${hint.from}→${hint.to}`);
    }
    assert.equal(b.isSolved, true, `не решено за ${guard} шагов`);
  });

  test('подсказка возвращается быстро даже на большом поле', () => {
    // 8 видов, 12 витрин — верх кривой сложности из плана (§6).
    const shelves: Shelf[] = [];
    for (let i = 0; i < 8; i++) shelves.push([]);
    const bag: number[] = [];
    for (let s = 0; s < 8; s++) for (let k = 0; k < 4; k++) bag.push(s);
    // Детерминированное «перемешивание» — тест не должен быть флаки.
    let x = 12345;
    for (let i = bag.length - 1; i > 0; i--) {
      x = (x * 1103515245 + 12345) & 0x7fffffff;
      const j = x % (i + 1);
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    bag.forEach((sp, i) => shelves[i % 8].push(sp));
    shelves.push([], [], [], []);
    const b = new Board(level(shelves, 4, 8));
    const t0 = Date.now();
    const hint = findHint(b, 80);
    const dt = Date.now() - t0;
    assert.ok(hint, 'подсказка должна быть хотя бы эвристической');
    assert.ok(dt < 400, `подсказка искалась ${dt} мс — слишком долго`);
    assert.equal(b.canMove(hint.from, hint.to), true, 'подсказка обязана быть валидным ходом');
  });
});

group('Оценка результата', () => {
  test('оптимум даёт три звезды', () => {
    assert.equal(rateLevel(20, 20, false).stars, 3);
  });

  test('небольшой перебор ходов всё ещё три звезды', () => {
    assert.equal(rateLevel(20, 23, false).stars, 3);
  });

  test('средний перебор — две звезды', () => {
    assert.equal(rateLevel(20, 30, false).stars, 2);
  });

  test('большой перебор — одна звезда', () => {
    assert.equal(rateLevel(20, 45, false).stars, 1);
  });

  test('подсказка не отбирает звёзды, но снижает монеты', () => {
    const clean = rateLevel(20, 20, false);
    const hinted = rateLevel(20, 20, true);
    assert.equal(hinted.stars, clean.stars);
    assert.ok(hinted.coins < clean.coins);
  });

  test('уровень без данных солвера не наказывается', () => {
    assert.equal(rateLevel(0, 37, false).stars, 3);
  });

  test('очки блица растут быстрее, чем линейно', () => {
    const one = blitzSetPoints(1);
    const two = blitzSetPoints(2);
    const three = blitzSetPoints(3);
    assert.ok(two - one < three - two, 'кривая должна ускоряться');
  });
});

group('Паритет правил с Python-солвером', () => {
  // Генератор пишет minMoves в паки, опираясь на СВОЮ реализацию правил
  // (tools/sortlib.py). Если она разойдётся с ядром хотя бы в одном краевом
  // случае, minMoves во всех паках станет ложью, а звёзды — недостижимыми.
  // Эталон выгружает python3 tools/test_generator.py.
  interface Fixture {
    shelves: string;
    capacity: number;
    moves: [number, number][];
    locked: number[];
    solved: number;
  }

  let fixtures: Fixture[] = [];
  try {
    const raw = readFileSync(new URL('./fixtures/parity.json', import.meta.url), 'utf-8');
    fixtures = JSON.parse(raw) as Fixture[];
  } catch {
    console.log('  — эталон не найден, сначала: python3 tools/test_generator.py');
  }

  if (fixtures.length > 0) {
    test(`${fixtures.length} состояний: списки допустимых ходов совпадают`, () => {
      const mismatches: string[] = [];
      for (const fx of fixtures) {
        const shelves = fx.shelves.split('|').map((s) => [...s].map(Number));
        const board = new Board({
          id: 'parity',
          seed: 0,
          shelves,
          capacity: fx.capacity,
          speciesCount: new Set(shelves.flat()).size,
          minMoves: 0,
        });
        const expected = new Set(fx.moves.map(([a, b]) => `${a}>${b}`));
        const actual = new Set<string>();
        for (let from = 0; from < shelves.length; from++) {
          for (let to = 0; to < shelves.length; to++) {
            if (board.canMove(from, to)) actual.add(`${from}>${to}`);
          }
        }
        for (const m of expected) {
          if (!actual.has(m)) mismatches.push(`${fx.shelves}: ядро не даёт хода ${m}`);
        }
        for (const m of actual) {
          if (!expected.has(m)) mismatches.push(`${fx.shelves}: ядро даёт лишний ход ${m}`);
        }
      }
      assert.equal(mismatches.length, 0, mismatches.slice(0, 6).join('\n'));
    });

    test(`${fixtures.length} состояний: закрытые витрины и победа совпадают`, () => {
      const mismatches: string[] = [];
      for (const fx of fixtures) {
        const shelves = fx.shelves.split('|').map((s) => [...s].map(Number));
        const speciesCount = new Set(shelves.flat()).size;
        const board = new Board({
          id: 'parity',
          seed: 0,
          shelves,
          capacity: fx.capacity,
          speciesCount,
          minMoves: 0,
        });
        const locked = board.locked.map((l) => (l ? 1 : 0));
        if (locked.join('') !== fx.locked.join('')) {
          mismatches.push(`${fx.shelves}: стекло ${locked.join('')} vs ${fx.locked.join('')}`);
        }
        // Python считает решённым поле, где каждая витрина пуста или однородна
        // и полна. У ядра тот же смысл, но выражен через число закрытых витрин,
        // поэтому сравниваем только когда все виды присутствуют полностью.
        const complete = [...new Set(shelves.flat())].every(
          (sp) => shelves.flat().filter((x) => x === sp).length === fx.capacity
        );
        if (complete && Boolean(fx.solved) !== board.isSolved) {
          mismatches.push(`${fx.shelves}: победа ${board.isSolved} vs ${Boolean(fx.solved)}`);
        }
      }
      assert.equal(mismatches.length, 0, mismatches.slice(0, 6).join('\n'));
    });
  }
});

// ---------------------------------------------------------------------------

console.log(`\n${'-'.repeat(52)}`);
if (failed > 0) {
  console.log('\nПодробности падений:\n');
  failures.forEach((f) => console.log(`  ✗ ${f}\n`));
}
console.log(`Пройдено: ${passed}, упало: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
