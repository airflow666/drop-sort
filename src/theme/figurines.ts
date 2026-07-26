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
 *
 * ── Почему у сезона есть стиль, а не только палитра ────────────────────────
 * Шесть серий на одних и тех же восьми силуэтах различались только цветом, и
 * рядом в витрине коллекции выглядели одной и той же линейкой в шести
 * оттенках — то есть повода собирать новую серию не возникало. Поэтому у
 * сезона теперь есть СТИЛЬ (см. STYLES ниже): материал (матовый плюш,
 * зеркальный хром, глазурь) и набор деталей внешности — наушники, бант,
 * болты, листик, нимб, посыпка. Силуэт при этом не трогается ни одним
 * стилем: вид фигурки по-прежнему кодируется формой, и поле остаётся
 * читаемым в оттенках серого.
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
  /**
   * Куда садится аксессуар сезона (бант, листик, нимб, наушники).
   * Точка своя у каждого силуэта: у зайки между ушами свободно, у дино на её
   * месте гребень, у пришельца справа торчит антенна. Общей формулы «верх
   * корпуса» тут нет — она бы у половины видов попала внутрь другой детали.
   */
  crown: { x: number; y: number };
  /** Половина ширины головы на уровне лица — по ней строится дужка наушников. */
  headHalf: number;
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
    crown: { x: 50, y: 30 },
    headHalf: 40,
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
    crown: { x: 50, y: 34 },
    headHalf: 42,
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
    crown: { x: 50, y: 32 },
    headHalf: 42,
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
    // Между ушами зайки ровно та полоса, куда просится бант.
    crown: { x: 50, y: 28 },
    headHalf: 42,
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
    crown: { x: 50, y: 22 },
    headHalf: 40,
  },

  // Единственный радиально-симметричный силуэт — контрастирует со всеми.
  star: {
    name: 'Звезда',
    body: roundedStar(50, 68, 52, 24, 5, 7),
    face: { y: 70, gap: 13, size: 0.9 },
    eyes: 'sparkle',
    blush: true,
    // Верхний луч звезды узкий — аксессуар садится на его основание.
    crown: { x: 50, y: 34 },
    headHalf: 34,
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
    // На макушке дино гребень, поэтому аксессуар уходит вбок, на левый шип.
    crown: { x: 29, y: 22 },
    headHalf: 42,
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
    // Справа торчит антенна — аксессуар садится слева от неё.
    crown: { x: 34, y: 32 },
    headHalf: 44,
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

// --- Стили сезонов ----------------------------------------------------------

/**
 * Стиль серии. Определяет материал (насколько фигурка глянцевая) и детали
 * внешности. Стиль НЕ меняет силуэт: вид фигурки читается формой, и любая
 * подмена контура сломала бы второй канал кодирования вида.
 */
export type SeasonStyle = 'neon' | 'plush' | 'chrome' | 'fresh' | 'cosmic' | 'candy';

interface StyleDef {
  /** Мягкий широкий блик: 0 — матовая ткань, 1 — сильный глянец. */
  spec: number;
  /** Острый блик-точка. У плюша его нет вовсе — ткань так не блестит. */
  sharp: number;
  /** Толщина контрового света. */
  rim: number;
  /** Множитель запечённого свечения. 0 — свечения нет даже при glow: true. */
  halo: number;
  /** Детали, повторяющие силуэт: рисуются внутри клипа корпуса. */
  onBody?(c: Colorway, def: ShapeDef): string;
  /** Аксессуар на макушке — поверх всех слоёв. */
  crown?(c: Colorway, def: ShapeDef): string;
  /** Дополнение к лицу: веснушки, шов вместо рта, звёздный блик. */
  onFace?(c: Colorway, def: ShapeDef): string;
}

/** Точки звёздной пыли для «Полуночи» — фиксированные, чтобы не мерцали. */
const DUST: ReadonlyArray<readonly [number, number, number]> = [
  [26, 52, 1.6],
  [70, 44, 2.1],
  [82, 70, 1.4],
  [18, 82, 1.8],
  [58, 96, 1.3],
  [38, 66, 1.1],
  [76, 100, 1.6],
];

/** Посыпка на глазури: x, y, поворот. */
const SPRINKLES: ReadonlyArray<readonly [number, number, number]> = [
  [26, 44, -28],
  [42, 34, 18],
  [60, 40, -12],
  [76, 52, 34],
  [34, 56, 42],
  [66, 62, -40],
];

const STYLES: Record<SeasonStyle, StyleDef> = {
  // Первый дроп: кислота и хром. Материал прежний — глянцевый винил, а
  // характер серии дают наушники и световые полосы по корпусу.
  neon: {
    spec: 0.62,
    sharp: 0.8,
    rim: 7,
    halo: 1,
    onBody: (c) =>
      [0.46, 0.6].map(
        (t) =>
          `<rect x="0" y="${f(120 * t)}" width="100" height="3" fill="${c.rim}" opacity=".3"/>`
      ).join(''),
    crown: (c, def) => {
      const { x, y } = def.crown;
      const r = def.headHalf - 2;
      const cupY = def.face.y - 14;
      const cup = (cx: number) =>
        `<rect x="${f(cx - 7)}" y="${f(cupY - 9)}" width="14" height="19" rx="6.5" ` +
        `fill="${c.dark}"/>` +
        `<rect x="${f(cx - 4.4)}" y="${f(cupY - 6)}" width="8.8" height="13" rx="4.2" ` +
        `fill="${c.rim}" opacity=".85"/>`;
      return (
        // Дужка идёт от одной чашки к другой через точку макушки.
        `<path d="M ${f(x - r)} ${f(cupY - 4)} Q ${f(x)} ${f(y - 12)} ${f(x + r)} ${f(cupY - 4)}" ` +
        `stroke="${c.dark}" stroke-width="5.5" fill="none" stroke-linecap="round"/>` +
        `<path d="M ${f(x - r)} ${f(cupY - 4)} Q ${f(x)} ${f(y - 9)} ${f(x + r)} ${f(cupY - 4)}" ` +
        `stroke="${c.rim}" stroke-width="1.8" fill="none" stroke-linecap="round" opacity=".9"/>` +
        cup(x - r) +
        cup(x + r)
      );
    },
  },

  // Мягкая серия: плюш. Блики убраны почти в ноль — ткань не бликует, и
  // именно отсутствие блика отличает её от всех остальных на расстоянии.
  plush: {
    spec: 0.2,
    sharp: 0,
    rim: 5,
    halo: 0.35,
    onBody: (c, def) => {
      const seam = def.face.y + 24;
      return (
        // Шов по центру нижней части корпуса.
        `<path d="M 50 ${f(seam)} L 50 118" stroke="${c.dark}" stroke-width="1.8" ` +
        `stroke-dasharray="4 4" stroke-linecap="round" opacity=".5"/>` +
        // Заплатка сбоку — с прострочкой по контуру.
        `<rect x="14" y="${f(seam - 6)}" width="17" height="17" rx="5" ` +
        `transform="rotate(-12 22 ${f(seam + 2)})" fill="${c.light}" opacity=".6"/>` +
        `<rect x="14" y="${f(seam - 6)}" width="17" height="17" rx="5" ` +
        `transform="rotate(-12 22 ${f(seam + 2)})" fill="none" stroke="${c.dark}" ` +
        `stroke-width="1.4" stroke-dasharray="3 3" opacity=".55"/>`
      );
    },
    crown: (c, def) => {
      const { x, y } = def.crown;
      // Петля банта — замкнутая «капля» вбок от узла. Через одну кривую она
      // получалась тонким серпом и на 40 пикселях читалась как царапина.
      const loop = (dir: number) =>
        `<path d="M ${f(x)} ${f(y)} C ${f(x + 9 * dir)} ${f(y - 16)}, ` +
        `${f(x + 26 * dir)} ${f(y - 14)}, ${f(x + 25 * dir)} ${f(y - 1)} ` +
        `C ${f(x + 24 * dir)} ${f(y + 11)}, ${f(x + 10 * dir)} ${f(y + 10)}, ` +
        `${f(x)} ${f(y)} Z" fill="${c.light}" stroke="${c.dark}" stroke-width="1.7" ` +
        `stroke-linejoin="round"/>`;
      return (
        loop(-1) +
        loop(1) +
        `<circle cx="${f(x)}" cy="${f(y)}" r="5.4" fill="${c.rim}" ` +
        `stroke="${c.dark}" stroke-width="1.5"/>`
      );
    },
    // Рот-строчка вместо дуги: у плюшевой игрушки он вышит.
    onFace: (c, def) => {
      const s = def.face.size ?? 1;
      const my = def.face.y + 13 * s;
      return (
        `<path d="M ${f(50 - 6 * s)} ${f(my)} L ${f(50 + 6 * s)} ${f(my)}" stroke="${c.ink}" ` +
        `stroke-width="${f(1.8 * s)}" stroke-dasharray="2.6 2.4" stroke-linecap="round"/>`
      );
    },
  },

  // Металлик: зеркальный горизонт поперёк корпуса плюс заклёпки. Горизонт —
  // главный признак хрома: без тёмной полосы с бликом под ней металл
  // читается просто как светло-серый пластик.
  chrome: {
    spec: 0.9,
    sharp: 1,
    rim: 8,
    halo: 0.5,
    onBody: (c, def) => {
      const h = def.face.y + 12;
      const rivet = (x: number, y: number) =>
        `<circle cx="${f(x)}" cy="${f(y)}" r="2.6" fill="${c.dark}" opacity=".75"/>` +
        `<circle cx="${f(x - 0.7)}" cy="${f(y - 0.8)}" r="1.1" fill="${c.rim}" opacity=".9"/>`;
      return (
        `<rect x="0" y="${f(h)}" width="100" height="9" fill="${c.dark}" opacity=".55"/>` +
        `<rect x="0" y="${f(h + 9)}" width="100" height="5" fill="#ffffff" opacity=".38"/>` +
        rivet(16, h + 22) +
        rivet(50, h + 27) +
        rivet(84, h + 22)
      );
    },
    // Шестигранная гайка на макушке — «собран на заводе».
    crown: (c, def) => {
      const { x, y } = def.crown;
      const r = 9;
      const pts = Array.from({ length: 6 }, (_, i) => {
        const a = (Math.PI / 3) * i - Math.PI / 2;
        return `${f(x + Math.cos(a) * r)} ${f(y + Math.sin(a) * r)}`;
      }).join(' L ');
      return (
        `<path d="M ${pts} Z" fill="${c.light}" stroke="${c.dark}" stroke-width="1.6" ` +
        `stroke-linejoin="round"/>` +
        `<circle cx="${f(x)}" cy="${f(y)}" r="3.4" fill="${c.dark}" opacity=".7"/>`
      );
    },
  },

  // Сочная летняя серия: мокрый глянец, листик и веснушки.
  fresh: {
    spec: 0.75,
    sharp: 0.95,
    rim: 7,
    halo: 0.8,
    // Листик — единственная деталь во всей игре, которая НЕ выводится из цвета
    // фигурки: зелёный лист на оранжевом корпусе и есть та самая «свежесть»
    // серии, а перекрашенный в тон корпуса он читается как царапина.
    crown: (c, def) => {
      const { x, y } = def.crown;
      const blade = mix(c.light, '#78d345', 0.78);
      const edge = mix(c.dark, '#2c6b24', 0.7);
      return (
        `<path d="M ${f(x)} ${f(y + 10)} C ${f(x - 2)} ${f(y + 1)}, ${f(x + 1)} ${f(y - 6)}, ` +
        `${f(x + 3)} ${f(y - 13)}" stroke="${edge}" stroke-width="3" fill="none" ` +
        `stroke-linecap="round"/>` +
        `<path d="M ${f(x + 2)} ${f(y - 3)} C ${f(x + 8)} ${f(y - 20)}, ${f(x + 26)} ${f(y - 17)}, ` +
        `${f(x + 24)} ${f(y - 4)} C ${f(x + 22)} ${f(y + 6)}, ${f(x + 7)} ${f(y + 6)}, ` +
        `${f(x + 2)} ${f(y - 3)} Z" fill="${blade}" stroke="${edge}" stroke-width="1.5" ` +
        `stroke-linejoin="round"/>` +
        `<path d="M ${f(x + 5)} ${f(y - 2)} Q ${f(x + 15)} ${f(y - 6)}, ${f(x + 22)} ${f(y - 6)}" ` +
        `stroke="${edge}" stroke-width="1.2" fill="none" opacity=".6"/>`
      );
    },
    onFace: (c, def) => {
      const { y, gap } = def.face;
      const s = def.face.size ?? 1;
      const dot = (x: number, dy: number) =>
        `<circle cx="${f(x)}" cy="${f(y + dy * s)}" r="${f(1.3 * s)}" fill="${c.dark}" ` +
        `opacity=".5"/>`;
      const cheek = (side: number) =>
        dot(50 + side * (gap + 8 * s), 5) +
        dot(50 + side * (gap + 13 * s), 8) +
        dot(50 + side * (gap + 10 * s), 11);
      return cheek(-1) + cheek(1);
    },
  },

  // Драгоценная серия: звёздная пыль внутри корпуса и нимб над головой.
  cosmic: {
    spec: 0.5,
    sharp: 0.7,
    rim: 8,
    halo: 1.3,
    onBody: (c) =>
      DUST.map(
        ([x, y, r]) =>
          `<circle cx="${x}" cy="${y}" r="${r}" fill="#ffffff" opacity="${f(0.35 + r * 0.12)}"/>`
      ).join('') +
      `<path d="M 24 44 L 44 62 L 72 50" stroke="${c.rim}" stroke-width="1" fill="none" ` +
      `opacity=".35"/>`,
    crown: (c, def) => {
      const { x, y } = def.crown;
      return (
        `<ellipse cx="${f(x)}" cy="${f(y - 12)}" rx="21" ry="6" fill="none" ` +
        `stroke="${c.rim}" stroke-width="3.4" opacity=".9"/>` +
        `<ellipse cx="${f(x)}" cy="${f(y - 12)}" rx="21" ry="6" fill="none" ` +
        `stroke="#ffffff" stroke-width="1.2" opacity=".55"/>`
      );
    },
  },

  // Финальный дроп: глазурь по верху корпуса и посыпка. Глазурь режется по
  // силуэту, поэтому одинаково хорошо ложится и на яйцо, и на звезду.
  candy: {
    spec: 0.85,
    sharp: 1,
    rim: 7,
    halo: 0.9,
    onBody: (c, def) => {
      const glaze = mix(c.light, '#ffffff', 0.55);
      const edge = def.face.y - 4;
      // Нижняя кромка глазури — волна с четырьмя потёками.
      let d = `M -10 -20 L 110 -20 L 110 ${f(edge - 6)} `;
      for (let i = 0; i < 4; i++) {
        const x0 = 110 - i * 30;
        const x1 = x0 - 30;
        const deep = edge + (i % 2 === 0 ? 13 : 5);
        d += `Q ${f((x0 + x1) / 2)} ${f(deep)} ${f(x1)} ${f(edge - 6)} `;
      }
      d += `L -10 ${f(edge - 6)} Z`;
      const drops = SPRINKLES.map(
        ([x, y, rot]) =>
          `<rect x="${f(x - 3.2)}" y="${f(y - 1.2)}" width="6.4" height="2.4" rx="1.2" ` +
          `transform="rotate(${rot} ${x} ${y})" fill="${c.dark}" opacity=".75"/>`
      ).join('');
      return `<path d="${d}" fill="${glaze}" opacity=".92"/>${drops}`;
    },
    // Вишенка на макушке. Как и листик «Цитруса», она держит собственный цвет:
    // на белой глазури вишня в тон корпуса просто исчезает.
    crown: (c, def) => {
      const { x, y } = def.crown;
      const berry = mix(c.dark, '#e8244c', 0.82);
      const stem = mix(c.dark, '#3f7a2c', 0.7);
      return (
        `<path d="M ${f(x)} ${f(y - 4)} C ${f(x + 4)} ${f(y - 13)}, ${f(x + 10)} ${f(y - 16)}, ` +
        `${f(x + 13)} ${f(y - 20)}" stroke="${stem}" stroke-width="2.4" fill="none" ` +
        `stroke-linecap="round"/>` +
        `<circle cx="${f(x)}" cy="${f(y + 2)}" r="8" fill="${berry}"/>` +
        `<circle cx="${f(x)}" cy="${f(y + 2)}" r="8" fill="none" ` +
        `stroke="${mix(berry, '#000000', 0.35)}" stroke-width="1.2"/>` +
        `<circle cx="${f(x - 2.6)}" cy="${f(y - 0.6)}" r="2.4" fill="#ffffff" opacity=".85"/>`
      );
    },
  },
};

// --- Сборка -----------------------------------------------------------------

export interface FigurineOptions {
  /** Запечённое неоновое свечение вокруг фигурки. Выключается в пастельных сезонах. */
  glow?: boolean;
  /** Ободок «редкости» — тонкий светящийся контур. */
  aura?: string;
  /** Лицо не рисуется (силуэт для карточки-заглушки в коллекции). */
  silhouette?: boolean;
  /** Стиль серии. По умолчанию — глянцевый винил первого сезона. */
  style?: SeasonStyle;
}

let uid = 0;

/**
 * Собрать SVG одной фигурки. Возвращает документ целиком — он растеризуется
 * через Image() в текстуру Pixi (см. src/render/textures.ts).
 */
export function figurineSvg(shape: ShapeId, c: Colorway, opts: FigurineOptions = {}): string {
  const def = SHAPES[shape];
  const { glow = true, aura, silhouette = false, style = 'neon' } = opts;
  const look = STYLES[style];
  const n = ++uid;
  const id = (k: string) => `${k}${n}`;

  const behind = def.behind?.(c) ?? '';
  const front = def.front?.(c) ?? '';

  // Плюшевый стиль заменяет рот строчкой, поэтому обычная дуга при наличии
  // onFace не рисуется — иначе получилось бы два рта.
  const face = silhouette
    ? ''
    : blush(def, c) +
      eyes(def, c) +
      (style === 'plush' ? '' : mouth(def, c)) +
      (look.onFace?.(c, def) ?? '');

  // Детали сезона на силуэте-заглушке не нужны: там показывается, какой формы
  // фигурки не хватает, а не как она отделана.
  const onBody = silhouette ? '' : (look.onBody?.(c, def) ?? '');
  const crown = silhouette ? '' : (look.crown?.(c, def) ?? '');
  const haloOpacity = 0.5 * look.halo;

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
    // Мягкий широкий блик. Его плотность задаёт стиль сезона: у плюша он почти
    // выключен, у хрома и глазури — на максимуме.
    `<radialGradient id="${id('spec')}" cx="50%" cy="50%" r="50%">` +
    `<stop offset="0" stop-color="#ffffff" stop-opacity="${f(look.spec)}"/>` +
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
    (glow && haloOpacity > 0.02
      ? `<g filter="url(#${id('blur')})" opacity="${f(haloOpacity)}">` +
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
    // 6. Всё, что должно остаться внутри силуэта. Отделка сезона идёт здесь же:
    // глазурь, хромовый горизонт и звёздная пыль обязаны обрезаться по корпусу,
    // иначе они «съезжают» с фигурки на любой нестандартной форме.
    `<g clip-path="url(#${id('clip')})">` +
    `<ellipse cx="50" cy="122" rx="42" ry="20" fill="url(#${id('occ')})"/>` +
    `<path d="${def.body}" fill="none" stroke="url(#${id('rim')})" ` +
    `stroke-width="${f(look.rim)}"/>` +
    onBody +
    `<ellipse cx="34" cy="52" rx="20" ry="15" fill="url(#${id('spec')})" ` +
    `transform="rotate(-24 34 52)"/>` +
    (look.sharp > 0
      ? `<ellipse cx="30" cy="47" rx="5.5" ry="3.4" fill="#ffffff" ` +
        `opacity="${f(0.8 * look.sharp)}" transform="rotate(-24 30 47)"/>`
      : '') +
    `</g>` +
    // 7. Детали поверх корпуса, лицо и аксессуар сезона.
    front +
    face +
    crown +
    `</svg>`
  );
}
