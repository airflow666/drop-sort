/**
 * Сезоны, коллекция и редкости.
 *
 * Шесть серий по 12 фигурок (план, §5). Ядро при этом работает максимум с
 * 8 видами (план, §6), поэтому серия устроена как реальная линейка блайнд-
 * боксов: 8 «обычных» фигурок — по одной на каждый силуэт линейки, они и стоят
 * на поле по умолчанию, — плюс 4 чейза.
 *
 * ── Главное отличие серий друг от друга — состав, а не палитра ─────────────
 * У каждого сезона СВОИ восемь персонажей: аркада, плюш, механика, лето,
 * космос, десерты (см. SEASON_SHAPES в src/theme/shapes.ts). Пока все шесть
 * серий стояли на одних и тех же силуэтах, открывать бокс новой серии было
 * незачем — там лежало то же самое в другом цвете.
 *
 * ── Чейз — это отделка, а не оттенок ──────────────────────────────────────
 * Четыре редкие фигурки каждой серии отличаются не только цветом: у них своя
 * отделка (Finish) — радужный холо, блёстки, прозрачный пластик, металлик.
 * Ровно так устроены настоящие блайнд-боксы, и ровно поэтому чейз видно с
 * первого взгляда, а не по подписи под карточкой.
 *
 * Любую из восьми позиций поля игрок может заменить на собранную фигурку —
 * хоть на чейз, хоть на экземпляр из прошлой серии (см. Profile.fieldSpecies).
 * Замена поштучная и по позиции, поэтому на поле всегда ровно восемь разных
 * силуэтов, и вид читается формой, а не только цветом.
 *
 * Раскраска каждой фигурки выводится из одного базового цвета
 * (src/theme/color.ts) — 72 набора оттенков, набранные вручную, неизбежно
 * разъехались бы по светлоте.
 */

import { colorway, type Colorway, type ColorwayOptions } from './color';
import type { FigurineOptions, Finish, Material } from './figurines';
import { SEASON_SHAPES, shapeName, type ShapeId } from './shapes';

export type Rarity = 'common' | 'rare' | 'legendary';

export interface FigurineDef {
  /** Стабильный ключ для сохранений: менять нельзя, иначе коллекция сбросится. */
  key: string;
  season: number;
  shape: ShapeId;
  name: string;
  rarity: Rarity;
  colors: Colorway;
  /**
   * Поверхность линейки. Хранится в самой фигурке, а не берётся по номеру
   * сезона на месте отрисовки: иначе выставленный на поле плюшевый мишка из
   * прошлой серии рисовался бы полированным металлом текущей.
   */
  material: Material;
  /** Отделка чейза. У обычных фигурок её нет. */
  finish?: Finish;
  /**
   * Позиция на поле, 0..7. Чейз занимает позицию своего силуэта: выставляя его,
   * игрок заменяет ровно тот вид, перекраской которого чейз и является.
   */
  slot: number;
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
  /** Поверхность фигурок серии — см. MATERIALS в src/theme/figurines.ts. */
  material: Material;
  options: ColorwayOptions;
  /** Базовые цвета в порядке SEASON_SHAPES[id - 1]. */
  bases: readonly string[];
  /** Чейзы: силуэт, цвет, редкость, имя варианта, отделка. */
  chases: ReadonlyArray<readonly [ShapeId, string, Rarity, string, Finish]>;
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

/** Подпись отделки для карточки: игрок должен знать, что именно ему выпало. */
export const FINISH_LABEL: Record<Finish, string> = {
  holo: 'холо',
  glitter: 'блёстки',
  clear: 'прозрачная',
  gold: 'металлик',
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
    tagline: 'Аркада: робот, кассета, молния, кристалл',
    material: 'vinyl',
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
    // Восемь тонов по кругу: базовая серия обязана читаться идеально.
    // Порядок соответствует SEASON_SHAPES[0]: bot, tape, bolt, heart, disc,
    // rocket, glitch, gem.
    bases: ['#45cfff', '#ff9a5c', '#ffd23f', '#ff62a8', '#b03ce0', '#34e3b0', '#8fe03a', '#9c7bff'],
    chases: [
      ['bot', '#1ff0d0', 'rare', 'Кислотный', 'holo'],
      ['heart', '#ff3d6e', 'rare', 'Супернова', 'glitter'],
      ['gem', '#c8d8ff', 'rare', 'Белый шум', 'clear'],
      ['disc', '#ffc93d', 'legendary', 'Золотой дроп', 'gold'],
    ],
  },
  {
    id: 2,
    name: 'ПЛЮШ',
    tagline: 'Мягкая линейка: зверята из ткани',
    material: 'plush',
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
    // bear, bunny, cat, duck, frog, sheep, pig, owl
    bases: ['#ffd3a8', '#f0a8dc', '#c3b5f0', '#ffe9a3', '#a8e8bc', '#a8dcf0', '#ffb0b8', '#c8e6a0'],
    chases: [
      ['bunny', '#fff0f5', 'rare', 'Зефир', 'glitter'],
      ['bear', '#a8c8f0', 'rare', 'Незабудка', 'holo'],
      ['frog', '#d8f0c8', 'rare', 'Матча', 'clear'],
      ['cat', '#ffe0b8', 'legendary', 'Пыльная роза', 'gold'],
    ],
  },
  {
    id: 3,
    name: 'ХРОМ',
    tagline: 'Механика: железо с характером',
    material: 'metal',
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
    // mech, cog, bulb, capsule, clock, nut, magnet, battery
    bases: ['#8e93c7', '#c9a87e', '#d8c078', '#7fd6d0', '#92b8cf', '#9fbe8a', '#d98ba0', '#be8fc4'],
    chases: [
      ['cog', '#8f9fa8', 'rare', 'Титан', 'holo'],
      ['mech', '#a8b0c8', 'rare', 'Ртуть', 'clear'],
      ['bulb', '#c8a878', 'rare', 'Латунь', 'glitter'],
      ['clock', '#e8e4d8', 'legendary', 'Платина', 'gold'],
    ],
  },
  {
    id: 4,
    name: 'ЛЕТО',
    tagline: 'Фрукты и пляж, мокрый глянец',
    material: 'juicy',
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
    // lemon, melon, cherry, pine, berry, cactus, shell, pear
    bases: ['#ffe45e', '#ff5e5e', '#ff6fa8', '#ffc93d', '#ff8a3d', '#4fd98a', '#7adcc8', '#a8d93a'],
    chases: [
      ['melon', '#00e0a0', 'rare', 'Лайм', 'glitter'],
      ['cherry', '#ff8f00', 'rare', 'Манго', 'holo'],
      ['lemon', '#ff4060', 'rare', 'Гранат', 'clear'],
      ['pine', '#fff0a0', 'legendary', 'Лимонный лёд', 'gold'],
    ],
  },
  {
    id: 5,
    name: 'КОСМОС',
    tagline: 'Планеты, кометы и спутники',
    material: 'cosmic',
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
    // planet, moon, star, comet, ufo, sat, nebula, astro
    bases: ['#e8478e', '#3aa8e8', '#e8c43a', '#e8823c', '#2fd6c4', '#5cc93a', '#c44fe8', '#6c5ce7'],
    chases: [
      ['planet', '#2f4fd8', 'rare', 'Полярное', 'holo'],
      ['star', '#8f2fd8', 'rare', 'Аметист', 'glitter'],
      ['nebula', '#2fd86f', 'rare', 'Малахит', 'clear'],
      ['astro', '#f0f0ff', 'legendary', 'Сверхновая', 'gold'],
    ],
  },
  {
    id: 6,
    name: 'ДЕСЕРТ',
    tagline: 'Финальный дроп: глазурь и посыпка',
    material: 'sugar',
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
    // donut, cup, pop, candy, slice, marsh, lolli, pudding
    bases: ['#ff7ee8', '#ffab70', '#6fd8ff', '#ffde5c', '#ff6b7e', '#5ee8c0', '#a5e85c', '#b08bff'],
    chases: [
      ['donut', '#ff5ca8', 'rare', 'Жвачка', 'glitter'],
      ['lolli', '#5cffd8', 'rare', 'Мохито', 'holo'],
      ['candy', '#c8a0ff', 'rare', 'Лаванда', 'clear'],
      ['slice', '#ffb0d8', 'legendary', 'Сахарная вата', 'gold'],
    ],
  },
];

function buildSeason(spec: SeasonSpec): FigurineDef[] {
  const shapes = SEASON_SHAPES[spec.id - 1];

  const commons: FigurineDef[] = shapes.map((shape, i) => ({
    key: `s${spec.id}-${shape}`,
    season: spec.id,
    shape,
    name: shapeName(shape),
    rarity: 'common' as Rarity,
    colors: colorway(spec.bases[i], spec.options),
    material: spec.material,
    slot: i,
  }));

  const chases: FigurineDef[] = spec.chases.map(([shape, hex, rarity, variant, finish], i) => {
    const slot = shapes.indexOf(shape);
    if (slot < 0) throw new Error(`чейз ${shape} не входит в состав сезона ${spec.id}`);
    return {
      key: `s${spec.id}-x${i}-${shape}`,
      season: spec.id,
      shape,
      name: `${shapeName(shape)} · ${variant}`,
      rarity,
      colors: colorway(hex, {
        ...spec.options,
        chrome: rarity === 'legendary' || spec.options.chrome,
      }),
      material: spec.material,
      finish,
      slot,
      aura: RARITY_AURA[rarity],
    };
  });

  return [...commons, ...chases];
}

export interface Season {
  id: number;
  name: string;
  tagline: string;
  theme: SeasonTheme;
  material: Material;
  /** 12 фигурок серии: 8 обычных, затем 4 чейза. */
  figurines: FigurineDef[];
  /** 8 обычных фигурок — именно они выходят на поле по умолчанию. */
  playable: FigurineDef[];
}

export const SEASONS: readonly Season[] = SEASON_SPECS.map((spec) => {
  const figurines = buildSeason(spec);
  return {
    id: spec.id,
    name: spec.name,
    tagline: spec.tagline,
    theme: spec.theme,
    material: spec.material,
    figurines,
    playable: figurines.filter((fig) => fig.rarity === 'common'),
  };
});

export const ALL_FIGURINES: readonly FigurineDef[] = SEASONS.flatMap((s) => s.figurines);

/** Сколько видов одновременно на поле. Совпадает с длиной линейки сезона. */
export const SLOT_COUNT = 8;

export function seasonById(id: number): Season {
  return SEASONS.find((s) => s.id === id) ?? SEASONS[0];
}

export function figurineByKey(key: string): FigurineDef | undefined {
  return ALL_FIGURINES.find((f) => f.key === key);
}

/**
 * Опции отрисовки, выведенные из самой фигурки: поверхность линейки, отделка
 * чейза и ободок редкости. Собраны в одном месте, потому что фигурка рисуется
 * в пяти разных местах (поле, коллекция, бокс, анонс сезона, карточка
 * результата), и любое забытое поле там выглядит как «в коллекции одна
 * фигурка, а на поле другая».
 */
export function figurineLook(fig: FigurineDef, glow = true): FigurineOptions {
  return {
    glow,
    material: fig.material,
    ...(fig.finish ? { finish: fig.finish } : {}),
    ...(fig.aura ? { aura: fig.aura } : {}),
  };
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
