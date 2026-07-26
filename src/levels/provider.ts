/**
 * Загрузка уровней из пака и выдача их режимам.
 *
 * Пак собран офлайн (tools/generate_levels.py) и вшит в бандл: в рантайме
 * нулевые вычисления и ни одного сетевого запроса за уровнем.
 *
 * Кампания при этом бесконечная (план, §4), а уровней в паке 520. Дальше они
 * переиспользуются, но не повторяются буквально: каждому номеру уровня
 * соответствует своя перестановка видов и порядка витрин. Поле выглядит новым,
 * а minMoves остаётся точным — перестановка не меняет ни одного свойства
 * задачи, потому что виды взаимозаменяемы, а витрины равноправны.
 */

import type { LevelSpec } from '../core';
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
 * Детерминированный генератор — mulberry32. Нужен, чтобы перестановка уровня
 * зависела только от его номера: игрок, вернувшийся на уровень 640, увидит
 * ровно то же поле, а не новое.
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
 * Применить перестановку видов и порядка витрин.
 *
 * Обе операции — симметрии задачи: переименование видов и перестановка витрин
 * не меняют ни решаемость, ни минимальное число ходов. Поэтому уровень можно
 * переиспользовать без повторной прогонки солвера.
 */
function permute(shelves: number[][], seed: number): number[][] {
  const random = rng(seed);
  const species = [...new Set(shelves.flat())].sort((a, b) => a - b);
  const shuffled = shuffle(species, random);
  const map = new Map<number, number>();
  species.forEach((s, i) => map.set(s, shuffled[i]));
  const relabelled = shelves.map((shelf) => shelf.map((x) => map.get(x) ?? x));
  return shuffle(relabelled, random);
}

function toSpec(raw: RawLevel, id: string, seed: number, permuted: boolean): LevelSpec {
  const shelves = permuted ? permute(decode(raw), seed) : decode(raw);
  return {
    id,
    seed,
    shelves,
    capacity: CAPACITY,
    speciesCount: raw.n,
    minMoves: raw.m,
  };
}

/** Уровень кампании по номеру, начиная с 1. Номера сверх пака — с перестановкой. */
export function campaignLevel(levelNumber: number): LevelSpec {
  const n = Math.max(1, Math.floor(levelNumber));
  const index = (n - 1) % CAMPAIGN_LENGTH;
  const lap = Math.floor((n - 1) / CAMPAIGN_LENGTH);
  const raw = DATA.packs.campaign[index];
  // На первом проходе уровни идут как сгенерированы — кривая сложности из
  // плана (§6) выстроена именно в этом порядке.
  return toSpec(raw, `c-${n}`, n * 7919 + lap, lap > 0);
}


/** Номер дня с эпохи — общий для всех игроков в один и тот же календарный день. */
export function dayIndex(now = Date.now()): number {
  return Math.floor(now / 86_400_000);
}

/**
 * Ежедневный вызов: один и тот же уровень для всех игроков в сутки (план, §4).
 * Индекс считается от дня по UTC, поэтому уровень меняется одновременно у всех,
 * независимо от часового пояса.
 */
export function dailyLevel(now = Date.now()): LevelSpec {
  const pack = DATA.packs.daily;
  const day = dayIndex(now);
  const raw = pack[day % pack.length];
  const lap = Math.floor(day / pack.length);
  return toSpec(raw, `d-${day}`, day, lap > 0);
}

/** Поток коротких уровней для блица. */
export function blitzLevel(step: number): LevelSpec {
  const pack = DATA.packs.blitz;
  // Порядок зависит от запуска: два забега подряд не должны идти одинаково.
  const index = Math.floor(Math.random() * pack.length);
  return toSpec(pack[index], `b-${step}`, Date.now() + step, true);
}

