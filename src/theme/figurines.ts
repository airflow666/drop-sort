/**
 * Коллекционные фигурки: генерация SVG.
 *
 * ── Зачем SVG, а не готовые PNG-атласы ────────────────────────────────────
 * 72 фигурки (6 сезонов × 12) в трёх разрешениях под разные DPR — это
 * несколько мегабайт атласов при бюджете сборки 15 МБ и требовании стартовать
 * за 5 секунд. Здесь же вся коллекция — это восемь описаний силуэта плюс
 * таблица цветов: несколько килобайт кода, растеризуемых на старте ровно в то
 * разрешение, которое нужно устройству. Заодно перекраска сезона — это правка
 * одной строки, а не пересборка атласов.
 *
 * ── Почему у каждого вида свой силуэт, а не только цвет ───────────────────
 * В сортировках виды обычно различаются только цветом, и игроки с
 * дальтонизмом (около 8% мужчин) в такую игру играть не могут вообще.
 * Здесь вид кодируется дважды — цветом И формой, — поэтому поле читается
 * даже в оттенках серого. Это ещё и лучше играется: на поле ищут «витрину
 * с котами», а не «розовую витрину».
 *
 * ── Из чего сделан объём ──────────────────────────────────────────────────
 * Каждая фигурка собирается слоями, имитирующими глянцевый винил:
 * запечённое свечение → корпус с радиальным градиентом → внутренняя тень
 * снизу → контровой свет по нижне-правому краю → мягкий блик сверху-слева →
 * острый блик → лицо. Контровой свет — самый важный слой: без него фигурка
 * читается как плоское пятно.
 */

import type { Colorway } from './color';
import { mix } from './color';

export type ShapeId = 'blob' | 'cat' | 'bear' | 'bunny' | 'ghost' | 'star' | 'dino' | 'alien';

export const SHAPE_IDS: readonly ShapeId[] = [
  'blob',
  'cat',
  'bear',
  'bunny',
  'ghost',
  'star',
  'dino',
  'alien',
];

/**
 * Геометрия задаётся в системе 100×120, но viewBox шире: запечённому свечению
 * и контактной тени нужен запас, иначе они обрежутся по краю текстуры.
 * Слой раскладки должен опираться на CONTENT, а не на VIEWBOX.
 */
export const VIEWBOX = { x: -16, y: -14, w: 132, h: 150 } as const;
export const CONTENT = { w: 100, h: 120 } as const;

type EyeStyle = 'round' | 'almond' | 'sparkle';

interface ShapeDef {
  /** Русское имя для экрана коллекции. */
  name: string;
  /** Контур корпуса. */
  body: string;
  /** Элементы за корпусом: уши, шипы, антенна. */
  behind?: (c: Colorway) => string;
  /** Элементы поверх корпуса: внутренние уши, брюшко, морда. */
  front?: (c: Colorway) => string;
  /** Центр лица и раствор глаз. */
  face: { y: number; gap: number; size?: number };
  eyes?: EyeStyle;
  blush?: boolean;
}

// --- Вспомогательные построители контуров -----------------------------------

/** Звезда со скруглёнными лучами: строится расчётом, а не подбором координат. */
function roundedStar(
  cx: number,
  cy: number,
  outer: number,
  inner: number,
  points: number,
  round: number
): string {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    // -90° — чтобы верхний луч смотрел строго вверх.
    const a = (Math.PI * i) / points - Math.PI / 2;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  // Каждый угол срезается двумя точками и соединяется квадратичной кривой.
  let d = '';
  for (let i = 0; i < pts.length; i++) {
    const prev = pts[(i - 1 + pts.length) % pts.length];
    const cur = pts[i];
    const next = pts[(i + 1) % pts.length];
    const inLen = Math.hypot(cur[0] - prev[0], cur[1] - prev[1]);
    const outLen = Math.hypot(next[0] - cur[0], next[1] - cur[1]);
    // Внутренние углы скругляем сильнее: острые впадины выглядят колюче.
    const k = i % 2 === 0 ? round : round * 1.6;
    const a: [number, number] = [
      cur[0] + ((prev[0] - cur[0]) / inLen) * Math.min(k, inLen / 2),
      cur[1] + ((prev[1] - cur[1]) / inLen) * Math.min(k, inLen / 2),
    ];
    const b: [number, number] = [
      cur[0] + ((next[0] - cur[0]) / outLen) * Math.min(k, outLen / 2),
      cur[1] + ((next[1] - cur[1]) / outLen) * Math.min(k, outLen / 2),
    ];
    d += i === 0 ? `M ${f(a[0])} ${f(a[1])} ` : `L ${f(a[0])} ${f(a[1])} `;
    d += `Q ${f(cur[0])} ${f(cur[1])} ${f(b[0])} ${f(b[1])} `;
  }
  return `${d}Z`;
}

/** Короткая запись числа — SVG-строки уходят в бандл, лишние знаки ни к чему. */
function f(n: number): string {
  return (Math.round(n * 10) / 10).toString();
}

/** Отражение контура по вертикальной оси x=50 — для парных ушей. */
function mirror(inner: string): string {
  return `<g transform="translate(100,0) scale(-1,1)">${inner}</g>`;
}

// --- Силуэты ----------------------------------------------------------------

/** Базовое «яйцо»: широкий низ, покатый верх. Основа для большинства видов. */
const EGG =
  'M 50 30 C 77 30, 93 53, 93 79 C 93 104, 75 117, 50 117 ' +
  'C 25 117, 7 104, 7 79 C 7 53, 23 30, 50 30 Z';

const SHAPES: Record<ShapeId, ShapeDef> = {
  // Капля: единственный вид без «головы» — читается как слайм.
  blob: {
    name: 'Слайм',
    body:
      'M 50 14 C 57 41, 92 58, 92 84 C 92 105, 73 118, 50 118 ' +
      'C 27 118, 8 105, 8 84 C 8 58, 43 41, 50 14 Z',
    face: { y: 86, gap: 15 },
    eyes: 'sparkle',
    blush: true,
  },

  // Треугольные уши — самый узнаваемый силуэт после звезды.
  cat: {
    name: 'Котик',
    body: EGG,
    behind: (c) => {
      const ear = `<path d="M 15 56 L 7 5 L 49 34 Z" fill="${c.base}"/>`;
      return ear + mirror(ear);
    },
    front: (c) => {
      const inner = `<path d="M 21 48 L 17 17 L 40 36 Z" fill="${c.light}" opacity=".75"/>`;
      return inner + mirror(inner);
    },
    face: { y: 80, gap: 15 },
    blush: true,
  },

  // Круглые уши + светлая морда: отличается от кота именно скруглением.
  bear: {
    name: 'Мишка',
    body: EGG,
    behind: (c) => {
      const ear = `<circle cx="20" cy="41" r="16" fill="${c.base}"/>`;
      return ear + mirror(ear);
    },
    front: (c) => {
      const inner = `<circle cx="20" cy="43" r="8.5" fill="${c.light}" opacity=".7"/>`;
      return (
        inner +
        mirror(inner) +
        `<ellipse cx="50" cy="95" rx="21" ry="15" fill="${c.light}" opacity=".55"/>` +
        `<ellipse cx="50" cy="88" rx="5" ry="3.6" fill="${c.ink}" opacity=".8"/>`
      );
    },
    face: { y: 76, gap: 14 },
    blush: true,
  },

  // Длинные вертикальные уши — читаются даже на 40 пикселях.
  bunny: {
    name: 'Зайка',
    body: EGG,
    behind: (c) => {
      const ear = `<path d="M 33 50 C 22 24, 25 1, 36 1 C 47 1, 44 27, 42 52 Z" fill="${c.base}"/>`;
      return ear + mirror(ear);
    },
    front: (c) => {
      const inner =
        `<path d="M 35 46 C 28 26, 30 9, 36 9 C 42 9, 40 28, 39 47 Z" ` +
        `fill="${c.light}" opacity=".7"/>`;
      return inner + mirror(inner);
    },
    face: { y: 80, gap: 14 },
    blush: true,
  },

  // Волнистый низ вместо ног. Без румян — призрак должен быть чуть холоднее.
  ghost: {
    name: 'Призрак',
    body:
      'M 50 20 C 76 20, 91 45, 91 72 L 91 104 ' +
      'Q 84 118, 77 108 Q 70 96, 63 108 Q 56 120, 50 108 ' +
      'Q 44 96, 37 108 Q 30 120, 23 108 Q 16 96, 9 104 ' +
      'L 9 72 C 9 45, 24 20, 50 20 Z',
    face: { y: 66, gap: 16, size: 1.1 },
    eyes: 'round',
  },

  // Единственный радиально-симметричный силуэт — контрастирует со всеми.
  star: {
    name: 'Звезда',
    body: roundedStar(50, 68, 52, 24, 5, 7),
    face: { y: 70, gap: 13, size: 0.9 },
    eyes: 'sparkle',
    blush: true,
  },

  // Гребень шипов по верху и светлое брюшко.
  dino: {
    name: 'Дино',
    body: EGG,
    behind: (c) => {
      // Шипы светлые, а не тёмные: тёмные сливались с корпусом, и дино на
      // поле было не отличить от слайма — силуэт перестаёт работать как
      // второй канал кодирования вида.
      const spike = (d: string) =>
        `<path d="${d}" fill="${c.light}" stroke="${c.dark}" stroke-width="1.6" ` +
        `stroke-linejoin="round"/>`;
      return (
        spike('M 24 54 L 29 6 L 46 38 Z') +
        spike('M 40 36 L 50 0 L 60 36 Z') +
        spike('M 54 38 L 71 6 L 76 54 Z')
      );
    },
    front: (c) =>
      `<ellipse cx="50" cy="96" rx="23" ry="17" fill="${c.light}" opacity=".5"/>` +
      `<path d="M 34 104 Q 50 112, 66 104" stroke="${c.dark}" stroke-width="2" ` +
      `fill="none" opacity=".35"/>`,
    face: { y: 74, gap: 16 },
  },

  // Широкий череп, сужающийся к подбородку, и одна антенна. Обычное «яйцо»
  // здесь не годится: без ушей пришелец повторял бы силуэт слайма.
  alien: {
    name: 'Пришелец',
    body:
      'M 50 24 C 85 24, 98 52, 92 76 C 86 102, 68 118, 50 118 ' +
      'C 32 118, 14 102, 8 76 C 2 52, 15 24, 50 24 Z',
    behind: (c) =>
      `<path d="M 50 34 C 52 20, 60 15, 64 8" stroke="${c.dark}" stroke-width="4.5" ` +
      `fill="none" stroke-linecap="round"/>` +
      `<circle cx="65" cy="6" r="7" fill="${c.rim}"/>` +
      `<circle cx="63" cy="4" r="2.4" fill="#ffffff" opacity=".8"/>`,
    face: { y: 78, gap: 18, size: 1.15 },
    eyes: 'almond',
  },
};

export function shapeName(shape: ShapeId): string {
  return SHAPES[shape].name;
}

// --- Лицо -------------------------------------------------------------------

function eyes(def: ShapeDef, c: Colorway): string {
  const { y, gap } = def.face;
  const s = def.face.size ?? 1;
  const style = def.eyes ?? 'round';
  const lx = 50 - gap;
  const rx = 50 + gap;

  if (style === 'almond') {
    // Миндаль с наклоном к центру — фирменный «взгляд пришельца».
    const eye = (x: number, flip: number) =>
      `<path d="M ${f(x - 9 * s * flip)} ${f(y - 2 * s)} Q ${f(x)} ${f(y - 11 * s)} ` +
      `${f(x + 8 * s * flip)} ${f(y + 1 * s)} Q ${f(x)} ${f(y + 8 * s)} ` +
      `${f(x - 9 * s * flip)} ${f(y - 2 * s)} Z" fill="${c.ink}"/>` +
      `<ellipse cx="${f(x - 2 * s * flip)}" cy="${f(y - 3 * s)}" rx="${f(2.4 * s)}" ` +
      `ry="${f(1.8 * s)}" fill="#ffffff" opacity=".9"/>`;
    return eye(lx, 1) + eye(rx, -1);
  }

  const rEye = 6.4 * s;
  const eye = (x: number) =>
    `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(rEye)}" ry="${f(rEye * 1.15)}" fill="${c.ink}"/>` +
    // Блик в глазу — самая дешёвая деталь, которая оживляет лицо.
    `<circle cx="${f(x - rEye * 0.34)}" cy="${f(y - rEye * 0.42)}" r="${f(rEye * 0.34)}" ` +
    `fill="#ffffff" opacity=".95"/>` +
    (style === 'sparkle'
      ? `<circle cx="${f(x + rEye * 0.36)}" cy="${f(y + rEye * 0.4)}" r="${f(rEye * 0.17)}" ` +
        `fill="#ffffff" opacity=".6"/>`
      : '');
  return eye(lx) + eye(rx);
}

function mouth(def: ShapeDef, c: Colorway): string {
  const { y } = def.face;
  const s = def.face.size ?? 1;
  const my = y + 13 * s;
  return (
    `<path d="M ${f(50 - 5.5 * s)} ${f(my)} Q ${f(50)} ${f(my + 5 * s)} ${f(50 + 5.5 * s)} ${f(my)}" ` +
    `stroke="${c.ink}" stroke-width="${f(2.1 * s)}" fill="none" stroke-linecap="round"/>`
  );
}

function blush(def: ShapeDef, c: Colorway): string {
  if (!def.blush) return '';
  const { y, gap } = def.face;
  const s = def.face.size ?? 1;
  const by = y + 8 * s;
  const cheek = (x: number) =>
    `<ellipse cx="${f(x)}" cy="${f(by)}" rx="${f(5.5 * s)}" ry="${f(3.2 * s)}" ` +
    `fill="${mix(c.dark, '#ff5a7a', 0.55)}" opacity=".38"/>`;
  return cheek(50 - gap - 10 * s) + cheek(50 + gap + 10 * s);
}

// --- Сборка -----------------------------------------------------------------

export interface FigurineOptions {
  /** Запечённое неоновое свечение вокруг фигурки. Выключается в пастельных сезонах. */
  glow?: boolean;
  /** Ободок «редкости» — тонкий светящийся контур. */
  aura?: string;
  /** Лицо не рисуется (силуэт для карточки-заглушки в коллекции). */
  silhouette?: boolean;
}

let uid = 0;

/**
 * Собрать SVG одной фигурки. Возвращает документ целиком — он растеризуется
 * через Image() в текстуру Pixi (см. src/render/textures.ts).
 */
export function figurineSvg(shape: ShapeId, c: Colorway, opts: FigurineOptions = {}): string {
  const def = SHAPES[shape];
  const { glow = true, aura, silhouette = false } = opts;
  const n = ++uid;
  const id = (k: string) => `${k}${n}`;

  const behind = def.behind?.(c) ?? '';
  const front = def.front?.(c) ?? '';

  const face = silhouette ? '' : blush(def, c) + eyes(def, c) + mouth(def, c);

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" ` +
    `viewBox="${VIEWBOX.x} ${VIEWBOX.y} ${VIEWBOX.w} ${VIEWBOX.h}" ` +
    `width="${VIEWBOX.w}" height="${VIEWBOX.h}">` +
    `<defs>` +
    // Корпус: свет сверху-слева, база в середине, плотная тень справа-снизу.
    `<radialGradient id="${id('body')}" cx="34%" cy="26%" r="82%">` +
    `<stop offset="0" stop-color="${c.light}"/>` +
    `<stop offset=".52" stop-color="${c.base}"/>` +
    `<stop offset="1" stop-color="${c.dark}"/>` +
    `</radialGradient>` +
    // Контровой свет: ярко по нижне-правому краю, к центру — в ноль.
    `<linearGradient id="${id('rim')}" x1="1" y1="1" x2="0" y2="0">` +
    `<stop offset="0" stop-color="${c.rim}" stop-opacity=".95"/>` +
    `<stop offset=".38" stop-color="${c.rim}" stop-opacity="0"/>` +
    `</linearGradient>` +
    // Мягкий широкий блик.
    `<radialGradient id="${id('spec')}" cx="50%" cy="50%" r="50%">` +
    `<stop offset="0" stop-color="#ffffff" stop-opacity=".62"/>` +
    `<stop offset="1" stop-color="#ffffff" stop-opacity="0"/>` +
    `</radialGradient>` +
    // Внутренняя тень у основания — фигурка «стоит», а не висит.
    `<radialGradient id="${id('occ')}" cx="50%" cy="50%" r="50%">` +
    `<stop offset="0" stop-color="${c.dark}" stop-opacity=".85"/>` +
    `<stop offset="1" stop-color="${c.dark}" stop-opacity="0"/>` +
    `</radialGradient>` +
    // Запечённое свечение. filterUnits с запасом — иначе размытие обрежется.
    `<filter id="${id('blur')}" x="-60%" y="-60%" width="220%" height="220%">` +
    `<feGaussianBlur stdDeviation="9"/>` +
    `</filter>` +
    // Отдельное, более плотное размытие для ободка редкости.
    `<filter id="${id('halo')}" x="-60%" y="-60%" width="220%" height="220%">` +
    `<feGaussianBlur stdDeviation="3.2"/>` +
    `</filter>` +
    // Клип по корпусу: блики и контровой свет не должны выходить за силуэт.
    `<clipPath id="${id('clip')}"><path d="${def.body}"/></clipPath>` +
    `</defs>` +
    // 1. Свечение — размытая копия силуэта под всем остальным.
    (glow
      ? `<g filter="url(#${id('blur')})" opacity=".5">` +
        `<path d="${def.body}" fill="${c.glow}"/>${behind}</g>`
      : '') +
    // 2. Контактная тень на полке.
    `<ellipse cx="50" cy="119" rx="30" ry="6" fill="#000000" opacity=".33" ` +
    `filter="url(#${id('blur')})"/>` +
    // 3. Ободок редкости — размытая обводка ПОД корпусом, то есть гало.
    // Резкая обводка поверх силуэта читалась как дешёвый аутлайн и ломала
    // ощущение винила, ради которого выстроены все остальные слои.
    (aura
      ? `<g filter="url(#${id('halo')})">` +
        `<path d="${def.body}" fill="none" stroke="${aura}" stroke-width="6"/>` +
        // Уши, шипы и антенна тоже должны светиться. Перекрашиваем и заливку,
        // и обводку, но НЕ трогаем fill="none": иначе у антенны пришельца
        // залилась бы область под её кривой.
        (behind
          ? `<g opacity=".8">${behind
              .replace(/fill="(?!none)[^"]*"/g, `fill="${aura}"`)
              .replace(/stroke="(?!none)[^"]*"/g, `stroke="${aura}"`)}</g>`
          : '') +
        `</g>`
      : '') +
    // 4. Элементы за корпусом.
    behind +
    // 5. Корпус.
    `<path d="${def.body}" fill="url(#${id('body')})"/>` +
    // 6. Всё, что должно остаться внутри силуэта.
    `<g clip-path="url(#${id('clip')})">` +
    `<ellipse cx="50" cy="122" rx="42" ry="20" fill="url(#${id('occ')})"/>` +
    `<path d="${def.body}" fill="none" stroke="url(#${id('rim')})" stroke-width="7"/>` +
    `<ellipse cx="34" cy="52" rx="20" ry="15" fill="url(#${id('spec')})" ` +
    `transform="rotate(-24 34 52)"/>` +
    `<ellipse cx="30" cy="47" rx="5.5" ry="3.4" fill="#ffffff" opacity=".8" ` +
    `transform="rotate(-24 30 47)"/>` +
    `</g>` +
    // 7. Детали поверх корпуса и лицо.
    front +
    face +
    `</svg>`
  );
}
