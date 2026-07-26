/**
 * Скины витрин — чистая косметика (план, §5).
 *
 * Скин не добавляет фигурок и не меняет правила: он переопределяет только цвета
 * рамы, стекла и акцентов. Поэтому его можно продавать и за валюту, и за деньги
 * без всякого влияния на баланс и на лидерборды.
 *
 * Один скин покупается за монеты, другой за деньги. Это не случайность: без
 * товара за валюту монетам некуда деваться, кроме блайнд-боксов, и накопления
 * теряют смысл, как только серия собрана.
 */

import type { SeasonTheme } from './seasons';

export interface Skin {
  /** Пустая строка — сезонное оформление по умолчанию. */
  id: string;
  name: string;
  description: string;
  /** Цена в монетах; null — не продаётся за валюту. */
  coins: number | null;
  /** Идентификатор товара в консоли; null — не продаётся за деньги. */
  productId: string | null;
  /** Что именно переопределяется в палитре сезона. */
  override: Partial<SeasonTheme>;
}

export const SKINS: readonly Skin[] = [
  {
    id: '',
    name: 'Сезонное',
    description: 'Оформление текущей серии. Меняется вместе с сезоном.',
    coins: null,
    productId: null,
    override: {},
  },
  {
    id: 'skin_gold',
    name: 'Латунь',
    description: 'Тёплые латунные рамы и янтарная подсветка.',
    coins: 800,
    productId: null,
    override: {
      frame: '#8a6a3c',
      glass: '#ffe0a8',
      accent: '#ffb63d',
      accentAlt: '#ffe08a',
    },
  },
  {
    id: 'skin_chrome',
    name: 'Хром',
    description: 'Металлические рамы и холодная подсветка.',
    coins: null,
    productId: 'skin_chrome',
    override: {
      frame: '#7d90a6',
      glass: '#dceaf5',
      accent: '#7fd6ff',
      accentAlt: '#b8c8d8',
    },
  },
];

export function skinById(id: string): Skin {
  return SKINS.find((s) => s.id === id) ?? SKINS[0];
}

/**
 * Палитра сезона с наложенным скином. Фон (bgTop/bgBottom/glowA/glowB) скин не
 * трогает: он остаётся сезонным, иначе смена сезона перестала бы читаться, а
 * именно она — главный повод вернуться.
 */
export function themeWithSkin(theme: SeasonTheme, skinId: string): SeasonTheme {
  return { ...theme, ...skinById(skinId).override };
}
