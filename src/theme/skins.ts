/**
 * Скины витрин — чистая косметика (план, §5).
 *
 * Скин не добавляет фигурок и не меняет правила, поэтому его можно продавать
 * и за валюту, и за деньги без всякого влияния на баланс и на лидерборды.
 *
 * ── Почему скин — это не палитра ──────────────────────────────────────────
 * Сначала скин переопределял четыре цвета: раму, стекло и два акцента. На
 * экране это давало разницу «на пару оттенков» — купив скин, игрок не мог
 * показать его никому, включая себя. Поэтому скин теперь меняет КОНСТРУКЦИЮ
 * витрины (`shelf`): у латуни заклёпки и шильдик, у аркады — маркиза с
 * лампами и острые углы, у ретро — деревянные полки между ярусами, у хрома —
 * фаска с бликом по верхней кромке, у кристалла — срезанные углы и грани.
 * Плюс скругление всего интерфейса (`ui`): аркада квадратная, ретро мягкое.
 *
 * Один скин покупается за деньги, остальные за монеты. Это не случайность:
 * без товара за валюту монетам некуда деваться, кроме блайнд-боксов, и
 * накопления теряют смысл, как только серия собрана. Лестница цен от 450 до
 * 1800 даёт валюте цель на несколько недель вперёд.
 */

import type { SeasonTheme } from './seasons';
import { t, type Key } from '../i18n';

/** Конструкция витрины. Реализация — в src/render/shelf.ts. */
export type ShelfStyle = 'season' | 'brass' | 'arcade' | 'wood' | 'chrome' | 'crystal';

export interface Skin {
  /** Пустая строка — сезонное оформление по умолчанию. */
  id: string;
  /**
   * Ключ названия и описания в словаре («wood», «brass»). Не готовые строки:
   * язык приходит от площадки после загрузки модуля. Имя собирают `skinName`
   * и `skinDescription`.
   */
  labelKey: string;
  /** Цена в монетах; null — не продаётся за валюту. */
  coins: number | null;
  /** Идентификатор товара в консоли; null — не продаётся за деньги. */
  productId: string | null;
  /** Что именно переопределяется в палитре сезона. */
  override: Partial<SeasonTheme>;
  /** Из чего собрана витрина. */
  shelf: ShelfStyle;
  /**
   * Скругление интерфейса: кнопки, карточки, плашки. Пусто — как в сезоне.
   * Форма кнопки заметна даже боковым зрением, поэтому это самый дешёвый
   * способ сделать скин узнаваемым за пределами игрового поля.
   */
  ui?: { radius: number; radiusLg: number };
}

export const SKINS: readonly Skin[] = [
  {
    id: '',
    labelKey: 'season',
    coins: null,
    productId: null,
    override: {},
    shelf: 'season',
  },
  {
    id: 'skin_wood',
    labelKey: 'wood',
    coins: 450,
    productId: null,
    override: {
      frame: '#8a5a34',
      glass: '#ffe6c4',
      accent: '#ffab5c',
      accentAlt: '#d8b06a',
    },
    shelf: 'wood',
    ui: { radius: 24, radiusLg: 34 },
  },
  {
    id: 'skin_gold',
    labelKey: 'brass',
    coins: 800,
    productId: null,
    override: {
      frame: '#8a6a3c',
      glass: '#ffe0a8',
      accent: '#ffb63d',
      accentAlt: '#ffe08a',
    },
    shelf: 'brass',
    ui: { radius: 14, radiusLg: 20 },
  },
  {
    id: 'skin_arcade',
    labelKey: 'arcade',
    coins: 1200,
    productId: null,
    override: {
      frame: '#2b1e5e',
      glass: '#b9ffe8',
      accent: '#ff2e88',
      accentAlt: '#25f4c8',
    },
    shelf: 'arcade',
    ui: { radius: 6, radiusLg: 8 },
  },
  {
    id: 'skin_crystal',
    labelKey: 'crystal',
    coins: 1800,
    productId: null,
    override: {
      frame: '#5f7fb8',
      glass: '#e2f4ff',
      accent: '#9ad8ff',
      accentAlt: '#d8b8ff',
    },
    shelf: 'crystal',
    ui: { radius: 4, radiusLg: 14 },
  },
  {
    id: 'skin_chrome',
    labelKey: 'chrome',
    coins: null,
    productId: 'skin_chrome',
    override: {
      frame: '#7d90a6',
      glass: '#dceaf5',
      accent: '#7fd6ff',
      accentAlt: '#b8c8d8',
    },
    shelf: 'chrome',
    ui: { radius: 10, radiusLg: 16 },
  },
];

export function skinById(id: string): Skin {
  return SKINS.find((s) => s.id === id) ?? SKINS[0];
}

export function skinName(skin: Skin): string {
  return t(`skin.${skin.labelKey}.name` as Key);
}

export function skinDescription(skin: Skin): string {
  return t(`skin.${skin.labelKey}.note` as Key);
}

/**
 * Палитра сезона с наложенным скином. Фон (bgTop/bgBottom/glowA/glowB) скин не
 * трогает: он остаётся сезонным, иначе смена сезона перестала бы читаться, а
 * именно она — главный повод вернуться.
 */
export function themeWithSkin(theme: SeasonTheme, skinId: string): SeasonTheme {
  return { ...theme, ...skinById(skinId).override };
}

/**
 * Витрина-миниатюра для карточки в магазине.
 *
 * Скин теперь меняет конструкцию, а не цвет, — значит по описанию его выбрать
 * нельзя, надо показать. Рисуется отдельным упрощённым SVG, а не переиспользует
 * ShelfView: тот работает на Pixi и живёт внутри игрового поля.
 */
export function skinChipSvg(skin: Skin, theme: SeasonTheme): string {
  const t = { ...theme, ...skin.override };
  const w = 46;
  const h = 62;
  const box = (r: number) =>
    `<rect x="3" y="3" width="${w - 6}" height="${h - 10}" rx="${r}" fill="#000" ` +
    `opacity=".38"/><rect x="3" y="3" width="${w - 6}" height="${h - 10}" rx="${r}" ` +
    `fill="none" stroke="${t.frame}" stroke-width="2.4"/>`;
  const glassBar =
    `<rect x="7" y="7" width="4" height="${h - 18}" rx="2" fill="${t.glass}" opacity=".28"/>`;

  let inner = '';
  switch (skin.shelf) {
    case 'brass': {
      const rivet = (x: number, y: number) =>
        `<circle cx="${x}" cy="${y}" r="1.7" fill="${t.glass}" opacity=".8"/>`;
      inner =
        box(7) +
        glassBar +
        rivet(8, 8) +
        rivet(w - 8, 8) +
        rivet(8, h - 15) +
        rivet(w - 8, h - 15) +
        `<rect x="${w / 2 - 9}" y="${h - 20}" width="18" height="6" rx="2" fill="${t.accent}" ` +
        `opacity=".55"/>`;
      break;
    }
    case 'arcade':
      inner =
        box(2) +
        `<rect x="3" y="3" width="${w - 6}" height="9" rx="2" fill="${t.accent}" opacity=".5"/>` +
        `<circle cx="11" cy="7.5" r="2" fill="${t.accentAlt}"/>` +
        `<circle cx="${w - 11}" cy="7.5" r="2" fill="${t.accentAlt}"/>` +
        `<rect x="4.5" y="14" width="2" height="${h - 30}" fill="${t.accentAlt}" opacity=".8"/>` +
        `<rect x="${w - 6.5}" y="14" width="2" height="${h - 30}" fill="${t.accentAlt}" ` +
        `opacity=".8"/>`;
      break;
    case 'wood':
      inner =
        box(12) +
        glassBar +
        [0, 1, 2]
          .map(
            (i) =>
              `<rect x="5" y="${16 + i * 12}" width="${w - 10}" height="2.4" rx="1.2" ` +
              `fill="${t.frame}" opacity=".85"/>`
          )
          .join('');
      break;
    case 'chrome':
      inner =
        box(6) +
        glassBar +
        `<rect x="4.5" y="4.5" width="${w - 9}" height="3" rx="1.5" fill="#ffffff" ` +
        `opacity=".55"/>` +
        `<rect x="4.5" y="${h - 14}" width="${w - 9}" height="3" rx="1.5" fill="#000000" ` +
        `opacity=".4"/>`;
      break;
    case 'crystal': {
      const c = 9;
      const pts = [
        [3 + c, 3],
        [w - 3 - c, 3],
        [w - 3, 3 + c],
        [w - 3, h - 7 - c],
        [w - 3 - c, h - 7],
        [3 + c, h - 7],
        [3, h - 7 - c],
        [3, 3 + c],
      ]
        .map((p) => p.join(' '))
        .join(' L ');
      inner =
        `<path d="M ${pts} Z" fill="#000" opacity=".38"/>` +
        `<path d="M ${pts} Z" fill="none" stroke="${t.frame}" stroke-width="2.2"/>` +
        `<path d="M ${3 + c} 3 L 3 ${h - 12}" stroke="${t.glass}" stroke-width="1.4" ` +
        `opacity=".45"/>` +
        `<path d="M ${w - 3} ${3 + c} L ${w - 12} ${h - 7}" stroke="${t.glass}" ` +
        `stroke-width="1.4" opacity=".3"/>`;
      break;
    }
    default:
      inner =
        box(13) +
        glassBar +
        `<rect x="${w / 2 - 8}" y="${h - 12}" width="16" height="2" rx="1" fill="${t.glass}" ` +
        `opacity=".5"/>`;
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" ` +
    `height="${h}">${inner}` +
    `<ellipse cx="${w / 2}" cy="${h - 5}" rx="${w / 2 - 4}" ry="3" fill="${t.frame}" ` +
    `opacity=".45"/></svg>`
  );
}
