/**
 * Диалоги. Каждый возвращает промис с выбором игрока — благодаря этому поток
 * игры в src/app.ts читается сверху вниз, без россыпи колбэков.
 *
 * Rewarded-кнопки везде помечены значком ▶ и золотой рамкой: это единый код
 * «дальше будет ролик». Ни один диалог не показывает рекламу сам — он только
 * возвращает намерение, а решение и вызов остаются за src/platform/ads.ts,
 * где реклама изолирована от геймплея.
 */

import { figurineSvg } from '../theme/figurines';
import { figurineLook, RARITY_LABEL, type FigurineDef, type Season } from '../theme/seasons';
import { add, button, clear, el, formatClock, formatNumber, mountOverlay, plural } from './dom';
import { STREAK_REWARDS, streakReward } from '../meta/profile';

function card(title: string, subtitle?: string): { root: HTMLElement; actions: HTMLElement } {
  const root = el('div', 'card');
  add(root, el('h2', 'card__title', { text: title }));
  if (subtitle) add(root, el('p', 'card__sub', { text: subtitle }));
  const actions = el('div', 'card__actions');
  return { root, actions };
}

/** Ряд звёзд, зажигающихся по очереди — маленькая награда за ожидание. */
function stars(count: number): HTMLElement {
  const row = el('div', 'stars');
  for (let i = 0; i < 3; i++) {
    const star = el('span', 'star', { text: '★' });
    row.appendChild(star);
    if (i < count) {
      setTimeout(() => star.classList.add('is-on'), 220 + i * 190);
    }
  }
  return row;
}

// ─── Победа на уровне ──────────────────────────────────────────────────────

export type VictoryChoice = 'next' | 'double' | 'menu' | 'collection';

export function showVictory(
  root: HTMLElement,
  opts: {
    title: string;
    stars: number;
    coins: number;
    moves: number;
    minMoves: number;
    /** ×2 ещё не взят — показываем rewarded-кнопку. */
    canDouble: boolean;
    nextLabel: string;
  }
): Promise<VictoryChoice> {
  return new Promise((resolve) => {
    const { root: box, actions } = card(opts.title);
    add(box, stars(opts.stars));

    const summary = el('p', 'muted');
    const perfect = opts.minMoves > 0 && opts.moves <= opts.minMoves;
    summary.textContent = perfect
      ? `Идеально: ${opts.moves} ${plural(opts.moves, 'ход', 'хода', 'ходов')}`
      : opts.minMoves > 0
        ? `${opts.moves} ${plural(opts.moves, 'ход', 'хода', 'ходов')}, оптимум ${opts.minMoves}`
        : `${opts.moves} ${plural(opts.moves, 'ход', 'хода', 'ходов')}`;
    add(box, summary);

    const reward = el('p', 'coins');
    reward.textContent = `+${formatNumber(opts.coins)}`;
    reward.style.marginTop = '12px';
    add(box, reward);

    let close = () => {};
    const pick = (choice: VictoryChoice) => {
      close();
      resolve(choice);
    };

    if (opts.canDouble) {
      add(
        actions,
        button('▶ ×2 к монетам', 'btn btn--rewarded btn--wide', () => pick('double'))
      );
    }
    add(
      actions,
      button(opts.nextLabel, 'btn btn--primary btn--wide', () => pick('next')),
      button('Витрина', 'btn btn--ghost btn--wide btn--sm', () => pick('collection')),
      button('В меню', 'btn btn--ghost btn--wide btn--sm', () => pick('menu'))
    );
    add(box, actions);
    close = mountOverlay(root, box);
  });
}

// ─── Тупик ────────────────────────────────────────────────────────────────

export type DeadlockChoice = 'extraShelf' | 'restart' | 'menu';

/**
 * Ходов больше нет.
 *
 * Это единственный корректный момент для предложения «+1 витрина» (план, §10):
 * предложение по таймеру игрок воспринимает как навязчивую рекламу, а в тупике
 * — как спасение. Отсюда и порядок кнопок: rewarded первым и самым заметным.
 *
 * В соревновательных режимах спасения нет: там тупик — это цена ошибки, и
 * продавать выход из неё за ролик значило бы продавать место в таблице.
 * Уровень при этом гарантированно решаем, так что «Заново» — честный выход.
 */
export function showDeadlock(
  root: HTMLElement,
  opts: { canExtraShelf: boolean }
): Promise<DeadlockChoice> {
  return new Promise((resolve) => {
    const { root: box, actions } = card(
      'Ходов больше нет',
      opts.canExtraShelf
        ? 'Все витрины заняты. Свободная витрина расшивает любой тупик.'
        : 'Все витрины заняты. Этот уровень решается — попробуйте другой порядок.'
    );
    let close = () => {};
    const pick = (choice: DeadlockChoice) => {
      close();
      resolve(choice);
    };
    if (opts.canExtraShelf) {
      add(
        actions,
        button('▶ +1 свободная витрина', 'btn btn--rewarded btn--wide', () => pick('extraShelf'))
      );
    }
    add(
      actions,
      button('Заново', 'btn btn--ghost btn--wide', () => pick('restart')),
      button('В меню', 'btn btn--ghost btn--wide btn--sm', () => pick('menu'))
    );
    add(box, actions);
    close = mountOverlay(root, box);
  });
}

// ─── Итог блица ───────────────────────────────────────────────────────────

export type BlitzChoice = 'retry' | 'retryAd' | 'leaderboard' | 'menu' | 'share';

export function showBlitzResult(
  root: HTMLElement,
  opts: {
    score: number;
    best: number;
    isRecord: boolean;
    sets: number;
    /** Лучшая фигурка коллекции — украшает карточку результата. */
    trophy?: FigurineDef;
    /** Место в недельном лидерборде; null — игрока в таблице пока нет. */
    rank: number | null;
    freeAttempts: number;
    refillIn: number;
  }
): Promise<BlitzChoice> {
  return new Promise((resolve) => {
    const { root: box, actions } = card(opts.isRecord ? 'Новый рекорд!' : 'Забег окончен');

    // Карточка результата — то, чем хвастаются (план, §2).
    const share = el('div', 'share');
    if (opts.trophy) {
      const fig = el('div', 'share__fig');
      fig.innerHTML = figurineSvg(opts.trophy.shape, opts.trophy.colors, figurineLook(opts.trophy));
      add(share, fig);
    }
    add(
      share,
      el('div', 'share__score', { text: formatNumber(opts.score) }),
      el('div', 'tiny', {
        text: `${opts.sets} ${plural(opts.sets, 'витрина', 'витрины', 'витрин')} за 60 секунд`,
      }),
      el('div', 'muted', {
        text: opts.isRecord ? 'Личный рекорд' : `Рекорд: ${formatNumber(opts.best)}`,
      })
    );
    // Место в топе — вторая половина повода поделиться (план, §2): очки без
    // места ни с чем не сравниваются.
    if (opts.rank !== null) {
      add(share, el('div', 'rarity rarity--rare', { text: `${opts.rank} место за неделю` }));
    }
    add(box, share);

    let close = () => {};
    const pick = (choice: BlitzChoice) => {
      if (choice === 'share') return; // шеринг не закрывает диалог
      close();
      resolve(choice);
    };

    if (opts.freeAttempts > 0) {
      add(
        actions,
        button('Ещё забег', 'btn btn--primary btn--wide', () => pick('retry'))
      );
    } else {
      add(
        actions,
        button('▶ Ещё забег', 'btn btn--rewarded btn--wide', () => pick('retryAd'))
      );
      if (opts.refillIn > 0) {
        add(
          actions,
          el('div', 'tiny', { text: `Бесплатная попытка через ${formatClock(opts.refillIn)}` })
        );
      }
    }

    const shareBtn = button('Поделиться результатом', 'btn btn--ghost btn--wide btn--sm', () => {
      resolve('share');
    });
    add(
      actions,
      shareBtn,
      button('Лидеры недели', 'btn btn--ghost btn--wide btn--sm', () => pick('leaderboard')),
      button('В меню', 'btn btn--ghost btn--wide btn--sm', () => pick('menu'))
    );
    add(box, actions);
    close = mountOverlay(root, box);
  });
}

// ─── Ежедневный вызов ─────────────────────────────────────────────────────

export function showDailyResult(
  root: HTMLElement,
  opts: { moves: number; best: number; isRecord: boolean; coins: number }
): Promise<'leaderboard' | 'menu'> {
  return new Promise((resolve) => {
    const { root: box, actions } = card(
      'Вызов дня пройден',
      opts.isRecord ? 'Лучший результат за сегодня — ваш' : undefined
    );
    add(
      box,
      el('div', 'share__score', { text: String(opts.moves) }),
      el('div', 'tiny', { text: plural(opts.moves, 'ХОД', 'ХОДА', 'ХОДОВ') })
    );
    if (opts.best > 0 && !opts.isRecord) {
      add(box, el('p', 'muted', { text: `Ваш рекорд: ${opts.best}` }));
    }
    const reward = el('p', 'coins', { text: `+${formatNumber(opts.coins)}` });
    reward.style.marginTop = '12px';
    add(box, reward);

    let close = () => {};
    const pick = (choice: 'leaderboard' | 'menu') => {
      close();
      resolve(choice);
    };
    add(
      actions,
      button('Кто быстрее', 'btn btn--primary btn--wide', () => pick('leaderboard')),
      button('В меню', 'btn btn--ghost btn--wide btn--sm', () => pick('menu'))
    );
    add(box, actions);
    close = mountOverlay(root, box);
  });
}

// ─── Блайнд-бокс ──────────────────────────────────────────────────────────

/**
 * Открытие бокса. Сначала пауза с закрытой коробкой, потом фигурка — без этой
 * паузы нет никакого предвкушения, а именно оно и есть продукт.
 */
export function showBoxReveal(
  root: HTMLElement,
  opts: { figurine: FigurineDef; duplicate: boolean; duplicates: number }
): Promise<void> {
  return new Promise((resolve) => {
    const { root: box, actions } = card('Блайнд-бокс');

    const reveal = el('div', 'reveal');
    reveal.innerHTML = figurineSvg(
      opts.figurine.shape,
      opts.figurine.colors,
      figurineLook(opts.figurine)
    );
    add(box, reveal);

    add(
      box,
      el('h3', 'h2', { text: opts.figurine.name }),
      el('span', `rarity rarity--${opts.figurine.rarity}`, {
        text: RARITY_LABEL[opts.figurine.rarity],
      })
    );

    if (opts.duplicate) {
      add(
        box,
        el('p', 'muted', {
          text: `Уже есть — в обмен. Дубликатов: ${opts.duplicates}`,
        })
      );
    }

    let close = () => {};
    add(
      actions,
      button('На витрину', 'btn btn--primary btn--wide', () => {
        close();
        resolve();
      })
    );
    add(box, actions);
    close = mountOverlay(root, box);
  });
}

// ─── Стрик ────────────────────────────────────────────────────────────────

export function showStreak(
  root: HTMLElement,
  opts: { day: number; coins: number }
): Promise<void> {
  return new Promise((resolve) => {
    const { root: box, actions } = card(
      'Вы вернулись',
      `День ${opts.day} подряд. Награда растёт до седьмого дня.`
    );

    const calendar = el('div', 'streak');
    for (let i = 1; i <= STREAK_REWARDS.length; i++) {
      const day = el('div', 'streak__day');
      // Дни цикла отсчитываются по модулю: на 9-й день подряд подсвечивается
      // вторая клетка, а не пустота за пределами календаря.
      const cycleDay = ((opts.day - 1) % STREAK_REWARDS.length) + 1;
      if (i < cycleDay) day.classList.add('streak__day--done');
      if (i === cycleDay) day.classList.add('streak__day--today', 'streak__day--done');
      add(day, el('b', undefined, { text: String(streakReward(i)) }), el('span', undefined, { text: `дн. ${i}` }));
      calendar.appendChild(day);
    }
    add(box, calendar);

    const reward = el('p', 'coins', { text: `+${formatNumber(opts.coins)}` });
    reward.style.marginTop = '14px';
    add(box, reward);

    let close = () => {};
    add(
      actions,
      button('Забрать', 'btn btn--primary btn--wide', () => {
        close();
        resolve();
      })
    );
    add(box, actions);
    close = mountOverlay(root, box);
  });
}

// ─── Новый сезон ──────────────────────────────────────────────────────────

export function showSeasonAnnounce(root: HTMLElement, season: Season, daysLeft: number): Promise<void> {
  return new Promise((resolve) => {
    const { root: box, actions } = card(`Сезон ${season.id}`, season.tagline);
    add(box, el('h3', 'brand', { text: season.name }));

    // Превью серии: шесть силуэтов достаточно, чтобы показать новую палитру,
    // и не превращают диалог в простыню.
    const strip = el('div', 'grid');
    strip.style.gridTemplateColumns = 'repeat(6, 1fr)';
    for (const fig of season.playable.slice(0, 6)) {
      const cell = el('div', 'fig');
      cell.innerHTML = figurineSvg(fig.shape, fig.colors, figurineLook(fig, false));
      strip.appendChild(cell);
    }
    add(box, strip);
    add(
      box,
      el('p', 'muted', {
        text: `${daysLeft} ${plural(daysLeft, 'день', 'дня', 'дней')} до конца сезона`,
      })
    );

    let close = () => {};
    add(
      actions,
      button('Собирать', 'btn btn--primary btn--wide', () => {
        close();
        resolve();
      })
    );
    add(box, actions);
    close = mountOverlay(root, box);
  });
}

// ─── Пауза ────────────────────────────────────────────────────────────────

export type PauseChoice = 'resume' | 'restart' | 'menu';

export function showPause(root: HTMLElement): Promise<PauseChoice> {
  return new Promise((resolve) => {
    const { root: box, actions } = card('Пауза');
    let close = () => {};
    const pick = (choice: PauseChoice) => {
      close();
      resolve(choice);
    };
    add(
      actions,
      button('Продолжить', 'btn btn--primary btn--wide', () => pick('resume')),
      button('Начать заново', 'btn btn--ghost btn--wide btn--sm', () => pick('restart')),
      button('В меню', 'btn btn--ghost btn--wide btn--sm', () => pick('menu'))
    );
    add(box, actions);
    close = mountOverlay(root, box, { dismissible: true, onDismiss: () => resolve('resume') });
  });
}

// ─── Вводный гайд ─────────────────────────────────────────────────────────

/**
 * Как играть. Показывается один раз — перед первой партией, а дальше только по
 * кнопке в меню (см. Profile.tutorialSeen).
 *
 * Почему картинками, а не текстом: правило «тап — тап» объясняется одним
 * взглядом на две витрины со стрелкой и не объясняется тремя строчками, которые
 * никто не читает. Рисуется теми же фигурками и теми же CSS-переменными, что и
 * игра, поэтому гайд не расходится с тем, что игрок увидит через секунду, — и
 * не требует ни одной картинки в сборке.
 *
 * Шаги короткие и их четыре: правило переноса, правило совпадения, закрытие
 * витрины и цель уровня. Пятого правила в игре просто нет.
 */
export function showTutorial(root: HTMLElement, species: FigurineDef[]): Promise<void> {
  const a = species[1] ?? species[0];
  const b = species[5] ?? species[species.length - 1];

  const steps: Array<{ title: string; text: string; art: () => HTMLElement }> = [
    {
      title: 'Берём фигурку',
      text: 'Тап по витрине поднимает верхнюю фигурку. Тап по ней же — кладёт обратно.',
      // Поднятая фигурка нарисована НАД витриной и убрана из стопки: если
      // оставить её и там, и там, картинка противоречит подписи.
      art: () =>
        tutorialScene([
          { stack: [b, a], state: 'selected', lifted: a },
          { stack: [b, b] },
        ]),
    },
    {
      title: 'Ставим к своим',
      text: 'Второй тап переносит её в пустую витрину или на такую же фигурку. По одной за раз.',
      art: () =>
        tutorialScene([
          { stack: [b], state: 'selected', lifted: a, arrow: true },
          { stack: [a, a], state: 'available' },
        ]),
    },
    {
      title: 'Витрина закрывается',
      text: 'Когда витрина заполнена одним видом целиком, её запирает стекло. Это готовый сет.',
      art: () =>
        tutorialScene([
          { stack: [a, a, a, a], state: 'closed' },
          { stack: [b, b] },
        ]),
    },
    {
      title: 'Цель',
      text: 'Закрыть все витрины. Чем меньше ходов — тем больше звёзд и монет.',
      art: () =>
        tutorialScene([
          { stack: [a, a, a, a], state: 'closed' },
          { stack: [b, b, b, b], state: 'closed' },
        ]),
    },
  ];

  return new Promise((resolve) => {
    const box = el('div', 'card');
    const title = el('h2', 'card__title');
    const text = el('p', 'card__sub');
    const art = el('div', 'tut__art');
    const dots = el('div', 'tut__dots');
    const actions = el('div', 'card__actions');
    const next = button('Дальше', 'btn btn--primary btn--wide', () => go(step + 1));
    const skip = button('Пропустить', 'btn btn--ghost btn--wide btn--sm', () => finish());

    add(box, title, text, art, dots, actions);
    add(actions, next, skip);

    let step = -1;
    let close = () => {};

    const finish = () => {
      close();
      resolve();
    };

    const go = (to: number) => {
      if (to >= steps.length) {
        finish();
        return;
      }
      step = to;
      const current = steps[step];
      title.textContent = current.title;
      text.textContent = current.text;
      clear(art);
      add(art, current.art());
      clear(dots);
      for (let i = 0; i < steps.length; i++) {
        dots.appendChild(el('i', i === step ? 'is-on' : undefined));
      }
      const last = step === steps.length - 1;
      next.innerHTML = last ? 'Играть' : 'Дальше';
      skip.style.display = last ? 'none' : '';
    };

    go(0);
    close = mountOverlay(root, box);
  });
}

interface TutorialShelf {
  /** Фигурки снизу вверх. */
  stack: FigurineDef[];
  state?: 'selected' | 'available' | 'closed';
  /** Эта фигурка нарисована приподнятой над витриной — она «в руке». */
  lifted?: FigurineDef;
  arrow?: boolean;
}

/** Мини-сцена из витрин: та же геометрия, что и на поле, но без Pixi. */
function tutorialScene(shelves: TutorialShelf[]): HTMLElement {
  const scene = el('div', 'tut__scene');
  for (const shelf of shelves) {
    const wrap = el('div', 'tut__slot');
    if (shelf.lifted) {
      const hand = el('div', 'tut__hand');
      hand.innerHTML = figurineSvg(shelf.lifted.shape, shelf.lifted.colors, {
        ...figurineLook(shelf.lifted, false),
      });
      add(wrap, hand);
    }
    const box = el('div', `tut__shelf${shelf.state ? ` is-${shelf.state}` : ''}`);
    for (const fig of shelf.stack) {
      const cell = el('div', 'tut__fig');
      cell.innerHTML = figurineSvg(fig.shape, fig.colors, figurineLook(fig, false));
      add(box, cell);
    }
    add(wrap, box);
    add(scene, wrap);
    if (shelf.arrow) add(scene, el('div', 'tut__arrow', { text: '→' }));
  }
  return scene;
}

// ─── Подтверждение ────────────────────────────────────────────────────────

export function showConfirm(
  root: HTMLElement,
  opts: { title: string; text?: string; confirm: string; cancel?: string }
): Promise<boolean> {
  return new Promise((resolve) => {
    const { root: box, actions } = card(opts.title, opts.text);
    let close = () => {};
    add(
      actions,
      button(opts.confirm, 'btn btn--primary btn--wide', () => {
        close();
        resolve(true);
      }),
      button(opts.cancel ?? 'Отмена', 'btn btn--ghost btn--wide btn--sm', () => {
        close();
        resolve(false);
      })
    );
    add(box, actions);
    close = mountOverlay(root, box, { dismissible: true, onDismiss: () => resolve(false) });
  });
}
