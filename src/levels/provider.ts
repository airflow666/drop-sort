/**
 * Загрузка уровней из пака и выдача их режимам.
 *
 * Пак собран офлайн (tools/generate_levels.py) и вшит в бандл: в рантайме
 * нулевые вычисления и ни одного сетевого запроса за уровнем.
 *
 * ── Виды раздаются по всей серии, а не по порядку ─────────────────────────
 * В паке виды пронумерованы 0..n-1, поэтому уровень на три вида всегда
 * состоял из видов 0, 1 и 2. За всю кампанию игрок видел первые три фигурки
 * серии постоянно, а восьмую — только в одиннадцати уровнях из пятисот
 * двадцати (столько в паке уровней на восемь видов). Здесь номера видов
 * переназначаются на случайное подмножество всей серии: три вида уровня могут
 * оказаться хоть первым, четвёртым и восьмым.
 *
 * ── Сложность бесконечной ленты меняется от уровня к уровню ───────────────
 * Раньше уровень n брался из пака строго по порядку, а пак отсортирован по
 * кривой сложности — то есть двадцать уровней подряд шли на трёх видах и пяти
 * витринах. Теперь номер уровня задаёт СЕРЕДИНУ коридора сложности, а
 * конкретное число видов гуляет вокруг неё: соседние уровни ощутимо разные,
 * но общий подъём сохраняется.
 *
 * Обе перестройки не трогают саму задачу: переименование видов и перестановка
 * витрин — симметрии, они не меняют ни решаемость, ни минимальное число ходов,
 * поэтому minMoves из пака остаётся точным.
 */

import type { LevelSpec } from '../core';
import { now as clockNow } from '../platform/clock';
import packs from './packs.json';

interface RawLevel {
  /** Витрины через '|', виды — цифрами снизу вверх. */
  s: string;
  /** Точное минимальное число ходов по солверу. */
  m: number;
  /** Число видов. */
  n: number;
  /** Разгрузочный уровень. */
  r?: number;
}

interface Packs {
  version: number;
  capacity: number;
  generatedAt: string;
  seed: number;
  packs: {
    campaign: RawLevel[];
    daily: RawLevel[];
    blitz: RawLevel[];
  };
}

const DATA = packs as Packs;

export const CAPACITY = DATA.capacity;
export const CAMPAIGN_LENGTH = DATA.packs.campaign.length;

/**
 * Сколько разных видов доступно на поле — по числу обычных фигурок в серии
 * (см. `Season.playable`). Виды уровня раскладываются по этому диапазону.
 */
export const SPECIES_SLOTS = 8;

/**
 * Детерминированный генератор — mulberry32. Нужен, чтобы всё, что зависит от
 * номера уровня, зависело ТОЛЬКО от него: игрок, вернувшийся на уровень 640,
 * увидит ровно то же поле, а не новое.
 */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function decode(raw: RawLevel): number[][] {
  return raw.s.split('|').map((part) => [...part].map(Number));
}

/**
 * Переназначить виды уровня на случайное подмножество серии и перемешать
 * порядок витрин.
 *
 * Ключевая деталь — подмножество берётся из ВСЕХ доступных видов, а не из тех,
 * что уже есть на уровне. Прежняя версия перемешивала виды между собой, то есть
 * из {0,1,2} получала снова {0,1,2}, и фигурки с большими номерами не выходили
 * на поле почти никогда.
 */
function reskin(shelves: number[][], seed: number): number[][] {
  const random = rng(seed);
  const present = [...new Set(shelves.flat())].sort((a, b) => a - b);

  const pool = shuffle(
    Array.from({ length: SPECIES_SLOTS }, (_, i) => i),
    random
  ).slice(0, present.length);

  const map = new Map<number, number>();
  present.forEach((species, i) => map.set(species, pool[i] ?? species));

  const relabelled = shelves.map((shelf) => shelf.map((x) => map.get(x) ?? x));
  return shuffle(relabelled, random);
}

function toSpec(raw: RawLevel, id: string, seed: number): LevelSpec {
  return {
    id,
    seed,
    shelves: reskin(decode(raw), seed),
    capacity: CAPACITY,
    speciesCount: raw.n,
    minMoves: raw.m,
  };
}

// --- Кривая сложности кампании ---------------------------------------------

/** Уровни пака, разложенные по числу видов. Строится один раз. */
const BY_SPECIES = (() => {
  const buckets = new Map<number, RawLevel[]>();
  for (const level of DATA.packs.campaign) {
    const bucket = buckets.get(level.n);
    if (bucket) bucket.push(level);
    else buckets.set(level.n, [level]);
  }
  return buckets;
})();

const MIN_SPECIES = 3;
const MAX_SPECIES = Math.max(...BY_SPECIES.keys());

/** Каждый N-й уровень — разгрузочный: на вид проще соседей (план, §6). */
const RELIEF_EVERY = 11;

/**
 * Середина коридора сложности для уровня n.
 *
 * Ступени сжаты по сравнению с исходной кривой плана (§6), где первые двадцать
 * уровней шли на трёх видах: подряд идущие одинаковые поля читаются как «игра
 * не двигается». Первые четыре уровня всё так же тривиальны — по ним считается
 * метрика прохождения первого уровня (план, §10), — а дальше подъём заметен.
 */
function medianSpecies(n: number): number {
  if (n <= 4) return 3;
  if (n <= 14) return 4;
  if (n <= 30) return 5;
  if (n <= 70) return 6;
  return 7;
}

/**
 * Сколько видов будет на уровне n.
 *
 * Вокруг середины коридора добавляется разброс ±1, поэтому соседние уровни
 * отличаются на глаз. Восемь видов остаются редкостью: в паке таких уровней
 * всего одиннадцать, и без ограничения они бы заметно повторялись.
 */
function speciesFor(n: number): number {
  // Первые два уровня — знакомство с правилом, разброс к ним не применяется:
  // по прохождению первого уровня считается метрика плана (§10), и оставлять
  // её на волю генератора незачем.
  if (n <= 2) return MIN_SPECIES;

  const random = rng(n * 2654435761);
  let species = medianSpecies(n);

  const roll = random();
  if (roll < 0.3) species -= 1;
  else if (roll > 0.72) species += 1;

  // Разгрузочный уровень: заведомо проще соседей.
  if (n > RELIEF_EVERY && n % RELIEF_EVERY === 0) species -= 1;

  if (species > MAX_SPECIES - 1 && random() > 0.35) species = MAX_SPECIES - 1;

  return Math.min(MAX_SPECIES, Math.max(MIN_SPECIES, species));
}

/** Ближайший непустой набор уровней — на случай, если корзины окажутся редкими. */
function bucketFor(species: number): RawLevel[] {
  for (let delta = 0; delta <= MAX_SPECIES; delta++) {
    const lower = BY_SPECIES.get(species - delta);
    if (lower?.length) return lower;
    const upper = BY_SPECIES.get(species + delta);
    if (upper?.length) return upper;
  }
  return DATA.packs.campaign;
}

/**
 * Уровень кампании по номеру, начиная с 1.
 *
 * Лента бесконечна: номера сверх размера пака переиспользуют те же поля, но с
 * другими видами и порядком витрин.
 */
export function campaignLevel(levelNumber: number): LevelSpec {
  const n = Math.max(1, Math.floor(levelNumber));
  const bucket = bucketFor(speciesFor(n));
  const random = rng(n * 7919 + 13);
  const raw = bucket[Math.floor(random() * bucket.length)];
  return toSpec(raw, `c-${n}`, n * 7919);
}

/** Номер дня с эпохи — общий для всех игроков в один и тот же календарный день. */
export function dayIndex(now = clockNow()): number {
  return Math.floor(now / 86_400_000);
}

/**
 * Ежедневный вызов: один и тот же уровень для всех игроков в сутки (план, §4).
 * Индекс считается от дня по UTC, поэтому уровень меняется одновременно у всех,
 * независимо от часового пояса, а виды раздаются от того же номера дня — значит
 * и выглядит он у всех одинаково.
 */
export function dailyLevel(now = clockNow()): LevelSpec {
  const pack = DATA.packs.daily;
  const day = dayIndex(now);
  return toSpec(pack[day % pack.length], `d-${day}`, day * 104729 + 7);
}

/** Поток коротких уровней для блица. */
export function blitzLevel(step: number): LevelSpec {
  const pack = DATA.packs.blitz;
  // Порядок зависит от запуска: два забега подряд не должны идти одинаково.
  const index = Math.floor(Math.random() * pack.length);
  return toSpec(pack[index], `b-${step}`, Date.now() + step);
}
