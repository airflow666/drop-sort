/**
 * Юнит-тесты ядра. Запуск: npm run test:core
 *
 * Ядро специально не зависит от браузера — тесты гоняются в чистом Node
 * через tsx, без jsdom и без сборки.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  allKeys,
  dictionary,
  formatNumber,
  pluralize,
  setLanguage,
  t,
  type Key,
} from '../src/i18n';
import { ALL_FIGURINES, figurineName } from '../src/theme/seasons';
import { Board } from '../src/core/board';
import { findHint } from '../src/core/hint';
import { rateLevel, blitzSetPoints } from '../src/core/scoring';
import type { LevelSpec, Shelf } from '../src/core/types';
import {
  CONSUMABLE_PRODUCTS,
  isConsumable,
  LEADERBOARDS,
  PLATFORM_ID_MASK,
  PRODUCT_IDS,
} from '../src/platform/ids';
import {
  PASS_DAILY_COINS,
  PASS_DAYS,
  Profile,
  type ProfileStorage,
} from '../src/meta/profile';
import {
  easeBack,
  easeBounce,
  easeElastic,
  easeIn,
  easeInOut,
  easeOut,
  Tweens,
} from '../src/render/tween';

let passed = 0;
let failed = 0;
const failures: string[] = [];

/**
 * Тесты собираются в очередь и запускаются в конце файла.
 *
 * Раньше `test` вызывал функцию сразу и ловил только синхронные исключения.
 * Тесты твинов асинхронные (они ждут промис твина), и при немедленном вызове
 * их падения проходили бы мимо счётчика: упавший assert внутри промиса стал бы
 * необработанным отказом, а тест — «пройденным».
 */
interface Queued {
  group: string;
  name: string;
  fn: () => void | Promise<void>;
}

const queue: Queued[] = [];
let currentGroup = '';

function test(name: string, fn: () => void | Promise<void>): void {
  queue.push({ group: currentGroup, name, fn });
}

function group(name: string, fn: () => void): void {
  currentGroup = name;
  fn();
}

async function run(): Promise<void> {
  let printedGroup = '';
  for (const item of queue) {
    if (item.group !== printedGroup) {
      printedGroup = item.group;
      console.log(`\n${item.group}`);
    }
    try {
      await item.fn();
      passed++;
      console.log(`  ✓ ${item.name}`);
    } catch (e) {
      failed++;
      const msg = e instanceof Error ? e.message : String(e);
      failures.push(`${item.name}\n    ${msg.split('\n').join('\n    ')}`);
      console.log(`  ✗ ${item.name}`);
    }
  }
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

group('Твины', () => {
  // Регрессия на ошибку, которая замораживала игру. Вся анимация ходов —
  // цепочка await по твинам, и отменённый твин, не резолвящий свой промис,
  // оставлял поле в состоянии «идёт анимация» навсегда. В блице, где уровень
  // сменяется прямо посреди анимации, это происходило гарантированно.
  test('промис резолвится по завершении', async () => {
    const tweens = new Tweens();
    let last = -1;
    const done = tweens.add({ duration: 100, onUpdate: (t) => (last = t) });
    tweens.update(50);
    assert.ok(last > 0 && last < 1, `середина твина дала t=${last}`);
    tweens.update(60);
    await done;
    assert.equal(last, 1, 'к концу твина t должен быть ровно 1');
  });

  test('clear() резолвит промисы отменённых твинов', async () => {
    const tweens = new Tweens();
    let resolved = false;
    const pending = tweens.add({ duration: 5000, onUpdate: () => {} }).then(() => {
      resolved = true;
    });
    tweens.update(16);
    assert.equal(resolved, false, 'твин ещё идёт');
    tweens.clear();
    await pending;
    assert.equal(resolved, true, 'после clear() ожидающий код обязан продолжиться');
    assert.equal(tweens.active, 0);
  });

  test('clear() не вызывает onComplete отменённого твина', async () => {
    const tweens = new Tweens();
    let completed = false;
    const pending = tweens.add({
      duration: 5000,
      onUpdate: () => {},
      onComplete: () => (completed = true),
    });
    tweens.update(16);
    tweens.clear();
    await pending;
    // Отмена — это не завершение: доигрывать эффект в уже сменившемся
    // состоянии нельзя, а ждущий код разбудить нужно.
    assert.equal(completed, false);
  });

  test('задержка откладывает начало, но не ломает завершение', async () => {
    const tweens = new Tweens();
    let started = false;
    const done = tweens.add({ duration: 50, delay: 100, onUpdate: () => (started = true) });
    tweens.update(40);
    assert.equal(started, false, 'до конца задержки onUpdate не зовётся');
    tweens.update(70);
    tweens.update(60);
    await done;
    assert.equal(started, true);
  });

  test('кривые не выходят за границы на концах', () => {
    for (const [name, ease] of Object.entries({
      easeInOut,
      easeOut,
      easeIn,
      easeBack,
      easeElastic,
      easeBounce,
    })) {
      assert.ok(Math.abs(ease(0)) < 1e-6, `${name}(0) должен быть 0, а не ${ease(0)}`);
      assert.ok(Math.abs(ease(1) - 1) < 1e-6, `${name}(1) должен быть 1, а не ${ease(1)}`);
    }
  });
});

group('Идентификаторы для консоли площадки', () => {
  // Консоль принимает технические имена лидербордов только по маске
  // [a-zA-Z0-9]. Имена с подчёркиванием в неё просто не вводятся, и
  // выясняется это на последнем шаге перед публикацией — когда лидерборды
  // заводят руками. Тест ловит это при сборке.
  test('имена лидербордов проходят маску консоли', () => {
    for (const name of LEADERBOARDS) {
      assert.ok(
        PLATFORM_ID_MASK.test(name),
        `«${name}» не проходит ${PLATFORM_ID_MASK}: консоль такое имя не примет`
      );
    }
  });

  test('имена лидербордов различны', () => {
    assert.equal(new Set(LEADERBOARDS).size, LEADERBOARDS.length);
  });

  test('идентификаторы товаров различны и непусты', () => {
    assert.equal(new Set(PRODUCT_IDS).size, PRODUCT_IDS.length);
    for (const id of PRODUCT_IDS) assert.ok(id.length > 0, 'пустой идентификатор товара');
  });

  test('расходуемые товары перечислены среди существующих', () => {
    for (const id of CONSUMABLE_PRODUCTS) {
      assert.ok(
        (PRODUCT_IDS as readonly string[]).includes(id),
        `«${id}» помечен расходуемым, но такого товара нет`
      );
    }
  });

  test('тексты товаров совпадают с витриной консоли', () => {
    // store/CARD.md — то, что руками вбивается в форму товара. Экран магазина
    // берёт названия из каталога площадки, то есть ИЗ ЭТИХ ЖЕ строк, и
    // расхождение читается игроком как подмена: в карточке одно, в игре другое.
    // Держать две копии текста синхронными «внимательно» не выходит — правку в
    // i18n забывают перенести в карточку ровно один раз, и этого достаточно.
    const card = readFileSync(new URL('../store/CARD.md', import.meta.url), 'utf8');
    const products: Array<[string, Key, Key]> = [
      ['hints_10', 'product.hints10.title', 'product.hints10.note'],
      ['week_pass', 'product.weekPass.title', 'product.weekPass.note'],
      ['skin_chrome', 'product.skinChrome.title', 'product.skinChrome.note'],
      ['no_ads', 'product.noAds.title', 'product.noAds.note'],
    ];
    for (const lang of ['ru', 'en'] as const) {
      setLanguage(lang);
      for (const [id, titleKey, noteKey] of products) {
        for (const key of [titleKey, noteKey]) {
          const text = t(key);
          assert.ok(
            card.includes(`\`${text}\``),
            `store/CARD.md не содержит «${text}» (${id}, ${lang}): карточка разошлась с игрой`
          );
          // Заодно лимиты формы: название до 100 символов, описание до 200.
          assert.ok(text.length <= (key === titleKey ? 100 : 200), `«${text}» длиннее лимита формы`);
        }
      }
    }
    setLanguage('ru');
  });

  test('нерасходуемые товары не считаются расходуемыми', () => {
    // «Убрать рекламу» и скины подтверждать нельзя: платформа хранит факт
    // владения именно непотреблённой покупкой. Потребить их значит забыть
    // о покупке при следующем запуске.
    assert.equal(isConsumable('no_ads'), false);
    assert.equal(isConsumable('skin_chrome'), false);
    assert.equal(isConsumable('hints_10'), true);
  });
});

/**
 * Хранилище в памяти: профилю от площадки нужны только два этих метода.
 *
 * `offline` имитирует то, ради чего площадка и требует проверку необработанных
 * покупок: запись не дошла. Отличить такой случай от успешного — единственный
 * способ не потребить платёж раньше, чем сохранены выданные по нему товары.
 */
function profile(): Profile {
  return new Profile(storage());
}

function storage(opts: { offline?: boolean } = {}): ProfileStorage & { offline: boolean } {
  const store: Record<string, unknown> = {};
  return {
    offline: opts.offline === true,
    async getData() {
      return store;
    },
    async setData(data) {
      if (this.offline) return false;
      // Копия, а не ссылка: иначе «перезагрузка» вернула бы тот же объект,
      // и тест на сохранение проходил бы, ничего не проверяя.
      Object.assign(store, JSON.parse(JSON.stringify(data)));
      return true;
    },
  };
}

group('Выдача покупок', () => {
  // Документация площадки: сначала сохранить данные игрока, потом
  // consumePurchase — потреблённая покупка удаляется безвозвратно. Отсюда два
  // требования к профилю: он обязан СООБЩАТЬ, дошла ли запись, и обязан
  // помнить уже выданные платежи, чтобы повтор не удвоил товар.

  test('flush сообщает об отказе записи', async () => {
    const offline = storage({ offline: true });
    const p = new Profile(offline);
    await p.load();
    p.addCoins(100);
    assert.equal(await p.flush(), false, 'отказ записи выдан за успех');

    // Связь восстановилась — следующая попытка проходит.
    offline.offline = false;
    assert.equal(await p.flush(), true);
  });

  test('выданный платёж помнится до подтверждения', () => {
    const p = profile();
    assert.equal(p.isPurchaseApplied('token-1'), false);
    p.notePurchaseApplied('token-1');
    assert.equal(p.isPurchaseApplied('token-1'), true);
    // Подтверждён площадкой — держать его в реестре больше незачем.
    p.forgetPurchase('token-1');
    assert.equal(p.isPurchaseApplied('token-1'), false);
  });

  test('реестр платежей переживает перезагрузку', async () => {
    const platform = storage();
    const first = new Profile(platform);
    await first.load();
    first.notePurchaseApplied('token-2');
    await first.flush();

    // Ровно тот случай, ради которого реестр и нужен: товар выдан и сохранён,
    // consume не прошёл, покупка снова придёт в getPurchases. Без памяти о
    // платеже игра выдала бы товар второй раз за один платёж.
    const second = new Profile(platform);
    await second.load();
    assert.equal(second.isPurchaseApplied('token-2'), true);
  });

  test('реестр не растёт без предела', () => {
    const p = profile();
    for (let i = 0; i < 200; i++) p.notePurchaseApplied(`token-${i}`);
    assert.equal(p.isPurchaseApplied('token-199'), true, 'свежий платёж потерян');
    assert.equal(p.isPurchaseApplied('token-0'), false, 'реестр не обрезается');
  });
});

group('Недельный пропуск', () => {
  // Пропуск — оплаченный товар, и он обещает конкретное: награду каждый день
  // семь дней подряд. Ошибка в датах здесь не роняет игру, она просто не даёт
  // игроку то, за что он заплатил, — и выясняется это возвратами.

  test('без покупки пропуска нет', () => {
    const p = profile();
    assert.equal(p.passActive, false);
    assert.equal(p.passClaimable, false);
    assert.equal(p.claimPass(), null);
  });

  test('покупка включает пропуск на семь дней', () => {
    const p = profile();
    p.activatePass(PASS_DAYS);
    assert.equal(p.passActive, true);
    assert.equal(p.passDaysLeft, PASS_DAYS);
  });

  test('награда выдаётся раз в день, а не на каждый вход', () => {
    const p = profile();
    p.activatePass(PASS_DAYS);
    const coinsBefore = p.coins;

    const first = p.claimPass();
    assert.ok(first, 'первый вход должен дать награду');
    assert.equal(p.coins, coinsBefore + PASS_DAILY_COINS);

    // Второй заход в тот же день — уже ничего: иначе пропуск печатал бы монеты
    // с каждой перезагрузки вкладки.
    assert.equal(p.claimPass(), null);
    assert.equal(p.coins, coinsBefore + PASS_DAILY_COINS);
  });

  test('повторная покупка продлевает, а не обнуляет остаток', () => {
    const p = profile();
    p.activatePass(PASS_DAYS);
    p.activatePass(PASS_DAYS);
    // Второй пропуск ложится ХВОСТОМ к первому. Если бы он начинал отсчёт
    // заново, игрок потерял бы оплаченные дни первого.
    assert.equal(p.passDaysLeft, PASS_DAYS * 2);
  });

  test('пропуск переживает перезагрузку', async () => {
    const platform = storage();
    const first = new Profile(platform);
    await first.load();
    first.activatePass(PASS_DAYS);
    first.claimPass();
    await first.flush();

    const second = new Profile(platform);
    await second.load();
    assert.equal(second.passActive, true, 'пропуск не сохранился');
    assert.equal(second.passDaysLeft, PASS_DAYS);
    // И награду сегодня уже не выдаст второй раз.
    assert.equal(second.passClaimable, false);
  });

  test('истёкший пропуск не действует и наград не даёт', () => {
    const p = profile();
    // Пропуск, купленный десять дней назад: ставим дату окончания в прошлом.
    p.activatePass(-3);
    assert.equal(p.passActive, false);
    assert.equal(p.passDaysLeft, 0);
    assert.equal(p.claimPass(), null);
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

/**
 * Локализация.
 *
 * Полнота словарей уже проверена типами (`EN` объявлен как `Record<Key, string>`),
 * поэтому здесь проверяется то, что типы поймать не могут: пустые строки,
 * забытый перевод копипастой и — главное — расхождение подстановок. Шаблон с
 * `{n}` в одном языке и без него в другом компилируется прекрасно, а в игре
 * даёт строку без числа.
 */
group('Локализация', () => {
  const keys = allKeys();

  test('оба словаря заполнены непустыми строками', () => {
    const empty: string[] = [];
    for (const language of ['ru', 'en'] as const) {
      const dict = dictionary(language);
      for (const key of keys) {
        if (!dict[key] || !dict[key].trim()) empty.push(`${language}/${key}`);
      }
    }
    assert.equal(empty.length, 0, `пустые строки: ${empty.join(', ')}`);
  });

  test('подстановки совпадают в обоих языках', () => {
    const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    const ru = dictionary('ru');
    const en = dictionary('en');
    const bad: string[] = [];
    for (const key of keys) {
      const a = placeholders(ru[key]).join(',');
      const b = placeholders(en[key]).join(',');
      if (a !== b) bad.push(`${key}: ru{${a}} en{${b}}`);
    }
    assert.equal(bad.length, 0, bad.join('\n'));
  });

  test('английский не остался русским', () => {
    const en = dictionary('en');
    // Кириллица в английском словаре — верный признак незамеченной копипасты.
    const cyrillic = keys.filter((key) => /[А-Яа-яЁё]/.test(en[key]));
    assert.equal(cyrillic.length, 0, `не переведено: ${cyrillic.join(', ')}`);
  });

  test('у каждого силуэта и каждого чейза есть имя', () => {
    const missing: string[] = [];
    for (const fig of ALL_FIGURINES) {
      for (const language of ['ru', 'en'] as const) {
        setLanguage(language);
        const name = figurineName(fig);
        // Незнакомый ключ `t` возвращает как есть — по точке его и ловим.
        if (!name || name.includes('shape.') || name.includes('variant.')) {
          missing.push(`${language}/${fig.key}: ${name}`);
        }
      }
    }
    setLanguage('ru');
    assert.equal(missing.length, 0, missing.join('\n'));
  });

  test('код языка от площадки сводится к ru или en', () => {
    assert.equal(setLanguage('ru'), 'ru');
    assert.equal(setLanguage('ru-RU'), 'ru');
    // Пустой ответ SDK — это не «английский игрок», а неизвестность:
    // основной рынок русский, туда и падаем.
    assert.equal(setLanguage(''), 'ru');
    assert.equal(setLanguage(null), 'ru');
    assert.equal(setLanguage('en'), 'en');
    assert.equal(setLanguage('en-US'), 'en');
    // Незнакомый язык получает английский: он понятнее русского тому,
    // кто не знает ни того, ни другого.
    assert.equal(setLanguage('tr'), 'en');
    setLanguage('ru');
  });

  test('разряды числа разделяются по правилам языка', () => {
    setLanguage('ru');
    // Именно неразрывный пробел (U+00A0), а не обычный: по обычному браузер
    // переносит строку прямо посреди числа, и пилюля с монетами рвётся надвое.
    assert.equal(formatNumber(1240), '1 240');
    setLanguage('en');
    assert.equal(formatNumber(1240), '1,240');
    setLanguage('ru');
  });

  test('формы множественного числа', () => {
    setLanguage('ru');
    assert.equal(pluralize(1, 'moves'), 'ход');
    assert.equal(pluralize(2, 'moves'), 'хода');
    assert.equal(pluralize(5, 'moves'), 'ходов');
    assert.equal(pluralize(11, 'moves'), 'ходов');
    assert.equal(pluralize(21, 'moves'), 'ход');
    setLanguage('en');
    assert.equal(pluralize(1, 'moves'), 'move');
    assert.equal(pluralize(2, 'moves'), 'moves');
    assert.equal(pluralize(0, 'moves'), 'moves');
    setLanguage('ru');
  });
});

// ---------------------------------------------------------------------------

await run();

console.log(`\n${'-'.repeat(52)}`);
if (failed > 0) {
  console.log('\nПодробности падений:\n');
  failures.forEach((f) => console.log(`  ✗ ${f}\n`));
}
console.log(`Пройдено: ${passed}, упало: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
