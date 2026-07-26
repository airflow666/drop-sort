/**
 * Оценка результата уровня: звёзды, валюта, очки блица.
 *
 * Всё считается от minMoves солвера, а не от абсолютного числа ходов: только
 * так оценка одинаково честная на пятой и на пятисотой попытке, где полей
 * разного размера.
 */

export interface LevelResult {
  stars: 1 | 2 | 3;
  /** Начислено монет до множителя за rewarded. */
  coins: number;
  /** Ходов сверх оптимума. */
  excess: number;
}

/** Порог трёх звёзд — оптимум плюс небольшой допуск, иначе три звезды недостижимы вживую. */
const THREE_STAR_SLACK = 0.15;
const TWO_STAR_SLACK = 0.6;

export function rateLevel(minMoves: number, moves: number, usedHint: boolean): LevelResult {
  const excess = Math.max(0, moves - minMoves);

  let stars: 1 | 2 | 3;
  if (minMoves <= 0) {
    // Данных солвера нет — это восстановленная после перезагрузки партия.
    // Наказывать за отсутствие метаданных нельзя: игрок в этом не виноват.
    stars = 3;
  } else {
    const ratio = excess / minMoves;
    if (ratio <= THREE_STAR_SLACK) stars = 3;
    else if (ratio <= TWO_STAR_SLACK) stars = 2;
    else stars = 1;
  }

  // Подсказка не отбирает звёзды (иначе rewarded становится невыгодным и
  // конверсия падает), но снижает монеты — цена остаётся, давление уходит.
  const base = 12 + stars * 6;
  const coins = usedHint ? Math.round(base * 0.6) : base;

  return { stars, coins, excess };
}

/**
 * Очки за закрытую витрину в блице. Растут с длиной серии, чтобы забег
 * имел кривую напряжения, а не был линейным.
 */
export function blitzSetPoints(comboLength: number): number {
  const combo = Math.max(1, comboLength);
  return 100 * combo + 25 * (combo - 1) * combo;
}

/** Секунды, добавляемые за закрытый сет в блице (см. план, §4). */
export const BLITZ_TIME_BONUS = 2;
export const BLITZ_DURATION = 60;

/**
 * Комбо: две витрины закрылись в пределах COMBO_WINDOW ходов друг от друга.
 * Считаем по номерам ходов, а не по секундам — на слабом устройстве
 * временное окно наказывало бы игрока за лаги.
 */
export const COMBO_WINDOW = 3;
