/**
 * Растеризация SVG-фигурок в текстуры Pixi.
 *
 * Фигурки описаны кодом (src/theme/figurines.ts) и превращаются в текстуры на
 * старте — ровно в том разрешении, которое нужно устройству. Это и есть
 * причина, по которой в сборке нет ни одного атласа: коллекция из 72 фигурок
 * весит несколько килобайт кода вместо нескольких мегабайт PNG.
 *
 * Растеризуются только фигурки текущего сезона (8 видов), остальные — по
 * требованию, когда игрок открывает коллекцию. На старте это 8 изображений,
 * а не 72.
 */

import { Texture } from 'pixi.js';
import { figurineSvg, VIEWBOX, type FigurineOptions, type ShapeId } from '../theme/figurines';
import type { Colorway } from '../theme/color';

/**
 * Базовая высота фигурки в текстуре, в CSS-пикселях. Умножается на DPR, но
 * ограничивается сверху: на телефоне с DPR 3 и 12 витринами разница между
 * ×2 и ×3 не видна, а память и время старта растут заметно.
 */
const BASE_HEIGHT = 132;
const MAX_SCALE = 2.5;

function scale(): number {
  return Math.min(MAX_SCALE, Math.max(1, window.devicePixelRatio || 1));
}

const cache = new Map<string, Texture>();
const pending = new Map<string, Promise<Texture>>();

/**
 * SVG → HTMLImageElement. Через blob: URL, а не data:, — большие SVG в
 * data-URI на части Android-браузеров упираются в лимит длины URL.
 */
function loadImage(svg: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('не удалось растеризовать SVG фигурки'));
    };
    img.src = url;
  });
}

async function rasterize(svg: string, heightCss: number): Promise<Texture> {
  const s = scale();
  const h = Math.round(heightCss * s);
  const w = Math.round((VIEWBOX.w / VIEWBOX.h) * h);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('нет 2d-контекста для растеризации');

  const img = await loadImage(svg);
  ctx.drawImage(img, 0, 0, w, h);

  const texture = Texture.from(canvas);
  // Текстура уже отрисована в целевом разрешении — дополнительное
  // сглаживание при масштабировании только мылит края.
  texture.source.scaleMode = 'linear';
  return texture;
}

/**
 * Доля кадра фигурки, занятая содержимым. Слой раскладки должен опираться на
 * неё, а не на размер текстуры: в кадре есть запас под свечение и тень.
 */
export const CONTENT_RATIO = {
  x: -VIEWBOX.x / VIEWBOX.w,
  y: -VIEWBOX.y / VIEWBOX.h,
  w: 100 / VIEWBOX.w,
  h: 120 / VIEWBOX.h,
} as const;

export interface FigurineTextureKey {
  shape: ShapeId;
  colors: Colorway;
  options?: FigurineOptions;
  /** Ключ кэша: должен однозначно описывать внешний вид. */
  cacheKey: string;
  heightCss?: number;
}

/** Получить текстуру фигурки, растеризовав её при первом обращении. */
export async function figurineTexture(key: FigurineTextureKey): Promise<Texture> {
  const cacheKey = `${key.cacheKey}@${key.heightCss ?? BASE_HEIGHT}`;
  const hit = cache.get(cacheKey);
  if (hit) return hit;
  const inFlight = pending.get(cacheKey);
  if (inFlight) return inFlight;

  const promise = rasterize(
    figurineSvg(key.shape, key.colors, key.options ?? {}),
    key.heightCss ?? BASE_HEIGHT
  )
    .then((texture) => {
      cache.set(cacheKey, texture);
      pending.delete(cacheKey);
      return texture;
    })
    .catch((err) => {
      pending.delete(cacheKey);
      throw err;
    });

  pending.set(cacheKey, promise);
  return promise;
}

/** Синхронный доступ к уже готовой текстуре — для горячего пути рендера. */
export function cachedFigurine(cacheKey: string, heightCss = BASE_HEIGHT): Texture | undefined {
  return cache.get(`${cacheKey}@${heightCss}`);
}

/**
 * Растеризовать сразу набор фигурок. Используется на загрузке для видов
 * текущего сезона: восемь параллельных растеризаций укладываются в один кадр
 * и не растягивают старт.
 */
export async function preloadFigurines(keys: FigurineTextureKey[]): Promise<void> {
  await Promise.all(keys.map((k) => figurineTexture(k).catch(() => undefined)));
}

