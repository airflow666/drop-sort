/**
 * Идентификаторы, которые видит консоль разработчика Яндекс Игр.
 *
 * ── Почему они собраны в одном месте и без DOM ────────────────────────────
 * Консоль принимает технические имена лидербордов только по маске
 * `[a-zA-Z0-9]`: никаких подчёркиваний и дефисов. Имена `blitz_weekly` и
 * `daily_moves` в неё просто не вводились, и обнаружилось это уже при
 * заведении лидербордов — то есть на последнем шаге перед публикацией.
 *
 * Раньше эти строки лежали среди экранов интерфейса, а те тянут за собой
 * document, и проверить их тестом было нельзя. Здесь модуль чистый, поэтому
 * маска проверяется в юнит-тестах (test/core.test.ts) — и следующий
 * идентификатор с подчёркиванием не доедет до консоли.
 *
 * У товаров маска другая, мягче: форма создания товара принимает `hints_10`
 * с подчёркиванием. Поэтому их идентификаторы оставлены как есть — менять их
 * ради единообразия значило бы заводить товары в консоли заново.
 */

/** Маска, которую принимает консоль. */
export const PLATFORM_ID_MASK = /^[a-zA-Z0-9]+$/;

// --- Лидерборды -------------------------------------------------------------

/** Очки за забег в блице. Сортировка в консоли — по убыванию. */
export const LEADERBOARD_BLITZ = 'blitzWeekly';

/** Ходов в ежедневном вызове. Сортировка в консоли — ПО ВОЗРАСТАНИЮ. */
export const LEADERBOARD_DAILY = 'dailyMoves';

export const LEADERBOARDS = [LEADERBOARD_BLITZ, LEADERBOARD_DAILY] as const;

// --- Товары -----------------------------------------------------------------

export const PRODUCT_HINTS = 'hints_10';
export const PRODUCT_NO_ADS = 'no_ads';
export const PRODUCT_WEEK_PASS = 'week_pass';
export const PRODUCT_SKIN_CHROME = 'skin_chrome';

export const PRODUCT_IDS = [
  PRODUCT_HINTS,
  PRODUCT_NO_ADS,
  PRODUCT_WEEK_PASS,
  PRODUCT_SKIN_CHROME,
] as const;

/**
 * Расходуемые товары — те, которые можно купить повторно.
 *
 * «Убрать рекламу» и скины сюда не входят: факт владения ими хранит сама
 * платформа тем, что покупка остаётся непотреблённой.
 */
export const CONSUMABLE_PRODUCTS: readonly string[] = [PRODUCT_HINTS, PRODUCT_WEEK_PASS];

export function isConsumable(productId: string): boolean {
  return CONSUMABLE_PRODUCTS.includes(productId);
}
