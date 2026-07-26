/**
 * Сезоны, коллекция и редкости.
 *
 * Шесть серий по 12 фигурок (план, §5). Ядро при этом работает максимум с
 * 8 видами (план, §6), поэтому серия устроена как реальная линейка блайнд-
 * боксов: 8 «обычных» фигурок — по одной на каждый силуэт, они же и стоят на
 * поле, — плюс 4 чейза, редкие перекраски тех же силуэтов. Чейзы не выходят
 * на поле: там важна однозначная читаемость вида, а две розовые звезды с
 * разной отделкой её ломают. Зато именно они дают повод открывать боксы.
 *
 * Раскраска каждой фигурки выводится из одного базового цвета
 * (src/theme/color.ts) — 72 набора оттенков, набранные вручную, неизбежно
 * разъехались бы по светлоте.
 */

import { colorway, type Colorway, type ColorwayOptions } from './color';
import { SHAPE_IDS, shapeName, type ShapeId } from './figurines';

export type Rarity = 'common' | 'rare' | 'legendary';

export interface FigurineDef {
  /** Стабильный ключ для сохранений: менять нельзя, иначе коллекция сбросится. */
  key: string;
  season: number;
  shape: ShapeId;
  name: string;
  rarity: Rarity;
  colors: Colorway;
  /** Светящийся ободок — только у чейзов. */
  aura?: string;
}

export interface SeasonTheme {
  /** Верх и низ фонового градиента. */
  bgTop: string;
  bgBottom: string;
  /** Два цвета неоновых пятен на фоне. */
  glowA: string;
  glowB: string;
  /** Акцент интерфейса: кнопки, прогресс, подсветка активной витрины. */
  accent: string;
  /** Второй акцент — для градиентов и комбо-вспышек. */
  accentAlt: string;
  /** Рама витрины и стекло. */
  frame: string;
  glass: string;
}

interface SeasonSpec {
  id: number;
  name: string;
  tagline: string;
  theme: SeasonTheme;
  options: ColorwayOptions;
  /** Базовые цвета в порядке SHAPE_IDS. */
  bases: readonly string[];
  /** Чейзы: силуэт, цвет, редкость, имя варианта. */
  chases: ReadonlyArray<readonly [ShapeId, string, Rarity, string]>;
}

const RARITY_AURA: Record<Rarity, string | undefined> = {
  common: undefined,
  rare: '#7ee8ff',
  legendary: '#ffd54a',
};

export const RARITY_LABEL: Record<Rarity, string> = {
  common: 'обычная',
  rare: 'редкая',
  legendary: 'легендарная',
};

/** Вес при открытии блайнд-бокса. Легендарка редкая, но достижимая без денег. */
export const RARITY_WEIGHT: Record<Rarity, number> = {
  common: 76,
  rare: 20,
  legendary: 4,
};

const SEASON_SPECS: readonly SeasonSpec[] = [
  {
    id: 1,
    name: 'NEON DROP',
    tagline: 'Первый дроп: кислота и хром',
    theme: {
      bgTop: '#1c1636',
      bgBottom: '#0b0a14',
      glowA: '#7c5cff',
      glowB: '#35e6ff',
      accent: '#ff5cf0',
      accentAlt: '#35e6ff',
      frame: '#4b3f7a',
      glass: '#9fd8ff',
    },
    options: {},
    // Восемь тонов по кругу: базовый сезон обязан читаться идеально.
    // Пришелец уведён из малиновой зоны в фиолетовую — рядом с котиком он
    // совпадал и по тону, и по светлоте (см. проверку в store/preview-figurines.ts).
    bases: ['#34e3b0', '#ff62a8', '#9c7bff', '#ff9a5c', '#45cfff', '#ffd23f', '#8fe03a', '#b03ce0'],
    chases: [
      ['cat', '#1ff0d0', 'rare', 'Кислотный'],
      ['star', '#ff3d6e', 'rare', 'Супернова'],
      ['ghost', '#c8d8ff', 'rare', 'Белый шум'],
      ['alien', '#ffc93d', 'legendary', 'Золотой дроп'],
    ],
  },
  {
    id: 2,
    name: 'ПАСТЕЛЬ',
    tagline: 'Мягкая серия для спокойных вечеров',
    theme: {
      bgTop: '#2a2440',
      bgBottom: '#151327',
      glowA: '#b9a5ff',
      glowB: '#9fe8de',
      accent: '#ffa8d4',
      accentAlt: '#a8e6f0',
      frame: '#544a7d',
      glass: '#d6ecff',
    },
    options: { pastel: true },
    bases: ['#a8e8bc', '#ffb0b8', '#c3b5f0', '#ffd3a8', '#a8dcf0', '#ffe9a3', '#c8e6a0', '#f0a8dc'],
    chases: [
      ['bunny', '#fff0f5', 'rare', 'Зефир'],
      ['bear', '#a8c8f0', 'rare', 'Незабудка'],
      ['blob', '#d8f0c8', 'rare', 'Матча'],
      ['star', '#ffe0b8', 'legendary', 'Пыльная роза'],
    ],
  },
  {
    id: 3,
    name: 'ХРОМ',
    tagline: 'Металлик и глубокая тень',
    theme: {
      bgTop: '#1a2030',
      bgBottom: '#0a0e16',
      glowA: '#5f7fa8',
      glowB: '#8fd0d8',
      accent: '#7fd6ff',
      accentAlt: '#c8b088',
      frame: '#3d4a5e',
      glass: '#b8d8e8',
    },
    options: { chrome: true },
    bases: ['#7fd6d0', '#d98ba0', '#8e93c7', '#c9a87e', '#92b8cf', '#d8c078', '#9fbe8a', '#be8fc4'],
    chases: [
      ['dino', '#8f9fa8', 'rare', 'Титан'],
      ['alien', '#a8b0c8', 'rare', 'Ртуть'],
      ['cat', '#c8a878', 'rare', 'Латунь'],
      ['bear', '#e8e4d8', 'legendary', 'Платина'],
    ],
  },
  {
    id: 4,
    name: 'ЦИТРУС',
    tagline: 'Сочная летняя серия',
    theme: {
      bgTop: '#3a1f2a',
      bgBottom: '#170e14',
      glowA: '#ff8a3d',
      glowB: '#ffe45e',
      accent: '#ff5e5e',
      accentAlt: '#ffc93d',
      frame: '#6b3a3f',
      glass: '#ffd8b8',
    },
    options: {},
    bases: ['#4fd98a', '#ff5e5e', '#ff8a3d', '#ffc93d', '#7adcc8', '#ffe45e', '#a8d93a', '#ff6fa8'],
    chases: [
      ['blob', '#00e0a0', 'rare', 'Лайм'],
      ['star', '#ff8f00', 'rare', 'Манго'],
      ['bunny', '#ff4060', 'rare', 'Гранат'],
      ['cat', '#fff0a0', 'legendary', 'Лимонный лёд'],
    ],
  },
  {
    id: 5,
    name: 'ПОЛУНОЧЬ',
    tagline: 'Драгоценные тона и глубокий фон',
    theme: {
      bgTop: '#141a3a',
      bgBottom: '#07081a',
      glowA: '#3d4fd8',
      glowB: '#8f3dd8',
      accent: '#5c8cff',
      accentAlt: '#c45cff',
      frame: '#2f3a70',
      glass: '#a8c0ff',
    },
    options: {},
    bases: ['#2fd6c4', '#e8478e', '#6c5ce7', '#e8823c', '#3aa8e8', '#e8c43a', '#5cc93a', '#c44fe8'],
    chases: [
      ['ghost', '#2f4fd8', 'rare', 'Полярное'],
      ['bear', '#8f2fd8', 'rare', 'Аметист'],
      ['dino', '#2fd86f', 'rare', 'Малахит'],
      ['star', '#f0f0ff', 'legendary', 'Сверхновая'],
    ],
  },
  {
    id: 6,
    name: 'КАРАМЕЛЬ',
    tagline: 'Финальный дроп сезона',
    theme: {
      bgTop: '#2d1a3a',
      bgBottom: '#120b1a',
      glowA: '#ff5cb0',
      glowB: '#5ce8ff',
      accent: '#ff7eb6',
      accentAlt: '#6fd8ff',
      frame: '#5a3a6b',
      glass: '#ffd8ec',
    },
    options: {},
    bases: ['#5ee8c0', '#ff6b7e', '#b08bff', '#ffab70', '#6fd8ff', '#ffde5c', '#a5e85c', '#ff7ee8'],
    chases: [
      ['bunny', '#ff5ca8', 'rare', 'Жвачка'],
      ['blob', '#5cffd8', 'rare', 'Мохито'],
      ['alien', '#c8a0ff', 'rare', 'Лаванда'],
      ['dino', '#ffb0d8', 'legendary', 'Сахарная вата'],
    ],
  },
];

function buildSeason(spec: SeasonSpec): FigurineDef[] {
  const commons: FigurineDef[] = SHAPE_IDS.map((shape, i) => ({
    key: `s${spec.id}-${shape}`,
    season: spec.id,
    shape,
    name: shapeName(shape),
    rarity: 'common' as Rarity,
    colors: colorway(spec.bases[i], spec.options),
  }));

  const chases: FigurineDef[] = spec.chases.map(([shape, hex, rarity, variant], i) => ({
    key: `s${spec.id}-x${i}-${shape}`,
    season: spec.id,
    shape,
    name: `${shapeName(shape)} · ${variant}`,
    rarity,
    colors: colorway(hex, { ...spec.options, chrome: rarity === 'legendary' || spec.options.chrome }),
    aura: RARITY_AURA[rarity],
  }));

  return [...commons, ...chases];
}

export interface Season {
  id: number;
  name: string;
  tagline: string;
  theme: SeasonTheme;
  /** 12 фигурок серии: 8 обычных, затем 4 чейза. */
  figurines: FigurineDef[];
  /** 8 обычных фигурок — именно они выходят на поле как виды. */
  playable: FigurineDef[];
}

export const SEASONS: readonly Season[] = SEASON_SPECS.map((spec) => {
  const figurines = buildSeason(spec);
  return {
    id: spec.id,
    name: spec.name,
    tagline: spec.tagline,
    theme: spec.theme,
    figurines,
    playable: figurines.filter((fig) => fig.rarity === 'common'),
  };
});

export const ALL_FIGURINES: readonly FigurineDef[] = SEASONS.flatMap((s) => s.figurines);

export function seasonById(id: number): Season {
  return SEASONS.find((s) => s.id === id) ?? SEASONS[0];
}

export function figurineByKey(key: string): FigurineDef | undefined {
  return ALL_FIGURINES.find((f) => f.key === key);
}

/**
 * Сезон длится 4 недели (план, §5). Отсчёт от фиксированной даты старта —
 * так у всех игроков один и тот же сезон в один и тот же день, без сервера.
 */
export const SEASON_START = Date.UTC(2026, 6, 27); // 27 июля 2026, понедельник
export const SEASON_LENGTH_DAYS = 28;

export function currentSeasonId(now = Date.now()): number {
  const days = Math.floor((now - SEASON_START) / 86_400_000);
  if (days < 0) return 1;
  return (Math.floor(days / SEASON_LENGTH_DAYS) % SEASONS.length) + 1;
}

/** Сколько дней осталось до конца текущего сезона — для таймера в интерфейсе. */
export function seasonDaysLeft(now = Date.now()): number {
  const days = Math.floor((now - SEASON_START) / 86_400_000);
  if (days < 0) return SEASON_LENGTH_DAYS;
  return SEASON_LENGTH_DAYS - (days % SEASON_LENGTH_DAYS);
}
