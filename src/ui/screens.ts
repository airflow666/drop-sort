/**
 * Полноэкранные экраны: меню, витрина (коллекция), лидеры, магазин.
 *
 * Каждый экран — это функция, которая строит DOM и возвращает объект с корнем и
 * методом destroy. Роутинг живёт в src/app.ts.
 */

import { figurineSvg } from '../theme/figurines';
import {
  figurineLook,
  RARITY_LABEL,
  SEASONS,
  seasonById,
  seasonDaysLeft,
  type FigurineDef,
  type SeasonTheme,
} from '../theme/seasons';
import { skinById, skinChipSvg, SKINS, type Skin } from '../theme/skins';
import type { Profile } from '../meta/profile';
import { BLIND_BOX_COST, DUPLICATES_PER_BOX } from '../meta/profile';
import type { CatalogItem, LeaderboardEntry } from '../platform/sdk';
import { add, button, el, formatClock, formatNumber, iconButton, plural } from './dom';

export interface Screen {
  root: HTMLElement;
  destroy(): void;
}

/** Технические имена лидербордов. Должны совпадать с созданными в консоли. */
export const LEADERBOARD_BLITZ = 'blitz_weekly';
export const LEADERBOARD_DAILY = 'daily_moves';

function screen(className = ''): HTMLElement {
  return el('div', `screen ${className}`.trim());
}

function head(title: string, onBack: () => void): HTMLElement {
  const bar = el('div', 'screen__head');
  add(bar, iconButton('‹', 'Назад', 'icon-btn', onBack), el('h2', 'h2', { text: title }));
  return bar;
}

// ─── Меню ─────────────────────────────────────────────────────────────────

export interface MenuActions {
  onCampaign(): void;
  onBlitz(): void;
  onDaily(): void;
  onCollection(): void;
  onShop(): void;
  onLeaderboard(): void;
  /** Показать вводный гайд ещё раз. */
  onHowToPlay(): void;
  onToggleSound(): void;
}

export function createMenu(profile: Profile, actions: MenuActions): Screen {
  const root = screen('menu');
  const season = seasonById(profile.seasonId);
  const progress = profile.seasonProgress(season.id);

  // Монеты и звук прижаты к верхнему правому углу и не участвуют в центровке.
  const top = el('div', 'menu__top');
  add(
    top,
    el('span', 'coins', { text: formatNumber(profile.coins) }),
    iconButton(profile.settings.muted ? '🔇' : '🔊', 'Звук', 'icon-btn', actions.onToggleSound)
  );
  add(root, top);

  add(root, el('h1', 'brand', { text: 'DROP' }), el('p', 'tagline', { text: season.tagline }));

  const modes = el('div', 'menu__modes');

  // --- Кампания ---
  const resume = profile.resume;
  const campaignNote = resume?.mode === 'campaign' ? 'продолжить партию' : 'бесконечная лента';
  add(
    modes,
    modeCard({
      icon: '▦',
      title: `Витрина ${profile.campaignLevel}`,
      note: campaignNote,
      status: `${profile.totalStars} ★`,
      primary: true,
      onPress: actions.onCampaign,
    })
  );

  // --- Блиц ---
  const attempts = profile.blitzAttempts;
  const refill = profile.blitzRefillIn;
  add(
    modes,
    modeCard({
      icon: '⚡',
      title: 'Блиц',
      note:
        attempts > 0
          ? `60 секунд · ${attempts} ${plural(attempts, 'попытка', 'попытки', 'попыток')}`
          : `попытка через ${formatClock(refill)}`,
      status: profile.blitzBest > 0 ? formatNumber(profile.blitzBest) : '—',
      onPress: actions.onBlitz,
    })
  );

  // --- Вызов дня ---
  const done = profile.dailyDoneToday;
  add(
    modes,
    modeCard({
      icon: '◈',
      title: 'Вызов дня',
      note: done ? 'пройден — можно улучшить' : 'один уровень для всех',
      status: done ? `${profile.dailyBestMoves} ходов` : 'новый',
      onPress: actions.onDaily,
    })
  );
  add(root, modes);

  const row = el('div', 'menu__row');
  add(
    row,
    button(`Витрина ${progress.owned}/${progress.total}`, 'btn btn--ghost', actions.onCollection, {
      style: 'flex:1',
    }),
    button('Магазин', 'btn btn--ghost', actions.onShop, { style: 'flex:1' })
  );
  add(root, row);

  const row2 = el('div', 'menu__row');
  add(
    row2,
    button('Лидеры', 'btn btn--ghost btn--sm', actions.onLeaderboard, { style: 'flex:1' }),
    // Гайд сам показывается один раз перед первой партией; кнопка нужна тем,
    // кто его пропустил, и тем, кто вернулся через месяц.
    button('Как играть', 'btn btn--ghost btn--sm', actions.onHowToPlay, { style: 'flex:1' })
  );
  add(root, row2);

  // Полоса сезона: показывает, что серия конечна и её надо успеть собрать.
  const seasonBar = el('div');
  seasonBar.style.width = '100%';
  seasonBar.style.maxWidth = '400px';
  seasonBar.style.marginTop = '18px';
  const bar = el('div', 'progress');
  const fill = el('i');
  fill.style.width = `${(progress.owned / progress.total) * 100}%`;
  add(bar, fill);
  const daysLeft = seasonDaysLeft();
  add(
    seasonBar,
    el('div', 'tiny', {
      text: `СЕЗОН ${season.id} · ${season.name} · ${daysLeft} ${plural(daysLeft, 'день', 'дня', 'дней')}`,
    }),
    bar
  );
  add(root, seasonBar);

  return { root, destroy: () => root.remove() };
}

function modeCard(opts: {
  icon: string;
  title: string;
  note: string;
  status: string;
  primary?: boolean;
  onPress(): void;
}): HTMLElement {
  const node = button('', `mode${opts.primary ? ' mode--primary' : ''}`, opts.onPress);
  node.innerHTML = '';
  const text = el('span', 'mode__text');
  add(
    text,
    el('span', 'mode__title', { text: opts.title }),
    el('span', 'mode__note', { text: opts.note })
  );
  add(
    node,
    el('span', 'mode__icon', { text: opts.icon }),
    text,
    el('span', 'mode__status', { text: opts.status })
  );
  return node;
}

// ─── Витрина (коллекция) ──────────────────────────────────────────────────

export interface CollectionActions {
  onBack(): void;
  /** Открыть бокс за монеты. */
  onBuyBox(): void;
  /** Открыть бокс за просмотр рекламы. */
  onAdBox(): void;
  /** Обменять дубликаты на бокс. */
  onExchange(): void;
  /** Выставить собранную фигурку на поле вместо стандартной. */
  onEquip(key: string): void;
}

export function createCollection(profile: Profile, actions: CollectionActions): Screen {
  const root = screen();
  add(root, head('Витрина', actions.onBack));

  const body = el('div', 'screen__body');

  // Панель открытия боксов. Три пути и ни одного за реальные деньги — это
  // сознательное ограничение из плана (§8): случайное содержимое за деньги
  // при молодой аудитории неуместно и рискованно на модерации.
  const boxPanel = el('div', 'card');
  boxPanel.style.textAlign = 'left';
  add(
    boxPanel,
    el('h3', 'h2', { text: 'Блайнд-бокс' }),
    el('p', 'card__sub', {
      text: 'Случайная фигурка серии. Только за монеты, дубликаты или просмотр — никогда за деньги.',
    })
  );
  const boxActions = el('div', 'card__actions');
  const buyBtn = button(
    `Открыть · ${BLIND_BOX_COST} монет`,
    'btn btn--primary btn--wide',
    actions.onBuyBox
  );
  buyBtn.disabled = profile.coins < BLIND_BOX_COST;
  add(boxActions, buyBtn, button('▶ Открыть за просмотр', 'btn btn--rewarded btn--wide', actions.onAdBox));

  const canExchange = profile.duplicates >= DUPLICATES_PER_BOX;
  const exchangeBtn = button(
    `Обменять дубликаты · ${profile.duplicates}/${DUPLICATES_PER_BOX}`,
    'btn btn--ghost btn--wide btn--sm',
    actions.onExchange
  );
  exchangeBtn.disabled = !canExchange;
  add(boxActions, exchangeBtn);
  add(boxPanel, boxActions);
  add(body, boxPanel);

  // Сезоны: текущий первым, остальные — под ним.
  const current = profile.seasonId;
  const ordered = [seasonById(current), ...SEASONS.filter((s) => s.id !== current)];

  // Что именно сейчас стоит на поле — по одному ключу на силуэт.
  const onField = new Set(profile.fieldSpecies(current).map((fig) => fig.key));

  add(
    body,
    el('p', 'muted', {
      text:
        'Нажмите на собранную фигурку — она выйдет на поле вместо стандартной. ' +
        'Каждый силуэт меняется отдельно.',
    })
  );

  for (const season of ordered) {
    const progress = profile.seasonProgress(season.id);
    const isCurrent = season.id === current;

    const header = el('div', 'season-head');
    add(
      header,
      el('b', undefined, { text: `${season.id} · ${season.name}` }),
      el('span', undefined, { text: `${progress.owned}/${progress.total}` })
    );
    if (isCurrent) {
      const badge = el('span', 'rarity rarity--rare', { text: 'сейчас' });
      add(header, badge);
    }
    add(body, header);

    const bar = el('div', 'progress');
    const fill = el('i');
    fill.style.width = `${(progress.owned / progress.total) * 100}%`;
    add(bar, fill);
    add(body, bar);

    const grid = el('div', 'grid');
    for (const fig of season.figurines) {
      // Плашка «на поле» ставится только собранной фигурке. Стандартный набор
      // серии стоит на поле и без коллекции, но помечать этим силуэт-заглушку
      // нельзя: получилось бы «этой фигурки у вас нет, и она сейчас на поле».
      grid.appendChild(
        figurineCell(
          fig,
          profile.ownedCount(fig.key),
          onField.has(fig.key) && profile.has(fig.key),
          actions.onEquip
        )
      );
    }
    add(body, grid);
  }

  add(root, body);
  return { root, destroy: () => root.remove() };
}

/**
 * Карточка фигурки. Собранная — это кнопка: тап выставляет фигурку на поле.
 * Не собранная остаётся неинтерактивным силуэтом, иначе игрок нажимал бы на
 * заглушку и не понимал, почему ничего не происходит.
 */
function figurineCell(
  fig: FigurineDef,
  count: number,
  active: boolean,
  onEquip: (key: string) => void
): HTMLElement {
  const owned = count > 0;
  const className =
    `fig${owned ? '' : ' fig--locked'}` +
    `${fig.rarity !== 'common' ? ` fig--${fig.rarity}` : ''}${active ? ' fig--active' : ''}`;
  const cell: HTMLElement = owned
    ? button('', className, () => onEquip(fig.key))
    : el('div', className);
  cell.title = active
    ? `${fig.name} — сейчас на поле`
    : owned
      ? `${fig.name} — ${RARITY_LABEL[fig.rarity]}. Нажмите, чтобы выставить на поле`
      : `${fig.name} — ${RARITY_LABEL[fig.rarity]}`;

  // Не полученная фигурка — силуэт без лица и без свечения. Видно, какой
  // именно формы не хватает: это цель, а не серый прямоугольник.
  const art = el('div');
  art.innerHTML = owned
    ? figurineSvg(fig.shape, fig.colors, figurineLook(fig))
    : figurineSvg(
        fig.shape,
        { ...fig.colors, base: '#2a2740', light: '#3b3757', dark: '#1a1830', rim: '#4a4568', ink: '#12111f', glow: '#2a2740' },
        { glow: false, silhouette: true }
      );
  art.style.width = '100%';
  add(cell, art);
  add(cell, el('div', 'fig__name', { text: owned ? fig.name : '???' }));
  if (count > 1) add(cell, el('span', 'fig__count', { text: `×${count}` }));
  if (active) add(cell, el('span', 'fig__on', { text: 'НА ПОЛЕ' }));
  return cell;
}

// ─── Лидеры ───────────────────────────────────────────────────────────────

export function createLeaderboard(opts: {
  onBack(): void;
  blitz: LeaderboardEntry[];
  daily: LeaderboardEntry[];
}): Screen {
  const root = screen();
  add(root, head('Лидеры', opts.onBack));
  const body = el('div', 'screen__body');

  const section = (title: string, note: string, entries: LeaderboardEntry[]) => {
    add(body, el('div', 'season-head', { html: `<b>${title}</b><span>${note}</span>` }));
    if (entries.length === 0) {
      add(
        body,
        el('p', 'muted', {
          text: 'Таблица пока пуста. Сыграйте — и займёте её первым.',
        })
      );
      return;
    }
    const list = el('div', 'lb');
    for (const entry of entries) {
      const row = el('div', `lb__row${entry.self ? ' lb__row--self' : ''}`);
      add(
        row,
        el('span', 'lb__rank', { text: String(entry.rank) }),
        el('span', 'lb__name', { text: entry.name }),
        el('span', 'lb__score', { text: formatNumber(entry.score) })
      );
      list.appendChild(row);
    }
    add(body, list);
  };

  section('Блиц', 'очки за неделю', opts.blitz);
  section('Вызов дня', 'меньше ходов — выше', opts.daily);

  add(root, body);
  return { root, destroy: () => root.remove() };
}

// ─── Магазин ──────────────────────────────────────────────────────────────

/**
 * Товары за реальные деньги.
 *
 * Все они детерминированные: игрок заранее видит, что получает (план, §8).
 * Случайного содержимого за деньги здесь нет и быть не должно — боксы
 * открываются только за монеты, дубликаты и rewarded.
 *
 * `id` должен совпадать с идентификатором товара в консоли разработчика.
 */
export interface ShopProduct {
  id: string;
  title: string;
  description: string;
  /** Цена из каталога платформы; пока каталог не пришёл — прочерк. */
  price: string;
  owned?: boolean;
}

export const SHOP_PRODUCTS: readonly Omit<ShopProduct, 'price'>[] = [
  {
    id: 'hints_10',
    title: '10 подсказок',
    description: 'Подсказка показывает следующий ход. Без рекламы.',
  },
  {
    id: 'no_ads',
    title: 'Убрать рекламу',
    description: 'Отключает фулскрины и баннер. Rewarded остаются по желанию.',
  },
  {
    id: 'week_pass',
    title: 'Недельный пропуск',
    description: 'Ежедневная награда монетами и подсказками на 7 дней.',
  },
  {
    id: 'skin_chrome',
    title: 'Скин витрин «Хром»',
    description: 'Полированный металл: фаска с бликом по кромке. Только внешний вид.',
  },
];

export function createShop(
  profile: Profile,
  catalog: CatalogItem[],
  opts: {
    onBack(): void;
    onBuy(id: string): void;
    /** Купить скин за внутриигровые монеты. */
    onBuySkin(id: string): void;
    /** Надеть уже купленный скин. */
    onApplySkin(id: string): void;
  }
): Screen {
  const root = screen();
  add(root, head('Магазин', opts.onBack));
  const body = el('div', 'screen__body');

  add(
    body,
    el('div', 'coins', { text: formatNumber(profile.coins) }),
    el('p', 'muted', {
      text: 'Всё, что покупается за деньги, показано заранее. Случайные боксы — только за монеты и просмотр.',
    })
  );

  // --- Скины витрин за монеты ---------------------------------------------
  // Товар за валюту нужен обязательно: без него монетам некуда деваться, кроме
  // блайнд-боксов, и накопления обесцениваются, едва серия собрана.
  const seasonTheme = seasonById(profile.seasonId).theme;
  add(
    body,
    el('div', 'season-head', { html: '<b>ВИТРИНЫ</b><span>только внешний вид</span>' }),
    el('p', 'tiny', {
      text: 'Скин меняет конструкцию витрины и форму интерфейса — на правила это не влияет.',
    })
  );
  for (const skin of SKINS) {
    if (skin.coins === null && skin.id !== '') continue; // за деньги — ниже, в общем списке
    const owned = skin.id === '' || profile.ownsSkin(skin.id);
    const active = profile.activeSkin === skin.id;

    const card = el('div', `mode${active ? ' mode--active' : ''}`);
    const text = el('span', 'mode__text');
    add(
      text,
      el('span', 'mode__title', { text: skin.name }),
      el('span', 'mode__note', { text: skin.description })
    );

    let action: HTMLElement;
    if (active) {
      action = el('span', 'mode__status', { text: 'надет' });
    } else if (owned) {
      action = button('Надеть', 'btn btn--ghost btn--sm', () => opts.onApplySkin(skin.id));
    } else {
      const buy = button(`${skin.coins}`, 'btn btn--primary btn--sm', () =>
        opts.onBuySkin(skin.id)
      );
      buy.disabled = profile.coins < (skin.coins ?? 0);
      action = buy;
    }
    add(card, skinChip(skin, seasonTheme), text, action);
    add(body, card);
  }

  add(body, el('div', 'season-head', { html: '<b>ЗА ДЕНЬГИ</b><span>без случайности</span>' }));

  for (const product of SHOP_PRODUCTS) {
    const listed = catalog.find((c) => c.id === product.id);
    const owned =
      (product.id === 'no_ads' && profile.noAds) ||
      (product.id.startsWith('skin_') && profile.ownsSkin(product.id));

    const card = el('div', 'mode');
    const text = el('span', 'mode__text');
    add(
      text,
      el('span', 'mode__title', { text: listed?.title || product.title }),
      el('span', 'mode__note', { text: listed?.description || product.description })
    );

    const isActiveSkin = product.id.startsWith('skin_') && profile.activeSkin === product.id;
    const action = isActiveSkin
      ? el('span', 'mode__status', { text: 'надет' })
      : owned && product.id.startsWith('skin_')
        ? button('Надеть', 'btn btn--ghost btn--sm', () => opts.onApplySkin(product.id))
        : owned
          ? el('span', 'mode__status', { text: 'куплено' })
          : button(listed?.price || '—', 'btn btn--primary btn--sm', () => opts.onBuy(product.id));
    if (!owned && !listed && action instanceof HTMLButtonElement) {
      // Каталог не пришёл (нет сети или монетизация не включена в консоли) —
      // кнопка неактивна, но товар видно: так понятнее, чем пустой экран.
      action.disabled = true;
    }

    // Скин показывается миниатюрой витрины, остальные товары — значком:
    // «10 подсказок» рисовать нечем, а скин без картинки не выбрать.
    const icon = product.id.startsWith('skin_')
      ? skinChip(skinById(product.id), seasonTheme)
      : el('span', 'mode__icon', { text: owned ? '✓' : '★' });
    if (isActiveSkin) card.classList.add('mode--active');

    add(card, icon, text, action);
    add(body, card);
  }

  add(root, body);
  return { root, destroy: () => root.remove() };
}

/** Миниатюра витрины со скином — по описанию конструкцию не выбрать. */
function skinChip(skin: Skin, theme: SeasonTheme): HTMLElement {
  const chip = el('span', 'skin-chip', { html: skinChipSvg(skin, theme) });
  chip.setAttribute('aria-hidden', 'true');
  return chip;
}
