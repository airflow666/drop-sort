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
import { RARITY_LABEL, type FigurineDef, type Season } from '../theme/seasons';
import { add, button, el, formatClock, formatNumber, mountOverlay, plural } from './dom';
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
 */
export function showDeadlock(root: HTMLElement): Promise<DeadlockChoice> {
  return new Promise((resolve) => {
    const { root: box, actions } = card(
      'Ходов больше нет',
      'Все витрины заняты. Свободная витрина расшивает любой тупик.'
    );
    let close = () => {};
    const pick = (choice: DeadlockChoice) => {
      close();
      resolve(choice);
    };
    add(
      actions,
      button('▶ +1 свободная витрина', 'btn btn--rewarded btn--wide', () => pick('extraShelf')),
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
      fig.innerHTML = figurineSvg(opts.trophy.shape, opts.trophy.colors, {
        glow: true,
        ...(opts.trophy.aura ? { aura: opts.trophy.aura } : {}),
      });
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
    reveal.innerHTML = figurineSvg(opts.figurine.shape, opts.figurine.colors, {
      glow: true,
      ...(opts.figurine.aura ? { aura: opts.figurine.aura } : {}),
    });
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
      cell.innerHTML = figurineSvg(fig.shape, fig.colors, { glow: false });
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
