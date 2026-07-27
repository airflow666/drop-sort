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
import {
  figurineLook,
  figurineName,
  finishLabel,
  rarityLabel,
  seasonName,
  seasonTagline,
  type FigurineDef,
  type Season,
} from '../theme/seasons';
import { add, button, clear, el, formatClock, mountOverlay } from './dom';
import { formatNumber, pluralize, t } from '../i18n';
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
    const moves = pluralize(opts.moves, 'moves');
    summary.textContent = perfect
      ? t('victory.perfect', { n: opts.moves, moves })
      : opts.minMoves > 0
        ? t('victory.withOptimum', { n: opts.moves, moves, best: opts.minMoves })
        : t('victory.plain', { n: opts.moves, moves });
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
        button(t('victory.double'), 'btn btn--rewarded btn--wide', () => pick('double'))
      );
    }
    add(
      actions,
      button(opts.nextLabel, 'btn btn--primary btn--wide', () => pick('next')),
      button(t('victory.collection'), 'btn btn--ghost btn--wide btn--sm', () => pick('collection')),
      button(t('common.menu'), 'btn btn--ghost btn--wide btn--sm', () => pick('menu'))
    );
    add(box, actions);
    close = mountOverlay(root, box);
  });
}

// ─── Тупик ────────────────────────────────────────────────────────────────

export type DeadlockChoice = 'extraShelf' | 'restart' | 'menu';

/**
 * Партия зашла в тупик.
 *
 * Это единственный корректный момент для предложения «+1 витрина» (план, §10):
 * предложение по таймеру игрок воспринимает как навязчивую рекламу, а в тупике
 * — как спасение. Отсюда и порядок кнопок: rewarded первым и самым заметным.
 *
 * В соревновательных режимах спасения нет: там тупик — это цена ошибки, и
 * продавать выход из неё за ролик значило бы продавать место в таблице.
 * Уровень при этом гарантированно решаем, так что «Заново» — честный выход.
 *
 * `proven` различает два тупика с разным текстом. Обычный — ходов физически
 * нет. Доказанный солвером — ходы есть, но ни один не ведёт к победе; здесь
 * заголовок «Ходов больше нет» противоречил бы полю, на которое игрок в этот
 * момент смотрит.
 */
export function showDeadlock(
  root: HTMLElement,
  opts: { canExtraShelf: boolean; proven?: boolean }
): Promise<DeadlockChoice> {
  return new Promise((resolve) => {
    const { root: box, actions } = card(
      opts.proven ? t('deadlock.provenTitle') : t('deadlock.title'),
      opts.proven
        ? opts.canExtraShelf
          ? t('deadlock.provenCanHelp')
          : t('deadlock.provenNoHelp')
        : opts.canExtraShelf
          ? t('deadlock.canHelp')
          : t('deadlock.noHelp')
    );
    let close = () => {};
    const pick = (choice: DeadlockChoice) => {
      close();
      resolve(choice);
    };
    if (opts.canExtraShelf) {
      add(
        actions,
        button(t('deadlock.extraShelf'), 'btn btn--rewarded btn--wide', () => pick('extraShelf'))
      );
    }
    add(
      actions,
      button(t('common.restart'), 'btn btn--ghost btn--wide', () => pick('restart')),
      button(t('common.menu'), 'btn btn--ghost btn--wide btn--sm', () => pick('menu'))
    );
    add(box, actions);
    close = mountOverlay(root, box);
  });
}

// ─── Итог блица ───────────────────────────────────────────────────────────

export type BlitzChoice = 'retry' | 'retryAd' | 'leaderboard' | 'menu';

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
    /**
     * Шеринг обрабатывается здесь колбэком, а не как выбор, который
     * закрывает диалог: после шеринга игрок остаётся на той же карточке
     * результата. Раньше кнопка звала resolve('share') напрямую, диалог не
     * закрывался, а вызывающий код в ответ монтировал ВТОРОЙ showBlitzResult
     * поверх первого — старый оверлей никогда не убирался и оставался на
     * экране поверх новой игры (см. отчёт QA про застрявшее меню блица).
     */
    onShare: () => void;
  }
): Promise<BlitzChoice> {
  return new Promise((resolve) => {
    const { root: box, actions } = card(opts.isRecord ? t('blitz.record') : t('blitz.over'));

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
        text: t('blitz.summary', { n: opts.sets, shelves: pluralize(opts.sets, 'shelves') }),
      }),
      el('div', 'muted', {
        text: opts.isRecord
          ? t('blitz.personalBest')
          : t('blitz.best', { n: formatNumber(opts.best) }),
      })
    );
    // Место в топе — вторая половина повода поделиться (план, §2): очки без
    // места ни с чем не сравниваются.
    if (opts.rank !== null) {
      add(share, el('div', 'rarity rarity--rare', { text: t('blitz.rank', { n: opts.rank }) }));
    }
    add(box, share);

    let close = () => {};
    const pick = (choice: BlitzChoice) => {
      close();
      resolve(choice);
    };

    if (opts.freeAttempts > 0) {
      add(
        actions,
        button(t('blitz.again'), 'btn btn--primary btn--wide', () => pick('retry'))
      );
    } else {
      add(
        actions,
        button(t('blitz.againAd'), 'btn btn--rewarded btn--wide', () => pick('retryAd'))
      );
      if (opts.refillIn > 0) {
        add(
          actions,
          el('div', 'tiny', { text: t('blitz.refill', { clock: formatClock(opts.refillIn) }) })
        );
      }
    }

    const shareBtn = button(t('blitz.share'), 'btn btn--ghost btn--wide btn--sm', () => {
      opts.onShare();
    });
    add(
      actions,
      shareBtn,
      button(t('blitz.leaders'), 'btn btn--ghost btn--wide btn--sm', () => pick('leaderboard')),
      button(t('common.menu'), 'btn btn--ghost btn--wide btn--sm', () => pick('menu'))
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
      t('daily.title'),
      opts.isRecord ? t('daily.record') : undefined
    );
    add(
      box,
      el('div', 'share__score', { text: String(opts.moves) }),
      el('div', 'tiny', { text: t('daily.movesCaps') })
    );
    if (opts.best > 0 && !opts.isRecord) {
      add(box, el('p', 'muted', { text: t('daily.yourBest', { n: opts.best }) }));
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
      button(t('daily.leaders'), 'btn btn--primary btn--wide', () => pick('leaderboard')),
      button(t('common.menu'), 'btn btn--ghost btn--wide btn--sm', () => pick('menu'))
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
    const { root: box, actions } = card(t('box.title'));

    const reveal = el('div', 'reveal');
    reveal.innerHTML = figurineSvg(
      opts.figurine.shape,
      opts.figurine.colors,
      figurineLook(opts.figurine)
    );
    add(box, reveal);

    const tags = el('div', 'tags');
    add(
      tags,
      el('span', `rarity rarity--${opts.figurine.rarity}`, {
        text: rarityLabel(opts.figurine.rarity),
      })
    );
    // Отделка — то, ради чего чейз и открывают: холо, блёстки, прозрачный
    // пластик, металлик. Без подписи игрок видит «просто другой цвет».
    if (opts.figurine.finish) {
      add(
        tags,
        el('span', 'rarity rarity--finish', { text: finishLabel(opts.figurine.finish) })
      );
    }
    add(box, el('h3', 'h2', { text: figurineName(opts.figurine) }), tags);

    if (opts.duplicate) {
      add(
        box,
        el('p', 'muted', { text: t('box.duplicate', { n: opts.duplicates }) })
      );
    }

    let close = () => {};
    add(
      actions,
      button(t('box.toShelf'), 'btn btn--primary btn--wide', () => {
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
    const { root: box, actions } = card(t('streak.title'), t('streak.note', { n: opts.day }));

    const calendar = el('div', 'streak');
    for (let i = 1; i <= STREAK_REWARDS.length; i++) {
      const day = el('div', 'streak__day');
      // Дни цикла отсчитываются по модулю: на 9-й день подряд подсвечивается
      // вторая клетка, а не пустота за пределами календаря.
      const cycleDay = ((opts.day - 1) % STREAK_REWARDS.length) + 1;
      if (i < cycleDay) day.classList.add('streak__day--done');
      if (i === cycleDay) day.classList.add('streak__day--today', 'streak__day--done');
      add(
        day,
        el('b', undefined, { text: String(streakReward(i)) }),
        el('span', undefined, { text: t('streak.day', { n: i }) })
      );
      calendar.appendChild(day);
    }
    add(box, calendar);

    const reward = el('p', 'coins', { text: `+${formatNumber(opts.coins)}` });
    reward.style.marginTop = '14px';
    add(box, reward);

    let close = () => {};
    add(
      actions,
      button(t('streak.claim'), 'btn btn--primary btn--wide', () => {
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
    const { root: box, actions } = card(
      t('season.title', { n: season.id }),
      seasonTagline(season.id)
    );
    add(box, el('h3', 'brand', { text: seasonName(season.id) }));

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
        text: t('season.daysLeft', { n: daysLeft, days: pluralize(daysLeft, 'days') }),
      })
    );

    let close = () => {};
    add(
      actions,
      button(t('season.collect'), 'btn btn--primary btn--wide', () => {
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
    const { root: box, actions } = card(t('pause.title'));
    let close = () => {};
    const pick = (choice: PauseChoice) => {
      close();
      resolve(choice);
    };
    add(
      actions,
      button(t('common.resume'), 'btn btn--primary btn--wide', () => pick('resume')),
      button(t('pause.restart'), 'btn btn--ghost btn--wide btn--sm', () => pick('restart')),
      button(t('common.menu'), 'btn btn--ghost btn--wide btn--sm', () => pick('menu'))
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
 * Шагов пять: правило переноса, правило совпадения, закрытие витрины, цель
 * уровня и предупреждение о тупике — неудачный порядок ходов может завести
 * туда, откуда до победы не дойти (см. модалку `showDeadlock`). Без этого
 * шага игрок узнаёт о тупике только напоровшись на него посреди платной
 * подсказки — ровно то, на что жаловался QA.
 */
export function showTutorial(root: HTMLElement, species: FigurineDef[]): Promise<void> {
  const a = species[1] ?? species[0];
  const b = species[5] ?? species[species.length - 1];

  const steps: Array<{ title: string; text: string; art: () => HTMLElement }> = [
    {
      title: t('tutorial.step1.title'),
      text: t('tutorial.step1.text'),
      // Поднятая фигурка нарисована НАД витриной и убрана из стопки: если
      // оставить её и там, и там, картинка противоречит подписи.
      art: () =>
        tutorialScene([
          { stack: [b, a], state: 'selected', lifted: a },
          { stack: [b, b] },
        ]),
    },
    {
      title: t('tutorial.step2.title'),
      text: t('tutorial.step2.text'),
      art: () =>
        tutorialScene([
          { stack: [b], state: 'selected', lifted: a, arrow: true },
          { stack: [a, a], state: 'available' },
        ]),
    },
    {
      title: t('tutorial.step3.title'),
      text: t('tutorial.step3.text'),
      art: () =>
        tutorialScene([
          { stack: [a, a, a, a], state: 'closed' },
          { stack: [b, b] },
        ]),
    },
    {
      title: t('tutorial.step4.title'),
      text: t('tutorial.step4.text'),
      art: () =>
        tutorialScene([
          { stack: [a, a, a, a], state: 'closed' },
          { stack: [b, b, b, b], state: 'closed' },
        ]),
    },
    {
      title: t('tutorial.step5.title'),
      text: t('tutorial.step5.text'),
      // Обе витрины полны и ни одна пара сверху не совпадает — картинка
      // тупика, без выдуманного шестого состояния сцены.
      art: () =>
        tutorialScene([
          { stack: [a, b] },
          { stack: [b, a] },
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
    const next = button(t('tutorial.next'), 'btn btn--primary btn--wide', () => go(step + 1));
    const skip = button(t('tutorial.skip'), 'btn btn--ghost btn--wide btn--sm', () => finish());

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
      next.innerHTML = last ? t('tutorial.play') : t('tutorial.next');
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
      button(opts.cancel ?? t('common.cancel'), 'btn btn--ghost btn--wide btn--sm', () => {
        close();
        resolve(false);
      })
    );
    add(box, actions);
    close = mountOverlay(root, box, { dismissible: true, onDismiss: () => resolve(false) });
  });
}
