/**
 * Профиль игрока: прогресс, валюта, коллекция, стрик, сезоны.
 *
 * Единственный источник правды по всему, что переживает перезагрузку. Пишется
 * через `ysdk.player` с локальным резервом (см. src/platform/sdk.ts).
 *
 * Две вещи, которые здесь важнее остальных:
 *
 *  * Запись дебаунсится. Каждый ход уровня меняет снимок партии, а
 *    `setData` — сетевой вызов; писать на каждый ход означает сотни запросов
 *    за сессию и отваленные сохранения. Поэтому обычные изменения копятся,
 *    а по-настоящему важные (пройден уровень, куплен товар, открыт бокс)
 *    пишутся немедленно с flush.
 *  * Формат сохранения версионирован и читается терпимо к пропускам: игрок,
 *    вернувшийся через полгода на новую версию, не должен потерять коллекцию.
 */

import type { BoardSnapshot } from '../core';
import {
  ALL_FIGURINES,
  currentSeasonId,
  figurineByKey,
  RARITY_WEIGHT,
  seasonById,
  type FigurineDef,
} from '../theme/seasons';
import { SHAPE_IDS, type ShapeId } from '../theme/figurines';
import type { Platform } from '../platform/sdk';

export const SAVE_VERSION = 1;

export type GameMode = 'campaign' | 'blitz' | 'daily';

/**
 * Режим кормит лидерборд, то есть результат сравнивается с чужими.
 *
 * В таких режимах за просмотр ролика нельзя КУПИТЬ преимущество: свободная
 * витрина расшивает тупик, а отмена хода уменьшает счётчик ходов — ровно то
 * число, по которому ранжируется вызов дня. Тот, кто посмотрел три ролика,
 * оказывался бы выше того, кто честно решил задачу, и таблица переставала бы
 * измерять умение. Уже накопленные заряды (подсказки) тратить можно: они у
 * всех появляются одинаково, покупкой внимания это не является.
 */
export function isCompetitive(mode: GameMode): boolean {
  return mode !== 'campaign';
}

/** Незавершённая партия — чтобы уровень не терялся при перезагрузке. */
export interface ResumeState {
  mode: GameMode;
  levelId: string;
  minMoves: number;
  board: BoardSnapshot;
  usedHint: boolean;
}

export interface Settings {
  muted: boolean;
  haptics: boolean;
}

interface SaveShape {
  v: number;
  coins: number;
  hints: number;
  /** Номер следующего уровня кампании, с единицы. */
  campaignLevel: number;
  /** Звёзды по уровням: строка цифр, индекс = номер уровня минус один. */
  stars: string;
  /** Ключ фигурки → сколько получено (дубликаты считаются). */
  collected: Record<string, number>;
  /** Счётчик обмена дубликатов. */
  duplicates: number;
  streakDays: number;
  /** Дата последней выдачи награды за вход, YYYY-MM-DD. */
  streakClaimed: string;
  blitzBest: number;
  blitzAttempts: number;
  blitzRefillAt: number;
  /** Дата последнего пройденного ежедневного вызова. */
  dailyDone: string;
  dailyBestMoves: number;
  ownedSkins: string[];
  activeSkin: string;
  /**
   * Какую собранную фигурку игрок выставил на поле вместо стандартной —
   * силуэт → ключ фигурки. Отсутствующий силуэт означает «как в текущей серии».
   */
  loadout: Record<string, string>;
  noAds: boolean;
  settings: Settings;
  /** Сезон, который игрок видел последним — по нему ловится смена сезона. */
  seenSeason: number;
  /** Вводный гайд уже показан — второй раз он не появится. */
  tutorialSeen: boolean;
  resume: ResumeState | null;
}

const MAX_FREE_BLITZ = 2;
export const BLITZ_REFILL_MS = 15 * 60 * 1000;
export const BLIND_BOX_COST = 120;
/** Сколько дубликатов обменивается на бокс. */
export const DUPLICATES_PER_BOX = 8;

/** Награда за стрик: растёт до седьмого дня, дальше плато (план, §5). */
export const STREAK_REWARDS = [20, 30, 45, 60, 80, 110, 150] as const;

export function streakReward(day: number): number {
  return STREAK_REWARDS[Math.min(day, STREAK_REWARDS.length) - 1] ?? STREAK_REWARDS[0];
}

function today(): string {
  // Локальная дата, а не UTC: «день» для стрика — это день игрока.
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function daysBetween(a: string, b: string): number {
  const pa = Date.parse(`${a}T00:00:00`);
  const pb = Date.parse(`${b}T00:00:00`);
  if (Number.isNaN(pa) || Number.isNaN(pb)) return 99;
  return Math.round((pb - pa) / 86_400_000);
}

function defaults(): SaveShape {
  return {
    v: SAVE_VERSION,
    coins: 60,
    hints: 1,
    campaignLevel: 1,
    stars: '',
    collected: {},
    duplicates: 0,
    streakDays: 0,
    streakClaimed: '',
    blitzBest: 0,
    blitzAttempts: MAX_FREE_BLITZ,
    blitzRefillAt: 0,
    dailyDone: '',
    dailyBestMoves: 0,
    ownedSkins: [],
    activeSkin: '',
    loadout: {},
    noAds: false,
    settings: { muted: false, haptics: true },
    seenSeason: currentSeasonId(),
    tutorialSeen: false,
    resume: null,
  };
}

export interface BoxResult {
  figurine: FigurineDef;
  /** Такая фигурка уже была — ушла в счётчик обмена. */
  duplicate: boolean;
}

export class Profile {
  private readonly platform: Platform;
  private data: SaveShape = defaults();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;

  /** Сезон сменился с прошлого запуска — интерфейс покажет анонс новой серии. */
  seasonRolledOver = false;

  constructor(platform: Platform) {
    this.platform = platform;
  }

  async load(): Promise<void> {
    const raw = await this.platform.getData();
    this.data = this.migrate(raw);

    const season = currentSeasonId();
    if (this.data.seenSeason !== season) {
      this.seasonRolledOver = true;
      this.data.seenSeason = season;
      this.dirty = true;
    }

    this.refillBlitzAttempts();
  }

  /**
   * Приведение сохранения к текущему формату.
   *
   * Читаем по одному полю с проверкой типа, а не через `{...defaults, ...raw}`:
   * повреждённое или устаревшее поле (строка вместо числа, null вместо объекта)
   * иначе просочилось бы внутрь и уронило игру уже в отрыве от места ошибки.
   */
  private migrate(raw: Record<string, unknown>): SaveShape {
    const base = defaults();
    if (!raw || typeof raw !== 'object') return base;

    const num = (key: keyof SaveShape, fallback: number): number => {
      const v = raw[key as string];
      return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
    };
    const str = (key: keyof SaveShape, fallback: string): string => {
      const v = raw[key as string];
      return typeof v === 'string' ? v : fallback;
    };

    const collected: Record<string, number> = {};
    const rawCollected = raw.collected;
    if (rawCollected && typeof rawCollected === 'object') {
      for (const [key, value] of Object.entries(rawCollected as Record<string, unknown>)) {
        // Фигурки, выпавшие из состава игры, тихо отбрасываются: иначе
        // экран коллекции упал бы на неизвестном ключе.
        if (typeof value === 'number' && value > 0 && ALL_FIGURINES.some((f) => f.key === key)) {
          collected[key] = Math.floor(value);
        }
      }
    }

    const rawSettings = (raw.settings ?? {}) as Record<string, unknown>;
    const rawResume = raw.resume as ResumeState | null | undefined;

    // Выставленные на поле фигурки проверяются трижды: ключ существует, силуэт
    // совпадает с ячейкой и фигурка действительно собрана. Иначе сохранение от
    // старой версии (или подправленное руками) поставило бы на поле два вида
    // одного силуэта — и уровень стал бы нерешаемым на вид.
    const loadout: Record<string, string> = {};
    const rawLoadout = raw.loadout;
    if (rawLoadout && typeof rawLoadout === 'object') {
      for (const [shape, key] of Object.entries(rawLoadout as Record<string, unknown>)) {
        if (typeof key !== 'string') continue;
        if (!SHAPE_IDS.includes(shape as ShapeId)) continue;
        const fig = ALL_FIGURINES.find((f) => f.key === key);
        if (!fig || fig.shape !== shape) continue;
        if ((collected[key] ?? 0) <= 0) continue;
        loadout[shape] = key;
      }
    }

    return {
      v: SAVE_VERSION,
      coins: Math.max(0, num('coins', base.coins)),
      hints: Math.max(0, num('hints', base.hints)),
      campaignLevel: Math.max(1, num('campaignLevel', base.campaignLevel)),
      stars: str('stars', base.stars).replace(/[^0-3]/g, '0'),
      collected,
      duplicates: Math.max(0, num('duplicates', 0)),
      streakDays: Math.max(0, num('streakDays', 0)),
      streakClaimed: str('streakClaimed', ''),
      blitzBest: Math.max(0, num('blitzBest', 0)),
      blitzAttempts: Math.max(0, Math.min(MAX_FREE_BLITZ, num('blitzAttempts', MAX_FREE_BLITZ))),
      blitzRefillAt: num('blitzRefillAt', 0),
      dailyDone: str('dailyDone', ''),
      dailyBestMoves: Math.max(0, num('dailyBestMoves', 0)),
      ownedSkins: Array.isArray(raw.ownedSkins)
        ? (raw.ownedSkins as unknown[]).filter((s): s is string => typeof s === 'string')
        : [],
      activeSkin: str('activeSkin', ''),
      loadout,
      noAds: raw.noAds === true,
      settings: {
        muted: rawSettings.muted === true,
        haptics: rawSettings.haptics !== false,
      },
      seenSeason: num('seenSeason', currentSeasonId()),
      // Вернувшемуся игроку гайд не показываем: раз в сохранении есть прогресс,
      // играть он уже умеет, а «обучение» поверх знакомого меню раздражает.
      tutorialSeen:
        raw.tutorialSeen === true ||
        (typeof raw.campaignLevel === 'number' && raw.campaignLevel > 1),
      resume: this.validateResume(rawResume),
    };
  }

  /** Снимок партии из прошлой сессии может быть от несовместимой версии. */
  private validateResume(resume: unknown): ResumeState | null {
    if (!resume || typeof resume !== 'object') return null;
    const r = resume as Partial<ResumeState>;
    if (!r.board || !Array.isArray(r.board.shelves) || typeof r.levelId !== 'string') return null;
    if (r.mode !== 'campaign' && r.mode !== 'blitz' && r.mode !== 'daily') return null;
    // Блиц не восстанавливаем: забег на 60 секунд без таймера бессмыслен,
    // а честно продолжить его после перезагрузки невозможно.
    if (r.mode === 'blitz') return null;
    return {
      mode: r.mode,
      levelId: r.levelId,
      minMoves: typeof r.minMoves === 'number' ? r.minMoves : 0,
      board: r.board,
      usedHint: r.usedHint === true,
    };
  }

  // --- Запись -------------------------------------------------------------

  /** Отложенная запись: копит мелкие изменения. */
  private touch(): void {
    this.dirty = true;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.flush(false);
    }, 2500);
  }

  /** Немедленная запись. Для событий, потерю которых игрок заметит. */
  async flush(force = true): Promise<void> {
    if (!this.dirty && !force) return;
    this.dirty = false;
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await this.platform.setData(this.data as unknown as Record<string, unknown>, force);
  }

  // --- Чтение -------------------------------------------------------------

  get coins(): number {
    return this.data.coins;
  }
  get hints(): number {
    return this.data.hints;
  }
  get campaignLevel(): number {
    return this.data.campaignLevel;
  }
  get duplicates(): number {
    return this.data.duplicates;
  }
  get blitzBest(): number {
    return this.data.blitzBest;
  }
  get dailyBestMoves(): number {
    return this.data.dailyBestMoves;
  }
  get streakDays(): number {
    return this.data.streakDays;
  }
  get noAds(): boolean {
    return this.data.noAds;
  }
  get settings(): Settings {
    return this.data.settings;
  }
  get resume(): ResumeState | null {
    return this.data.resume;
  }
  get seasonId(): number {
    return currentSeasonId();
  }

  /** Суммарно звёзд — «уровень витрины» игрока. */
  get totalStars(): number {
    let sum = 0;
    for (const ch of this.data.stars) sum += Number(ch);
    return sum;
  }

  starsFor(levelNumber: number): number {
    return Number(this.data.stars[levelNumber - 1] ?? '0');
  }

  get dailyDoneToday(): boolean {
    return this.data.dailyDone === today();
  }

  /** Сколько фигурок серии собрано. */
  seasonProgress(seasonId: number): { owned: number; total: number } {
    const season = seasonById(seasonId);
    const owned = season.figurines.filter((f) => (this.data.collected[f.key] ?? 0) > 0).length;
    return { owned, total: season.figurines.length };
  }

  ownedCount(key: string): number {
    return this.data.collected[key] ?? 0;
  }

  has(key: string): boolean {
    return (this.data.collected[key] ?? 0) > 0;
  }

  // --- Что стоит на поле --------------------------------------------------

  /**
   * Виды, которые выходят на поле, — ровно по одной фигурке на силуэт и строго
   * в порядке SHAPE_IDS: ядро адресует вид индексом, а не ключом.
   *
   * По умолчанию это восемь обычных фигурок текущей серии. Любую из них игрок
   * может заменить на собранную — из прошлого сезона или на чейз. Замена
   * поштучная и только в пределах силуэта, поэтому на поле по-прежнему не может
   * оказаться двух «звёзд» разной раскраски: вид остаётся однозначно читаемым
   * по форме, а именно на форму опирается игрок с дальтонизмом.
   */
  fieldSpecies(seasonId = currentSeasonId()): FigurineDef[] {
    const season = seasonById(seasonId);
    return SHAPE_IDS.map((shape, i) => {
      const key = this.data.loadout[shape];
      const chosen = key ? figurineByKey(key) : undefined;
      if (chosen && chosen.shape === shape && this.has(key)) return chosen;
      return season.playable[i];
    });
  }

  /** Ключ фигурки, выставленной на поле для этого силуэта. */
  equipped(shape: ShapeId, seasonId = currentSeasonId()): string {
    const index = SHAPE_IDS.indexOf(shape);
    return this.fieldSpecies(seasonId)[index]?.key ?? '';
  }

  /**
   * Выставить собранную фигурку на поле вместо стандартной. Возвращает false,
   * если фигурка не собрана: витрина не должна показывать то, чего нет.
   */
  equip(key: string): boolean {
    const fig = figurineByKey(key);
    if (!fig || !this.has(key)) return false;
    this.data.loadout[fig.shape] = key;
    void this.flush();
    return true;
  }

  /** Вернуть силуэту стандартную фигурку текущей серии. */
  unequip(shape: ShapeId): void {
    if (!(shape in this.data.loadout)) return;
    delete this.data.loadout[shape];
    void this.flush();
  }

  // --- Изменения ----------------------------------------------------------

  addCoins(amount: number): void {
    if (amount === 0) return;
    this.data.coins = Math.max(0, this.data.coins + amount);
    this.touch();
  }

  /** Списать монеты. false — не хватило, ничего не изменилось. */
  spendCoins(amount: number): boolean {
    if (amount <= 0) return true;
    if (this.data.coins < amount) return false;
    this.data.coins -= amount;
    void this.flush();
    return true;
  }

  addHints(count: number): void {
    this.data.hints = Math.max(0, this.data.hints + count);
    void this.flush();
  }

  useHint(): boolean {
    if (this.data.hints <= 0) return false;
    this.data.hints -= 1;
    this.touch();
    return true;
  }

  setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
    this.data.settings[key] = value;
    void this.flush();
  }

  /** Зафиксировать результат уровня кампании. */
  completeCampaignLevel(levelNumber: number, stars: number): void {
    const idx = levelNumber - 1;
    const padded = this.data.stars.padEnd(Math.max(this.data.stars.length, idx + 1), '0');
    const best = Math.max(Number(padded[idx] ?? '0'), stars);
    this.data.stars = padded.slice(0, idx) + String(best) + padded.slice(idx + 1);
    if (levelNumber >= this.data.campaignLevel) {
      this.data.campaignLevel = levelNumber + 1;
    }
    this.data.resume = null;
    void this.flush();
  }

  saveResume(state: ResumeState | null): void {
    this.data.resume = state;
    // Снимок партии меняется каждый ход — только отложенная запись.
    this.touch();
  }

  recordBlitz(score: number): boolean {
    const isRecord = score > this.data.blitzBest;
    if (isRecord) this.data.blitzBest = score;
    void this.flush();
    return isRecord;
  }

  completeDaily(moves: number): boolean {
    this.data.dailyDone = today();
    const isRecord = this.data.dailyBestMoves === 0 || moves < this.data.dailyBestMoves;
    if (isRecord) this.data.dailyBestMoves = moves;
    void this.flush();
    return isRecord;
  }

  // --- Блиц: попытки ------------------------------------------------------

  /** Одна бесплатная попытка каждые 15 минут (план, §4). */
  private refillBlitzAttempts(): void {
    if (this.data.blitzAttempts >= MAX_FREE_BLITZ) {
      this.data.blitzRefillAt = 0;
      return;
    }
    const now = Date.now();
    if (this.data.blitzRefillAt === 0) {
      this.data.blitzRefillAt = now + BLITZ_REFILL_MS;
      return;
    }
    while (this.data.blitzAttempts < MAX_FREE_BLITZ && now >= this.data.blitzRefillAt) {
      this.data.blitzAttempts += 1;
      this.data.blitzRefillAt += BLITZ_REFILL_MS;
      this.dirty = true;
    }
    if (this.data.blitzAttempts >= MAX_FREE_BLITZ) this.data.blitzRefillAt = 0;
  }

  get blitzAttempts(): number {
    this.refillBlitzAttempts();
    return this.data.blitzAttempts;
  }

  /** Миллисекунды до следующей бесплатной попытки; 0 — попытки есть. */
  get blitzRefillIn(): number {
    this.refillBlitzAttempts();
    if (this.data.blitzAttempts >= MAX_FREE_BLITZ) return 0;
    return Math.max(0, this.data.blitzRefillAt - Date.now());
  }

  consumeBlitzAttempt(): boolean {
    this.refillBlitzAttempts();
    if (this.data.blitzAttempts <= 0) return false;
    if (this.data.blitzAttempts === MAX_FREE_BLITZ) {
      // Отсчёт восстановления запускается с момента траты последней полной
      // попытки, а не с нуля: иначе таймер стоял бы, пока игрок не истратит всё.
      this.data.blitzRefillAt = Date.now() + BLITZ_REFILL_MS;
    }
    this.data.blitzAttempts -= 1;
    void this.flush();
    return true;
  }

  /** Дополнительная попытка за rewarded — не тратит бесплатные. */
  grantBlitzAttempt(): void {
    this.data.blitzAttempts += 1;
    this.touch();
  }

  // --- Стрик --------------------------------------------------------------

  /** Можно ли получить сегодняшнюю награду за вход. */
  get streakClaimable(): boolean {
    return this.data.streakClaimed !== today();
  }

  /**
   * Забрать награду за вход. Возвращает день стрика и монеты.
   * Пропущенный день сбрасывает серию — в этом весь смысл механики.
   */
  claimStreak(): { day: number; coins: number } | null {
    if (!this.streakClaimable) return null;
    const gap = this.data.streakClaimed ? daysBetween(this.data.streakClaimed, today()) : 1;
    this.data.streakDays = gap === 1 ? this.data.streakDays + 1 : 1;
    this.data.streakClaimed = today();
    const coins = streakReward(this.data.streakDays);
    this.data.coins += coins;
    void this.flush();
    return { day: this.data.streakDays, coins };
  }

  // --- Блайнд-боксы -------------------------------------------------------

  /**
   * Открыть блайнд-бокс.
   *
   * Случайные боксы открываются ТОЛЬКО за внутриигровую валюту, дубликаты и
   * rewarded — никогда за реальные деньги (план, §8). Игра нацелена на молодую
   * аудиторию, и продажа случайного содержимого за деньги — это и этическая
   * проблема, и риск на модерации с возрастной разметкой.
   *
   * Вызывающая сторона обязана сама списать стоимость (монеты, дубликаты или
   * просмотр рекламы) — здесь только выдача.
   */
  openBox(seasonId = currentSeasonId()): BoxResult {
    const season = seasonById(seasonId);
    const pool = season.figurines;

    // Взвешенный выбор по редкости.
    const weights = pool.map((f) => RARITY_WEIGHT[f.rarity]);
    const total = weights.reduce((a, b) => a + b, 0);
    let roll = Math.random() * total;
    let picked = pool[0];
    for (let i = 0; i < pool.length; i++) {
      roll -= weights[i];
      if (roll <= 0) {
        picked = pool[i];
        break;
      }
    }

    const had = (this.data.collected[picked.key] ?? 0) > 0;
    this.data.collected[picked.key] = (this.data.collected[picked.key] ?? 0) + 1;
    if (had) this.data.duplicates += 1;
    void this.flush();
    return { figurine: picked, duplicate: had };
  }

  /** Обменять дубликаты на бокс. */
  exchangeDuplicates(): boolean {
    if (this.data.duplicates < DUPLICATES_PER_BOX) return false;
    this.data.duplicates -= DUPLICATES_PER_BOX;
    void this.flush();
    return true;
  }


  /** Собрана ли серия целиком — финальная награда сезона (план, §5). */
  isSeasonComplete(seasonId: number): boolean {
    const { owned, total } = this.seasonProgress(seasonId);
    return owned >= total;
  }

  // --- Покупки ------------------------------------------------------------

  unlockSkin(id: string): void {
    if (!this.data.ownedSkins.includes(id)) this.data.ownedSkins.push(id);
    void this.flush();
  }

  ownsSkin(id: string): boolean {
    return this.data.ownedSkins.includes(id);
  }

  setActiveSkin(id: string): void {
    this.data.activeSkin = id;
    void this.flush();
  }

  get activeSkin(): string {
    return this.data.activeSkin;
  }

  enableNoAds(): void {
    this.data.noAds = true;
    void this.flush();
  }

  // --- Обучение -----------------------------------------------------------

  get tutorialSeen(): boolean {
    return this.data.tutorialSeen;
  }

  markTutorialSeen(): void {
    if (this.data.tutorialSeen) return;
    this.data.tutorialSeen = true;
    // Немедленная запись: если игрок закроет вкладку сразу после гайда,
    // при следующем заходе он не должен увидеть его снова.
    void this.flush();
  }
}
