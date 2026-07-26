/**
 * Работа с цветом для генерации скинов.
 *
 * Все производные оттенки фигурки (светлый, тёмный, контровой) вычисляются
 * из одного базового цвета. Это не оптимизация ради краткости данных, а
 * защита от расхождения: 72 фигурки в шести сезонах, набранные вручную,
 * гарантированно разъедутся по светлоте и насыщенности, и витрина начнёт
 * выглядеть неряшливо. Формула держит единый материал — глянцевый винил —
 * для всей коллекции.
 */

export interface Hsl {
  h: number; // 0..360
  s: number; // 0..100
  l: number; // 0..100
}

export function hexToHsl(hex: string): Hsl {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l: l * 100 };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return { h, s: s * 100, l: l * 100 };
}

export function hslToHex({ h, s, l }: Hsl): string {
  const sn = clamp(s, 0, 100) / 100;
  const ln = clamp(l, 0, 100) / 100;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let rgb: [number, number, number];
  if (hp < 1) rgb = [c, x, 0];
  else if (hp < 2) rgb = [x, c, 0];
  else if (hp < 3) rgb = [0, c, x];
  else if (hp < 4) rgb = [0, x, c];
  else if (hp < 5) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  const m = ln - c / 2;
  const to = (v: number) =>
    Math.round(clamp((v + m) * 255, 0, 255))
      .toString(16)
      .padStart(2, '0');
  return `#${to(rgb[0])}${to(rgb[1])}${to(rgb[2])}`;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function shift(hex: string, dh: number, ds: number, dl: number): string {
  const hsl = hexToHsl(hex);
  return hslToHex({ h: hsl.h + dh, s: hsl.s + ds, l: hsl.l + dl });
}

/** Смешать два цвета в пространстве sRGB. t=0 → a, t=1 → b. */
export function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.replace('#', ''), 16);
  const pb = parseInt(b.replace('#', ''), 16);
  const lerp = (sa: number, sb: number) => Math.round(sa + (sb - sa) * t);
  const r = lerp((pa >> 16) & 255, (pb >> 16) & 255);
  const g = lerp((pa >> 8) & 255, (pb >> 8) & 255);
  const bl = lerp(pa & 255, pb & 255);
  return `#${((r << 16) | (g << 8) | bl).toString(16).padStart(6, '0')}`;
}

/** Число 0xRRGGBB для Pixi. */
export function toNumber(hex: string): number {
  return parseInt(hex.replace('#', ''), 16);
}

/**
 * Относительная яркость по WCAG. Нужна, чтобы проверять: различимы ли виды
 * фигурок в оттенках серого. Сортировка, где виды отличаются только цветом,
 * недоступна игрокам с дальтонизмом — поэтому у каждого вида ещё и свой
 * силуэт, а этой функцией мы проверяем, что и по светлоте они не слиплись.
 */
export function luminance(hex: string): number {
  const n = parseInt(hex.replace('#', ''), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/**
 * Полная раскраска одной фигурки — глянцевый винил.
 *
 * `base`  — основной цвет корпуса;
 * `light` — освещённая часть (верх-слева), сдвинута в тепло: холодный
 *           светлый оттенок читается как выцветший пластик;
 * `dark`  — теневая часть и контакт с полкой, насыщеннее базового: тень на
 *           цветном пластике не серая, а более плотная по цвету;
 * `rim`   — контровой свет по нижне-правому краю. Именно он превращает
 *           плоское пятно в объёмный предмет, поэтому он яркий и слегка
 *           смещён по тону;
 * `ink`   — цвет глаз и рта: не чёрный, а очень тёмный оттенок самого
 *           корпуса, иначе лицо выглядит наклеенным.
 */
export interface Colorway {
  base: string;
  light: string;
  dark: string;
  rim: string;
  ink: string;
  /** Цвет свечения вокруг фигурки в неоновых сезонах. */
  glow: string;
}

export interface ColorwayOptions {
  /** Сдвиг тона контрового света, градусы. */
  rimShift?: number;
  /** Металлический/перламутровый вид: сильнее контраст света и тени. */
  chrome?: boolean;
  /** Пастельный вид: мягче контраст, выше светлота. */
  pastel?: boolean;
}

export function colorway(base: string, opts: ColorwayOptions = {}): Colorway {
  const { rimShift = 0, chrome = false, pastel = false } = opts;
  const hsl = hexToHsl(base);

  const lightLift = chrome ? 34 : pastel ? 20 : 26;
  const darkDrop = chrome ? 34 : pastel ? 18 : 26;

  return {
    base,
    // Свет уводим в тепло и слегка снижаем насыщенность — так блик читается
    // как отражение источника, а не как более светлая краска.
    light: shift(base, pastel ? 4 : 8, pastel ? -6 : -14, lightLift),
    // Тень наоборот насыщаем и уводим в холод.
    dark: shift(base, -10, chrome ? 6 : 12, -darkDrop),
    rim: shift(base, rimShift, -8, chrome ? 40 : 30),
    ink: hslToHex({ h: hsl.h, s: clamp(hsl.s * 0.55, 12, 46), l: pastel ? 26 : 17 }),
    glow: shift(base, 0, 10, 12),
  };
}
