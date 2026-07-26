/**
 * Силуэты фигурок: шесть линеек по восемь персонажей.
 *
 * ── Почему у каждого сезона свой набор, а не перекраска одного ─────────────
 * Раньше все шесть серий стояли на одних и тех же восьми силуэтах — котик,
 * мишка, зайка и так далее, — и отличались только палитрой. Из-за этого
 * открывать бокс новой серии было незачем: игрок уже видел всё, что в нём
 * лежит, просто в другом цвете. Коллекция из 72 позиций работала как одна
 * линейка, размноженная шесть раз.
 *
 * Теперь сезон — это отдельная линейка со своими персонажами: аркада, плюш,
 * механика, лето, космос, десерты. 48 разных фигурок вместо восьми. Именно это
 * и есть содержимое блайнд-бокса: не «тот же котик в бирюзовом», а вещь,
 * которой у игрока ещё не было.
 *
 * ── Единственное жёсткое ограничение ──────────────────────────────────────
 * Внутри сезона восемь силуэтов обязаны различаться С ОДНОГО ВЗГЛЯДА и в
 * оттенках серого: вид на поле кодируется формой, а не только цветом, иначе
 * игра недоступна при дальтонизме (около 8% мужчин). Поэтому в каждой линейке
 * силуэты разведены по типу контура: круглый, вытянутый, с ушами, с дыркой,
 * лучевой, с хвостом, широкий, угловатый. Проверяется скриптом
 * store/preview-figurines.ts --grayscale.
 *
 * Геометрия задаётся в системе 100×120: x от 0 до 100, «пол» на y = 118.
 * Фигурка стоит на полу, а не висит, поэтому нижняя точка контура должна
 * доходить до 112–118 у всех видов.
 */

import type { Colorway } from './color';
import { mix } from './color';

// --- Построители контуров ---------------------------------------------------

/** Короткая запись числа — SVG-строки уходят в бандл, лишние знаки ни к чему. */
export function f(n: number): string {
  return (Math.round(n * 10) / 10).toString();
}

/** Прямоугольник со скруглением. */
function rr(x: number, y: number, w: number, h: number, r: number): string {
  const k = Math.min(r, w / 2, h / 2);
  return (
    `M ${f(x + k)} ${f(y)} H ${f(x + w - k)} A ${f(k)} ${f(k)} 0 0 1 ${f(x + w)} ${f(y + k)} ` +
    `V ${f(y + h - k)} A ${f(k)} ${f(k)} 0 0 1 ${f(x + w - k)} ${f(y + h)} ` +
    `H ${f(x + k)} A ${f(k)} ${f(k)} 0 0 1 ${f(x)} ${f(y + h - k)} ` +
    `V ${f(y + k)} A ${f(k)} ${f(k)} 0 0 1 ${f(x + k)} ${f(y)} Z`
  );
}

/** Эллипс контуром. `sweep = 0` разворачивает обход — нужно для отверстий. */
function ell(cx: number, cy: number, rx: number, ry: number, sweep = 1): string {
  return (
    `M ${f(cx - rx)} ${f(cy)} A ${f(rx)} ${f(ry)} 0 1 ${sweep} ${f(cx + rx)} ${f(cy)} ` +
    `A ${f(rx)} ${f(ry)} 0 1 ${sweep} ${f(cx - rx)} ${f(cy)} Z`
  );
}

function circ(cx: number, cy: number, r: number, sweep = 1): string {
  return ell(cx, cy, r, r, sweep);
}

function poly(pts: ReadonlyArray<readonly [number, number]>): string {
  return `M ${pts.map(([x, y]) => `${f(x)} ${f(y)}`).join(' L ')} Z`;
}

/** Звезда со скруглёнными лучами: строится расчётом, а не подбором координат. */
function starPath(
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
    const a = (Math.PI * i) / points - Math.PI / 2;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
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

/** Шестерня: зубцы чередуются по внешнему и внутреннему радиусу. */
function gearPath(cx: number, cy: number, ro: number, ri: number, teeth: number): string {
  const half = Math.PI / teeth;
  const pts: Array<[number, number]> = [];
  const at = (a: number, r: number): [number, number] => [
    cx + Math.cos(a) * r,
    cy + Math.sin(a) * r,
  ];
  for (let i = 0; i < teeth; i++) {
    const a = i * 2 * half - Math.PI / 2;
    pts.push(at(a - half * 0.66, ri));
    pts.push(at(a - half * 0.34, ro));
    pts.push(at(a + half * 0.34, ro));
    pts.push(at(a + half * 0.66, ri));
  }
  return poly(pts);
}

/** Отражение по вертикальной оси x = 50 — для парных ушей, крыльев, плавников. */
function mirror(inner: string): string {
  return `<g transform="translate(100,0) scale(-1,1)">${inner}</g>`;
}

/**
 * Деталь со скруглёнными углами: заливка плюс обводка того же цвета.
 * Без неё уши, плавники и шипы упираются в острые стыки, и фигурка выглядит
 * вырезанной ножницами, а не отлитой из винила.
 */
function soft(d: string, fill: string, w = 4, extra = ''): string {
  return (
    `<path d="${d}" fill="${fill}" stroke="${fill}" stroke-width="${f(w)}" ` +
    `stroke-linejoin="round" stroke-linecap="round"${extra ? ` ${extra}` : ''}/>`
  );
}

// --- Описание силуэта -------------------------------------------------------

export type EyeStyle = 'round' | 'almond' | 'sparkle' | 'glow' | 'ring' | 'happy';
export type MouthStyle = 'smile' | 'grin' | 'line' | 'stitch' | 'none';

export interface ShapeDef {
  /** Русское имя для экрана коллекции. */
  name: string;
  /** Контур корпуса. Может быть составным — например, кольцо пончика. */
  body: string;
  /** Заливка по чётности: нужна фигурам с отверстием. */
  evenodd?: boolean;
  /**
   * Утолщение контура корпуса обводкой того же градиента. Скругляет острые
   * углы у молнии, кристалла и звезды — там, где геометрия задана полигоном.
   */
  soften?: number;
  /** Элементы за корпусом: уши, крылья, кольцо планеты, хвост кометы. */
  behind?: (c: Colorway) => string;
  /** Элементы поверх корпуса: морда, визор, ребро жёсткости. */
  front?: (c: Colorway) => string;
  /**
   * То же, но обрезанное по силуэту. Нужно там, где отделка обязана
   * оборваться ровно на кромке: глазурь пончика не должна закрыть отверстие.
   */
  inner?: (c: Colorway) => string;
  /** Центр лица, раствор глаз и масштаб. `x` по умолчанию 50. */
  face: { x?: number; y: number; gap: number; size?: number; mouthY?: number };
  eyes?: EyeStyle;
  mouth?: MouthStyle;
  blush?: boolean;
}

// ─── Сезон 1 · АРКАДА ──────────────────────────────────────────────────────
// Кибер-мелочь с лицами: техника, символы, гранёное стекло. Силуэты нарочно
// геометричные — линейка должна читаться как «не игрушки, а вещи».

const ARCADE: Record<string, ShapeDef> = {
  bot: {
    name: 'Робот',
    body: rr(22, 32, 56, 82, 18),
    behind: (c) =>
      `<path d="M 50 34 L 50 14" stroke="${c.dark}" stroke-width="4.5" ` +
      `stroke-linecap="round"/><circle cx="50" cy="9" r="7" fill="${c.rim}"/>` +
      `<circle cx="48" cy="7" r="2.4" fill="#ffffff" opacity=".85"/>` +
      soft(rr(12, 60, 10, 24, 5), c.dark, 2) +
      mirror(soft(rr(12, 60, 10, 24, 5), c.dark, 2)),
    front: (c) =>
      `<path d="${rr(29, 52, 42, 26, 12)}" fill="${c.ink}" opacity=".82"/>` +
      `<path d="${rr(29, 52, 42, 8, 8)}" fill="#ffffff" opacity=".12"/>` +
      // Решётка динамика вместо рта: у робота он не рисуется дугой.
      [0, 1, 2]
        .map((i) => `<rect x="${40 + i * 7}" y="90" width="4" height="10" rx="2" fill="${c.dark}" opacity=".7"/>`)
        .join(''),
    face: { y: 65, gap: 11, size: 0.95 },
    eyes: 'glow',
    mouth: 'none',
  },

  tape: {
    name: 'Кассета',
    body: rr(6, 36, 88, 68, 12),
    front: (c) =>
      `<path d="${rr(14, 44, 72, 26, 8)}" fill="${c.light}" opacity=".6"/>` +
      // Катушки — они же «щёки» кассеты.
      `<circle cx="32" cy="86" r="12" fill="${c.ink}" opacity=".55"/>` +
      `<circle cx="32" cy="86" r="5" fill="${c.light}"/>` +
      `<circle cx="68" cy="86" r="12" fill="${c.ink}" opacity=".55"/>` +
      `<circle cx="68" cy="86" r="5" fill="${c.light}"/>` +
      `<circle cx="12" cy="42" r="2" fill="${c.dark}" opacity=".6"/>` +
      `<circle cx="88" cy="42" r="2" fill="${c.dark}" opacity=".6"/>`,
    face: { y: 56, gap: 13, size: 0.82, mouthY: 66 },
    blush: true,
  },

  bolt: {
    name: 'Молния',
    body: poly([
      [66, 6],
      [22, 62],
      [46, 62],
      [34, 116],
      [80, 52],
      [54, 52],
    ]),
    soften: 13,
    face: { x: 45, y: 44, gap: 9, size: 0.8, mouthY: 56 },
    eyes: 'sparkle',
  },

  heart: {
    name: 'Сердце',
    body:
      'M 50 114 C 14 88, 6 58, 22 42 C 34 30, 48 34, 50 48 ' +
      'C 52 34, 66 30, 78 42 C 94 58, 86 88, 50 114 Z',
    face: { y: 66, gap: 14 },
    eyes: 'sparkle',
    blush: true,
  },

  disc: {
    name: 'Диско',
    body: circ(50, 72, 42),
    behind: (c) =>
      `<path d="M 50 32 L 50 12" stroke="${c.dark}" stroke-width="3.5" ` +
      `stroke-linecap="round"/>` +
      `<circle cx="50" cy="9" r="5.5" fill="none" stroke="${c.dark}" stroke-width="3"/>`,
    front: (c) => {
      const line = (d: string) =>
        `<path d="${d}" fill="none" stroke="${c.light}" stroke-width="1.3" opacity=".5"/>`;
      return (
        [46, 62, 78, 94]
          .map((y) => line(`M ${f(50 - Math.sqrt(Math.max(0, 42 * 42 - (y - 72) ** 2)))} ${y} ` +
            `H ${f(50 + Math.sqrt(Math.max(0, 42 * 42 - (y - 72) ** 2)))}`))
          .join('') +
        [-24, 0, 24]
          .map((dx) => line(`M ${f(50 + dx)} ${f(72 - Math.sqrt(Math.max(0, 42 * 42 - dx * dx)))} ` +
            `Q ${f(50 + dx * 1.25)} 72 ${f(50 + dx)} ${f(72 + Math.sqrt(Math.max(0, 42 * 42 - dx * dx)))}`))
          .join('')
      );
    },
    face: { y: 68, gap: 13 },
    eyes: 'sparkle',
    blush: true,
  },

  rocket: {
    name: 'Ракета',
    // Нос притуплён, корпус шире, стабилизаторы вынесены далеко за борт: с
    // острым носом и прижатыми плавниками силуэт читался как лист, а не как
    // ракета.
    body:
      'M 50 12 C 64 26, 73 50, 73 76 L 73 98 C 73 110, 63 117, 50 117 ' +
      'C 37 117, 27 110, 27 98 L 27 76 C 27 50, 36 26, 50 12 Z',
    behind: (c) => {
      const fin = soft('M 28 74 C 16 86, 8 102, 5 116 L 28 110 Z', c.dark, 5);
      const nozzle = `<path d="${rr(38, 112, 24, 10, 4)}" fill="${c.dark}"/>`;
      return fin + mirror(fin) + nozzle;
    },
    front: (c) =>
      // Поясок между носовым обтекателем и корпусом — он и делает ракету
      // ракетой, а не вытянутой каплей.
      `<path d="M 30 54 Q 50 48 70 54" fill="none" stroke="${c.dark}" stroke-width="3" ` +
      `opacity=".4" stroke-linecap="round"/>` +
      `<circle cx="50" cy="76" r="19" fill="${c.light}" opacity=".5"/>` +
      `<circle cx="50" cy="76" r="19" fill="none" stroke="${c.dark}" stroke-width="2" ` +
      `opacity=".45"/>` +
      `<path d="M 34 102 H 66" stroke="${c.dark}" stroke-width="3" opacity=".35" ` +
      `stroke-linecap="round"/>`,
    face: { y: 74, gap: 10, size: 0.85, mouthY: 86 },
  },

  glitch: {
    name: 'Глитч',
    // Низ рассыпается тремя крупными ступенями. Шесть мелких превращали
    // силуэт в бахрому, и на 40 пикселях он читался как медуза.
    body:
      'M 50 18 C 74 18, 89 40, 89 66 L 89 90 L 74 90 L 74 108 L 60 108 ' +
      'L 60 90 L 56 90 L 56 114 L 44 114 L 44 90 L 40 90 L 40 108 ' +
      'L 26 108 L 26 90 L 11 90 L 11 66 C 11 40, 26 18, 50 18 Z',
    front: (c) =>
      // Сбитая развёртка: две смещённые полосы поперёк корпуса.
      `<rect x="8" y="44" width="34" height="6" fill="${c.rim}" opacity=".5"/>` +
      `<rect x="52" y="78" width="40" height="5" fill="${c.rim}" opacity=".32"/>`,
    face: { y: 60, gap: 15, size: 1.05, mouthY: 76 },
    eyes: 'glow',
  },

  gem: {
    name: 'Кристалл',
    body: poly([
      [50, 8],
      [84, 38],
      [72, 108],
      [28, 108],
      [16, 38],
    ]),
    soften: 9,
    front: (c) => {
      const line = (d: string, o: number) =>
        `<path d="${d}" fill="none" stroke="${c.light}" stroke-width="1.6" opacity="${o}"/>`;
      return (
        line('M 16 38 L 50 50 L 84 38', 0.55) +
        line('M 50 50 L 50 108', 0.3) +
        line('M 28 108 L 50 50 L 72 108', 0.22)
      );
    },
    face: { y: 76, gap: 13, size: 0.92 },
    eyes: 'sparkle',
    blush: true,
  },
};

// ─── Сезон 2 · ПЛЮШ ────────────────────────────────────────────────────────
// Мягкие зверята. Именно здесь живут котик и мишка: в линейке про плюш они на
// месте, а в остальных пяти были случайными гостями.

/** Общее «яйцо»: широкий низ, покатый верх. Основа плюшевых зверят. */
const EGG =
  'M 50 28 C 78 28, 94 51, 94 78 C 94 104, 76 118, 50 118 ' +
  'C 24 118, 6 104, 6 78 C 6 51, 22 28, 50 28 Z';

const PLUSH: Record<string, ShapeDef> = {
  bear: {
    name: 'Мишка',
    body: EGG,
    behind: (c) => {
      const ear = `<circle cx="20" cy="40" r="17" fill="${c.base}"/>`;
      return ear + mirror(ear);
    },
    front: (c) => {
      const inner = `<circle cx="20" cy="42" r="9" fill="${c.light}" opacity=".7"/>`;
      return (
        inner +
        mirror(inner) +
        `<ellipse cx="50" cy="96" rx="22" ry="15" fill="${c.light}" opacity=".55"/>` +
        `<ellipse cx="50" cy="88" rx="5.5" ry="4" fill="${c.ink}" opacity=".85"/>`
      );
    },
    face: { y: 74, gap: 15, mouthY: 92 },
    blush: true,
  },

  bunny: {
    name: 'Зайка',
    body: EGG,
    behind: (c) => {
      const ear = soft('M 33 52 C 21 24, 25 2, 36 2 C 47 2, 44 28, 42 54 Z', c.base, 3);
      return ear + mirror(ear);
    },
    front: (c) => {
      const inner =
        `<path d="M 35 47 C 28 26, 30 10, 36 10 C 42 10, 40 29, 39 48 Z" ` +
        `fill="${c.light}" opacity=".7"/>`;
      return inner + mirror(inner);
    },
    face: { y: 78, gap: 14 },
    blush: true,
  },

  cat: {
    name: 'Котик',
    body: EGG,
    behind: (c) => {
      // Уши с обводкой того же цвета: без неё острые вершины выглядели
      // обрубленными и портили весь силуэт.
      const ear = soft(poly([[16, 56], [10, 10], [48, 34]]), c.base, 7);
      return ear + mirror(ear);
    },
    front: (c) => {
      const inner = `<path d="${poly([[22, 47], [19, 22], [39, 36]])}" fill="${c.light}" ` +
        `opacity=".7" stroke="${c.light}" stroke-width="3" stroke-linejoin="round"/>`;
      return (
        inner +
        mirror(inner) +
        `<path d="M 44 84 Q 50 89 56 84" stroke="${c.ink}" stroke-width="2" fill="none" ` +
        `opacity=".55" stroke-linecap="round"/>`
      );
    },
    face: { y: 76, gap: 15, mouthY: 93 },
    blush: true,
  },

  duck: {
    name: 'Утёнок',
    body: EGG,
    behind: (c) =>
      // Хохолок из трёх пёрышек.
      soft('M 44 30 C 40 14, 48 6, 54 4 C 50 14, 56 22, 58 30 Z', c.base, 3) +
      soft('M 52 30 C 54 16, 64 10, 70 10 C 62 18, 64 24, 64 32 Z', c.base, 3),
    front: (c) => {
      const beak = mix(c.light, '#ffb02e', 0.7);
      return (
        `<path d="M 32 86 Q 50 78 68 86 Q 50 104 32 86 Z" fill="${beak}" ` +
        `stroke="${mix(beak, '#8a4a00', 0.35)}" stroke-width="1.4" stroke-linejoin="round"/>` +
        `<path d="M 36 88 Q 50 92 64 88" stroke="${mix(beak, '#8a4a00', 0.45)}" ` +
        `stroke-width="1.3" fill="none" opacity=".7"/>`
      );
    },
    face: { y: 68, gap: 14 },
    mouth: 'none',
    blush: true,
  },

  frog: {
    name: 'Лягушка',
    body:
      'M 50 42 C 80 42, 96 63, 96 85 C 96 106, 76 118, 50 118 ' +
      'C 24 118, 4 106, 4 85 C 4 63, 20 42, 50 42 Z',
    behind: (c) => {
      const bump = `<circle cx="27" cy="42" r="16" fill="${c.base}"/>`;
      return bump + mirror(bump);
    },
    face: { y: 42, gap: 23, size: 1.05, mouthY: 88 },
    mouth: 'grin',
    blush: true,
  },

  sheep: {
    name: 'Барашек',
    body: EGG,
    behind: (c) => {
      // Шерсть — венок из кругов по верхней дуге. Дешевле и надёжнее, чем
      // рисовать облачный контур руками: он у каждого размера кривит по-своему.
      const wool = [
        [18, 56, 15],
        [28, 30, 15],
        [50, 20, 16],
        [72, 30, 15],
        [82, 56, 15],
      ]
        .map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${c.base}"/>`)
        .join('');
      const ear = `<ellipse cx="12" cy="72" rx="10" ry="6" fill="${c.dark}" ` +
        `transform="rotate(-18 12 72)"/>`;
      return wool + ear + mirror(ear);
    },
    front: (c) =>
      `<ellipse cx="50" cy="82" rx="30" ry="26" fill="${c.light}" opacity=".45"/>` +
      [
        [26, 34, 9],
        [42, 24, 9],
        [62, 26, 9],
        [76, 40, 9],
      ]
        .map(
          ([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${c.light}" opacity=".35"/>`
        )
        .join(''),
    face: { y: 80, gap: 14, mouthY: 96 },
    blush: true,
  },

  pig: {
    name: 'Пятачок',
    body: EGG,
    behind: (c) => {
      const ear = soft('M 18 50 C 12 30, 22 24, 34 32 C 36 42, 30 50, 22 54 Z', c.base, 3);
      return ear + mirror(ear);
    },
    front: (c) => {
      const snout = mix(c.light, '#ffd0dc', 0.5);
      return (
        `<ellipse cx="50" cy="92" rx="17" ry="13" fill="${snout}" ` +
        `stroke="${c.dark}" stroke-width="1.4" opacity=".95"/>` +
        `<ellipse cx="43" cy="92" rx="3" ry="4.5" fill="${c.ink}" opacity=".7"/>` +
        `<ellipse cx="57" cy="92" rx="3" ry="4.5" fill="${c.ink}" opacity=".7"/>`
      );
    },
    face: { y: 70, gap: 15 },
    mouth: 'none',
    blush: true,
  },

  owl: {
    name: 'Совёнок',
    body:
      'M 50 26 C 76 26, 90 48, 90 76 C 90 103, 74 118, 50 118 ' +
      'C 26 118, 10 103, 10 76 C 10 48, 24 26, 50 26 Z',
    behind: (c) => {
      const tuft = soft(poly([[16, 44], [14, 12], [40, 32]]), c.base, 6);
      return tuft + mirror(tuft);
    },
    front: (c) => {
      const disc = `<circle cx="34" cy="68" r="18" fill="${c.light}" opacity=".55"/>`;
      const wing = `<path d="M 12 74 C 6 90, 12 106, 24 112 C 20 96, 20 84, 22 74 Z" ` +
        `fill="${c.dark}" opacity=".45"/>`;
      const beak = mix(c.light, '#ffb02e', 0.65);
      return (
        disc +
        mirror(disc) +
        wing +
        mirror(wing) +
        `<path d="M 50 74 L 56 84 L 44 84 Z" fill="${beak}" stroke="${beak}" ` +
        `stroke-width="2.4" stroke-linejoin="round"/>`
      );
    },
    face: { y: 68, gap: 16, size: 1.15 },
    mouth: 'none',
  },
};

// ─── Сезон 3 · МЕХАНИКА ────────────────────────────────────────────────────
// Железо с характером. Материал сезона — зеркальный металл, поэтому силуэты
// собраны из простых объёмов, на которых блик читается честно.

const MECH: Record<string, ShapeDef> = {
  mech: {
    name: 'Меха',
    body:
      'M 26 30 L 74 30 C 82 30, 87 36, 86 44 L 82 96 C 81 108, 72 117, 60 117 ' +
      'L 40 117 C 28 117, 19 108, 18 96 L 14 44 C 13 36, 18 30, 26 30 Z',
    behind: (c) => {
      const horn = soft(poly([[20, 34], [2, 8], [34, 26]]), c.dark, 5);
      return horn + mirror(horn);
    },
    front: (c) =>
      `<path d="${rr(24, 52, 52, 24, 11)}" fill="${c.ink}" opacity=".82"/>` +
      `<path d="M 34 96 H 66" stroke="${c.dark}" stroke-width="3.4" opacity=".55" ` +
      `stroke-linecap="round"/>` +
      `<path d="M 40 88 H 60" stroke="${c.light}" stroke-width="2" opacity=".3" ` +
      `stroke-linecap="round"/>`,
    face: { y: 64, gap: 12, size: 0.92 },
    eyes: 'glow',
    mouth: 'none',
  },

  cog: {
    name: 'Шестерня',
    body: gearPath(50, 70, 46, 35, 9),
    soften: 7,
    front: (c) =>
      `<circle cx="50" cy="70" r="24" fill="${c.dark}" opacity=".35"/>` +
      `<circle cx="50" cy="70" r="24" fill="none" stroke="${c.light}" stroke-width="1.8" ` +
      `opacity=".45"/>`,
    face: { y: 68, gap: 12, size: 0.88 },
    blush: true,
  },

  bulb: {
    name: 'Лампа',
    body:
      'M 50 8 C 72 8, 89 26, 89 48 C 89 64, 79 74, 73 86 L 27 86 ' +
      'C 21 74, 11 64, 11 48 C 11 26, 28 8, 50 8 Z',
    behind: (c) =>
      `<path d="${rr(33, 84, 34, 32, 7)}" fill="${c.dark}"/>` +
      [92, 100, 108]
        .map((y) => `<rect x="31" y="${y}" width="38" height="3.4" rx="1.7" fill="${c.light}" opacity=".35"/>`)
        .join(''),
    front: (c) =>
      `<path d="M 38 74 Q 50 66 62 74" fill="none" stroke="${c.rim}" stroke-width="2.6" ` +
      `opacity=".7" stroke-linecap="round"/>`,
    face: { y: 46, gap: 13 },
    eyes: 'sparkle',
    blush: true,
  },

  capsule: {
    name: 'Капсула',
    body: rr(24, 12, 52, 106, 26),
    front: (c) =>
      `<path d="M 25 66 H 75" stroke="${c.dark}" stroke-width="3" opacity=".5"/>` +
      `<path d="${rr(24, 66, 52, 52, 26)}" fill="${c.dark}" opacity=".22"/>`,
    face: { y: 46, gap: 13 },
    blush: true,
  },

  drone: {
    name: 'Дрон',
    body: rr(30, 48, 40, 62, 17),
    behind: (c) => {
      const arm =
        `<path d="M 34 60 L 14 46" stroke="${c.dark}" stroke-width="6" ` +
        `stroke-linecap="round"/>` +
        `<ellipse cx="14" cy="42" rx="17" ry="5" fill="${c.light}" opacity=".65"/>` +
        `<circle cx="14" cy="42" r="4" fill="${c.dark}"/>`;
      return arm + mirror(arm);
    },
    front: (c) =>
      `<circle cx="50" cy="98" r="7" fill="${c.rim}" opacity=".8"/>` +
      `<circle cx="50" cy="98" r="7" fill="none" stroke="${c.dark}" stroke-width="1.4"/>`,
    face: { y: 70, gap: 11, size: 0.85, mouthY: 82 },
    eyes: 'glow',
  },

  nut: {
    name: 'Гайка',
    body: poly([
      [50, 12],
      [92, 40],
      [92, 96],
      [50, 118],
      [8, 96],
      [8, 40],
    ]),
    soften: 10,
    front: (c) =>
      `<circle cx="50" cy="66" r="30" fill="${c.dark}" opacity=".3"/>` +
      `<circle cx="50" cy="66" r="30" fill="none" stroke="${c.light}" stroke-width="1.6" ` +
      `opacity=".4"/>`,
    face: { y: 66, gap: 13, size: 0.9 },
    blush: true,
  },

  magnet: {
    name: 'Магнит',
    body:
      'M 12 116 L 12 62 A 38 38 0 0 1 88 62 L 88 116 L 62 116 L 62 62 ' +
      'A 12 12 0 0 0 38 62 L 38 116 Z',
    soften: 4,
    front: (c) => {
      const tip = (x: number, color: string) =>
        `<path d="${rr(x, 96, 26, 20, 4)}" fill="${color}" opacity=".85"/>`;
      return tip(12, mix(c.dark, '#e8244c', 0.7)) + tip(62, mix(c.light, '#eef2f6', 0.6));
    },
    // Лицо садится на дугу подковы, а не под неё: ниже y = 50 начинается
    // вырез, и рот там просто проваливался в пустоту.
    face: { y: 36, gap: 11, size: 0.8, mouthY: 47 },
    blush: true,
  },

  battery: {
    name: 'Батарейка',
    body: rr(22, 24, 56, 92, 12),
    behind: (c) => `<path d="${rr(41, 12, 18, 16, 5)}" fill="${c.dark}"/>`,
    front: (c) =>
      `<path d="${rr(28, 88, 44, 20, 6)}" fill="${c.dark}" opacity=".35"/>` +
      `<path d="M 54 88 L 42 100 L 50 100 L 46 110 L 58 96 L 50 96 Z" fill="${c.rim}" ` +
      `opacity=".85" stroke="${c.rim}" stroke-width="2" stroke-linejoin="round"/>`,
    face: { y: 58, gap: 13 },
    blush: true,
  },
};

// ─── Сезон 4 · ЛЕТО ────────────────────────────────────────────────────────
// Фрукты и пляж. Самая «сочная» линейка: материал мокрый глянец, силуэты
// округлые, но с характерными хвостиками и листьями.

const SUMMER: Record<string, ShapeDef> = {
  lemon: {
    name: 'Лимон',
    body:
      'M 50 20 C 76 20, 93 44, 93 70 C 93 98, 74 117, 50 117 ' +
      'C 26 117, 7 98, 7 70 C 7 44, 24 20, 50 20 Z',
    behind: (c) =>
      `<ellipse cx="50" cy="16" rx="7" ry="9" fill="${c.dark}"/>` +
      `<ellipse cx="50" cy="120" rx="7" ry="6" fill="${c.dark}" opacity=".7"/>`,
    front: (c) =>
      `<ellipse cx="34" cy="52" rx="13" ry="9" fill="${c.light}" opacity=".35" ` +
      `transform="rotate(-24 34 52)"/>`,
    face: { y: 74, gap: 15 },
    blush: true,
  },

  melon: {
    name: 'Арбуз',
    body: 'M 6 108 A 44 44 0 0 1 94 108 Z',
    soften: 4,
    front: (c) => {
      const rind = mix(c.dark, '#2f9d3c', 0.75);
      return (
        `<path d="M 6 108 H 94" stroke="${rind}" stroke-width="9" stroke-linecap="round"/>` +
        `<path d="M 12 102 H 88" stroke="${mix(rind, '#ffffff', 0.5)}" stroke-width="3" ` +
        `opacity=".6" stroke-linecap="round"/>` +
        [
          [30, 88],
          [50, 92],
          [70, 88],
          [40, 74],
          [60, 74],
        ]
          .map(
            ([x, y]) =>
              `<ellipse cx="${x}" cy="${y}" rx="3" ry="4.4" fill="${c.ink}" opacity=".65"/>`
          )
          .join('')
      );
    },
    face: { y: 62, gap: 14, mouthY: 76 },
    blush: true,
  },

  cherry: {
    name: 'Вишня',
    body: `${circ(60, 84, 31)} ${circ(22, 92, 22)}`,
    behind: (c) => {
      const stem = mix(c.dark, '#3f8a2c', 0.7);
      return (
        `<path d="M 60 56 C 58 34, 62 20, 74 10" stroke="${stem}" stroke-width="4" ` +
        `fill="none" stroke-linecap="round"/>` +
        `<path d="M 24 72 C 26 48, 44 24, 74 12" stroke="${stem}" stroke-width="3.4" ` +
        `fill="none" stroke-linecap="round"/>` +
        `<path d="M 72 12 C 82 2, 94 6, 92 16 C 90 24, 78 24, 72 12 Z" ` +
        `fill="${mix(c.light, '#6fc84a', 0.7)}" stroke="${stem}" stroke-width="1.6"/>`
      );
    },
    face: { x: 60, y: 82, gap: 13 },
    blush: true,
  },

  pine: {
    name: 'Ананас',
    body:
      'M 50 34 C 74 34, 88 56, 88 80 C 88 104, 72 118, 50 118 ' +
      'C 28 118, 12 104, 12 80 C 12 56, 26 34, 50 34 Z',
    behind: (c) => {
      const leaf = mix(c.light, '#5cb83a', 0.72);
      const dark = mix(c.dark, '#256b1c', 0.7);
      return [
        'M 50 40 C 44 20, 40 10, 30 2 C 34 18, 36 30, 42 42 Z',
        'M 50 40 C 48 18, 50 8, 50 0 C 56 14, 56 28, 56 40 Z',
        'M 50 40 C 58 22, 66 12, 76 6 C 70 20, 64 30, 58 42 Z',
      ]
        .map((d) => soft(d, leaf, 2.6, `stroke="${dark}" stroke-width="1.6"`))
        .join('');
    },
    front: (c) => {
      const line = (d: string) =>
        `<path d="${d}" fill="none" stroke="${c.dark}" stroke-width="1.4" opacity=".35"/>`;
      return (
        [-30, -10, 10, 30]
          .map((dx) => line(`M ${f(50 + dx - 18)} 44 L ${f(50 + dx + 18)} 112`))
          .join('') +
        [-30, -10, 10, 30]
          .map((dx) => line(`M ${f(50 + dx + 18)} 44 L ${f(50 + dx - 18)} 112`))
          .join('')
      );
    },
    face: { y: 82, gap: 14 },
    blush: true,
  },

  berry: {
    name: 'Клубника',
    body:
      'M 50 118 C 20 100, 8 76, 8 56 C 8 36, 26 24, 50 24 ' +
      'C 74 24, 92 36, 92 56 C 92 76, 80 100, 50 118 Z',
    behind: (c) => {
      const leaf = mix(c.light, '#4fb02f', 0.75);
      const dark = mix(c.dark, '#1f6b14', 0.7);
      return (
        soft(
          'M 50 34 L 28 20 L 34 34 L 14 34 L 32 46 L 22 56 L 50 48 L 78 56 L 68 46 ' +
            'L 86 34 L 66 34 L 72 20 Z',
          leaf,
          3,
          `stroke="${dark}" stroke-width="1.6"`
        ) +
        `<path d="M 50 30 C 50 18, 52 10, 56 4" stroke="${dark}" stroke-width="3.4" ` +
        `fill="none" stroke-linecap="round"/>`
      );
    },
    front: (c) =>
      [
        [32, 58],
        [50, 66],
        [68, 58],
        [40, 82],
        [60, 82],
        [50, 98],
      ]
        .map(
          ([x, y]) =>
            `<ellipse cx="${x}" cy="${y}" rx="2.6" ry="3.6" fill="${c.light}" opacity=".7"/>`
        )
        .join(''),
    face: { y: 62, gap: 14, mouthY: 78 },
    blush: true,
  },

  cactus: {
    name: 'Кактус',
    body: rr(34, 28, 32, 90, 16),
    behind: (c) => {
      // Руки нарисованы толстой обводкой по ломаной, а не контуром: контур
      // из дуг на этой форме постоянно расходился в стыках, и кактус выглядел
      // собранным из обрезков трубы. Тёмная копия со сдвигом даёт объём.
      const arm = (d: string, w: number) =>
        `<path d="${d}" fill="none" stroke="${c.dark}" stroke-width="${f(w)}" ` +
        `stroke-linecap="round" stroke-linejoin="round" transform="translate(2.5,2.5)"/>` +
        `<path d="${d}" fill="none" stroke="${c.base}" stroke-width="${f(w)}" ` +
        `stroke-linecap="round" stroke-linejoin="round"/>`;
      return (
        arm('M 42 72 L 20 72 L 20 44', 21) +
        arm('M 58 92 L 80 92 L 80 68', 19) +
        `<circle cx="50" cy="22" r="10" fill="${mix(c.light, '#ff7fb0', 0.72)}"/>` +
        `<circle cx="50" cy="22" r="4" fill="${mix(c.dark, '#c43a72', 0.6)}"/>`
      );
    },
    front: (c) =>
      [42, 58]
        .map(
          (x) =>
            `<path d="M ${x} 44 L ${x} 108" stroke="${c.dark}" stroke-width="1.6" ` +
            `opacity=".3" stroke-linecap="round"/>`
        )
        .join(''),
    face: { y: 62, gap: 10, size: 0.82, mouthY: 76 },
    blush: true,
  },

  shell: {
    name: 'Ракушка',
    body: 'M 50 116 L 8 56 A 46 48 0 0 1 92 56 Z',
    soften: 8,
    front: (c) =>
      [-32, -16, 0, 16, 32]
        .map(
          (dx) =>
            `<path d="M 50 112 L ${f(50 + dx * 1.35)} ${f(52 - Math.abs(dx) * 0.28)}" ` +
            `stroke="${c.dark}" stroke-width="1.8" opacity=".28" stroke-linecap="round"/>`
        )
        .join(''),
    face: { y: 76, gap: 13 },
    blush: true,
  },

  pear: {
    name: 'Груша',
    body:
      'M 50 14 C 60 14, 65 26, 62 40 C 79 49, 89 67, 89 85 ' +
      'C 89 105, 72 118, 50 118 C 28 118, 11 105, 11 85 ' +
      'C 11 67, 21 49, 38 40 C 35 26, 40 14, 50 14 Z',
    behind: (c) => {
      const leaf = mix(c.light, '#5cb83a', 0.7);
      return (
        `<path d="M 50 20 C 52 10, 56 4, 60 0" stroke="${mix(c.dark, '#4a3218', 0.7)}" ` +
        `stroke-width="3.4" fill="none" stroke-linecap="round"/>` +
        `<path d="M 56 12 C 68 2, 84 6, 82 16 C 80 26, 64 26, 56 12 Z" fill="${leaf}" ` +
        `stroke="${mix(c.dark, '#256b1c', 0.6)}" stroke-width="1.5"/>`
      );
    },
    face: { y: 84, gap: 14 },
    blush: true,
  },
};

// ─── Сезон 5 · КОСМОС ──────────────────────────────────────────────────────
// Тела и техника: у каждого силуэта свой «выступ» — кольцо, хвост, панели,
// купол, — по нему вид и опознаётся в стопке.

const SPACE: Record<string, ShapeDef> = {
  planet: {
    name: 'Планета',
    body: circ(50, 68, 38),
    behind: (c) =>
      `<g transform="rotate(-18 50 74)"><ellipse cx="50" cy="74" rx="56" ry="15" ` +
      `fill="none" stroke="${c.dark}" stroke-width="7"/></g>`,
    front: (c) =>
      `<g transform="rotate(-18 50 74)"><path d="M 6 74 A 56 15 0 0 0 94 74" ` +
      `fill="none" stroke="${c.rim}" stroke-width="7" opacity=".9"/></g>` +
      `<ellipse cx="34" cy="50" rx="10" ry="6" fill="${c.light}" opacity=".3" ` +
      `transform="rotate(-20 34 50)"/>`,
    face: { y: 62, gap: 13 },
    blush: true,
  },

  moon: {
    name: 'Луна',
    body:
      'M 74 6 C 32 14, 4 38, 4 68 C 4 98, 32 120, 76 122 ' +
      'C 46 104, 34 90, 34 66 C 34 42, 48 20, 74 6 Z',
    soften: 4,
    front: (c) =>
      [
        [16, 48, 5],
        [22, 84, 6.5],
        [12, 68, 3.4],
      ]
        .map(
          ([x, y, r]) =>
            `<circle cx="${x}" cy="${y}" r="${r}" fill="${c.dark}" opacity=".3"/>`
        )
        .join(''),
    face: { x: 19, y: 66, gap: 8, size: 0.74, mouthY: 80 },
    blush: true,
  },

  star: {
    name: 'Звезда',
    body: starPath(50, 68, 52, 25, 5, 8),
    face: { y: 70, gap: 13, size: 0.92 },
    eyes: 'sparkle',
    blush: true,
  },

  comet: {
    name: 'Комета',
    // Хвост крепится широкой хордой по низу головы и сходит на нет. Раньше он
    // отходил от одной точки и читался как ручка от ложки.
    body:
      `${circ(66, 46, 28)} ` +
      'M 44 62 C 28 84, 14 100, 2 118 C 30 108, 58 92, 80 66 Z',
    soften: 6,
    behind: (c) =>
      `<path d="M 40 74 C 30 88, 20 100, 10 114" stroke="${c.dark}" stroke-width="7" ` +
      `fill="none" opacity=".5" stroke-linecap="round"/>`,
    front: (c) =>
      `<path d="M 46 72 C 36 84, 26 96, 16 108" stroke="${c.rim}" stroke-width="3" ` +
      `fill="none" opacity=".6" stroke-linecap="round"/>` +
      `<path d="M 60 76 C 52 84, 44 92, 34 102" stroke="${c.rim}" stroke-width="2.2" ` +
      `fill="none" opacity=".35" stroke-linecap="round"/>`,
    face: { x: 66, y: 44, gap: 11, size: 0.88 },
    eyes: 'sparkle',
    blush: true,
  },

  ufo: {
    name: 'НЛО',
    body: `${ell(50, 92, 48, 16)} M 21 86 A 30 30 0 0 1 79 86 Z`,
    soften: 3,
    // Купол светлее корпуса и обведён по кромке. Одной геометрии мало: купол
    // и тарелка залиты одним градиентом и сливались в плоский овал.
    front: (c) =>
      `<path d="M 21 86 A 30 30 0 0 1 79 86 Z" fill="${c.light}" opacity=".45"/>` +
      `<path d="M 21 86 A 30 30 0 0 1 79 86" fill="none" stroke="${c.light}" ` +
      `stroke-width="2.6" opacity=".75"/>` +
      `<path d="M 30 72 A 30 30 0 0 1 48 60" fill="none" stroke="#ffffff" ` +
      `stroke-width="4" opacity=".3" stroke-linecap="round"/>` +
      `<ellipse cx="50" cy="92" rx="48" ry="16" fill="none" stroke="${c.dark}" ` +
      `stroke-width="2" opacity=".3"/>` +
      [16, 50, 84]
        .map(
          (x) =>
            `<circle cx="${x}" cy="${x === 50 ? 100 : 96}" r="4.6" fill="${c.rim}" ` +
            `opacity=".9"/>`
        )
        .join(''),
    face: { y: 72, gap: 12, size: 0.85, mouthY: 82 },
    blush: true,
  },

  sat: {
    name: 'Спутник',
    body: rr(36, 40, 28, 68, 10),
    behind: (c) => {
      const panel =
        `<path d="${rr(2, 54, 30, 34, 4)}" fill="${c.dark}"/>` +
        `<path d="${rr(5, 57, 24, 28, 2)}" fill="${c.rim}" opacity=".55"/>` +
        `<path d="M 5 71 H 29 M 17 57 V 85" stroke="${c.dark}" stroke-width="1.6" ` +
        `opacity=".7"/>`;
      return (
        panel +
        mirror(panel) +
        `<path d="M 50 42 L 50 18" stroke="${c.dark}" stroke-width="4" ` +
        `stroke-linecap="round"/>` +
        `<path d="M 38 14 A 12 12 0 0 1 62 14 Z" fill="${c.light}" opacity=".8"/>`
      );
    },
    front: (c) =>
      `<path d="M 40 98 H 60" stroke="${c.dark}" stroke-width="2.4" opacity=".4" ` +
      `stroke-linecap="round"/>`,
    face: { y: 66, gap: 9, size: 0.78, mouthY: 80 },
    eyes: 'glow',
  },

  nebula: {
    name: 'Туманность',
    body:
      'M 30 44 A 20 20 0 0 1 62 30 A 22 22 0 0 1 92 56 A 20 20 0 0 1 84 94 ' +
      'A 24 24 0 0 1 46 112 A 22 22 0 0 1 12 88 A 22 22 0 0 1 30 44 Z',
    soften: 4,
    front: () =>
      [
        [30, 56, 2.4],
        [70, 48, 3],
        [80, 82, 2.2],
        [26, 90, 2.6],
        [56, 100, 2],
      ]
        .map(
          ([x, y, r]) =>
            `<circle cx="${x}" cy="${y}" r="${r}" fill="#ffffff" opacity=".65"/>`
        )
        .join(''),
    face: { y: 70, gap: 15, size: 1.05 },
    eyes: 'sparkle',
    blush: true,
  },

  astro: {
    name: 'Астронавт',
    body:
      `${circ(50, 58, 40)} ` +
      'M 16 88 C 22 108, 34 118, 50 118 C 66 118, 78 108, 84 88 Z',
    soften: 3,
    behind: (c) =>
      `<path d="${rr(4, 62, 14, 30, 6)}" fill="${c.dark}"/>` +
      mirror(`<path d="${rr(4, 62, 14, 30, 6)}" fill="${c.dark}"/>`),
    front: (c) =>
      // Стекло шлема: тёмный овал, лицо светится внутри него.
      `<ellipse cx="50" cy="56" rx="30" ry="27" fill="${c.ink}" opacity=".78"/>` +
      `<path d="M 28 42 A 30 27 0 0 1 54 32" stroke="#ffffff" stroke-width="4" ` +
      `fill="none" opacity=".28" stroke-linecap="round"/>` +
      `<path d="M 30 100 H 70" stroke="${c.dark}" stroke-width="2.6" opacity=".4" ` +
      `stroke-linecap="round"/>`,
    face: { y: 58, gap: 12, size: 0.95, mouthY: 74 },
    eyes: 'glow',
    mouth: 'none',
  },
};

// ─── Сезон 6 · ДЕСЕРТ ──────────────────────────────────────────────────────
// Сладкое. Здесь важнее всего материал: глазурь, посыпка, вафля. Силуэты
// разведены по типу — кольцо, купол на обёртке, брусок, клин, цилиндр.

const SWEET: Record<string, ShapeDef> = {
  donut: {
    name: 'Пончик',
    // Кольцо: внешний контур по часовой, отверстие против — заливка evenodd.
    body: `${circ(50, 68, 44)} ${circ(50, 88, 17, 0)}`,
    evenodd: true,
    // Глазурь идёт ВНУТРЬ клипа: снаружи её потёки перекрыли бы отверстие, и
    // пончик перестал бы быть пончиком.
    inner: (c) => {
      const glaze = mix(c.light, '#ffffff', 0.5);
      return (
        `<path d="M 50 24 C 74 24, 94 44, 94 68 C 94 76, 92 82, 88 90 ` +
        `C 84 78, 78 80, 74 90 C 70 100, 62 96, 58 84 C 54 96, 46 96, 42 84 ` +
        `C 38 96, 30 100, 26 90 C 22 80, 16 78, 12 90 C 8 82, 6 76, 6 68 ` +
        `C 6 44, 26 24, 50 24 Z" fill="${glaze}" opacity=".92"/>` +
        [
          [26, 42, -30],
          [46, 34, 15],
          [68, 40, -12],
          [82, 58, 40],
          [30, 60, 30],
          [70, 74, -40],
        ]
          .map(
            ([x, y, rot]) =>
              `<rect x="${f(x - 3.4)}" y="${f(y - 1.3)}" width="6.8" height="2.6" rx="1.3" ` +
              `transform="rotate(${rot} ${x} ${y})" fill="${c.dark}" opacity=".75"/>`
          )
          .join('')
      );
    },
    face: { y: 46, gap: 15, mouthY: 58 },
    blush: true,
  },

  cup: {
    name: 'Кекс',
    body:
      'M 50 22 C 72 22, 86 38, 86 56 C 86 62, 84 66, 82 70 L 18 70 ' +
      'C 16 66, 14 62, 14 56 C 14 38, 28 22, 50 22 Z ' +
      'M 16 72 L 84 72 L 74 114 C 73 117, 70 118, 66 118 L 34 118 ' +
      'C 30 118, 27 117, 26 114 Z',
    soften: 3,
    behind: (c) =>
      `<circle cx="50" cy="16" r="8" fill="${mix(c.dark, '#e8244c', 0.8)}"/>` +
      `<path d="M 50 10 C 54 2, 62 0, 66 0" stroke="${mix(c.dark, '#3f7a2c', 0.7)}" ` +
      `stroke-width="2.6" fill="none" stroke-linecap="round"/>`,
    front: (c) =>
      [26, 38, 50, 62, 74]
        .map(
          (x) =>
            `<path d="M ${x} 74 L ${f(x + (x - 50) * 0.16)} 116" stroke="${c.dark}" ` +
            `stroke-width="2" opacity=".3" stroke-linecap="round"/>`
        )
        .join(''),
    face: { y: 48, gap: 14, mouthY: 60 },
    blush: true,
  },

  pop: {
    name: 'Эскимо',
    body: `${rr(22, 8, 56, 88, 20)} ${rr(42, 92, 16, 26, 6)}`,
    front: (c) => {
      const drip = mix(c.light, '#ffffff', 0.45);
      return (
        `<path d="M 22 34 L 22 24 C 22 15, 30 8, 42 8 L 58 8 C 70 8, 78 15, 78 24 ` +
        `L 78 40 C 72 34, 68 40, 64 46 C 60 52, 54 48, 50 42 C 46 50, 40 50, 36 42 ` +
        `C 32 48, 26 44, 22 34 Z" fill="${drip}" opacity=".88"/>` +
        [
          [34, 22],
          [54, 18],
          [66, 30],
        ]
          .map(
            ([x, y]) =>
              `<rect x="${f(x - 3)}" y="${f(y - 1.2)}" width="6" height="2.4" rx="1.2" ` +
              `transform="rotate(${x % 2 === 0 ? -24 : 30} ${x} ${y})" fill="${c.dark}" ` +
              `opacity=".7"/>`
          )
          .join('')
      );
    },
    face: { y: 66, gap: 13, mouthY: 80 },
    blush: true,
  },

  candy: {
    name: 'Карамель',
    body:
      `${ell(50, 68, 30, 34)} ` +
      'M 22 52 L 2 34 L 8 68 L 2 100 L 22 84 Z ' +
      'M 78 52 L 98 34 L 92 68 L 98 100 L 78 84 Z',
    soften: 5,
    front: (c) =>
      `<ellipse cx="50" cy="68" rx="30" ry="34" fill="none" stroke="${c.light}" ` +
      `stroke-width="2" opacity=".35"/>` +
      `<path d="M 36 44 C 44 60, 44 78, 36 94" stroke="${c.light}" stroke-width="3.4" ` +
      `fill="none" opacity=".4" stroke-linecap="round"/>`,
    face: { y: 66, gap: 12, size: 0.9 },
    eyes: 'sparkle',
    blush: true,
  },

  slice: {
    name: 'Тортик',
    body: 'M 50 14 L 92 108 C 93 114, 89 118, 82 118 L 18 118 C 11 118, 7 114, 8 108 Z',
    soften: 8,
    front: (c) => {
      const cream = mix(c.light, '#ffffff', 0.55);
      const jam = mix(c.dark, '#e8244c', 0.6);
      return (
        `<path d="M 25 54 L 75 54 L 81 74 L 19 74 Z" fill="${cream}" opacity=".85"/>` +
        `<path d="M 33 76 L 67 76 L 73 94 L 27 94 Z" fill="${jam}" opacity=".55"/>` +
        `<circle cx="50" cy="20" r="7" fill="${mix(c.dark, '#e8244c', 0.8)}"/>`
      );
    },
    face: { y: 40, gap: 11, size: 0.8, mouthY: 50 },
    blush: true,
  },

  marsh: {
    name: 'Зефир',
    body: rr(14, 40, 72, 78, 26),
    front: (c) =>
      `<path d="M 15 78 H 85" stroke="${c.dark}" stroke-width="2.4" opacity=".3"/>` +
      `<path d="${rr(14, 78, 72, 40, 26)}" fill="${mix(c.light, '#ffb0d0', 0.55)}" ` +
      `opacity=".55"/>`,
    face: { y: 62, gap: 14, mouthY: 74 },
    blush: true,
  },

  lolli: {
    name: 'Леденец',
    body: `${circ(50, 54, 40)} ${rr(44, 88, 12, 30, 5)}`,
    front: (c) => {
      // Спираль: четыре витка дугами, каждый следующий короче.
      const spiral = mix(c.light, '#ffffff', 0.55);
      return (
        `<path d="M 50 54 m 0 -32 a 32 32 0 1 1 -22.6 9.4 a 23 23 0 1 0 32.5 0 ` +
        `a 14 14 0 1 1 -19.8 0" fill="none" stroke="${spiral}" stroke-width="5.5" ` +
        `opacity=".7" stroke-linecap="round"/>`
      );
    },
    face: { y: 54, gap: 13, size: 0.9 },
    eyes: 'sparkle',
    blush: true,
  },

  pudding: {
    name: 'Пудинг',
    body:
      'M 26 46 C 26 40, 36 36, 50 36 C 64 36, 74 40, 74 46 ' +
      'L 86 108 C 87 114, 82 118, 74 118 L 26 118 C 18 118, 13 114, 14 108 Z',
    soften: 5,
    behind: (c) =>
      `<circle cx="50" cy="26" r="9" fill="${mix(c.dark, '#e8244c', 0.8)}"/>` +
      `<path d="M 50 20 C 54 10, 62 6, 68 6" stroke="${mix(c.dark, '#3f7a2c', 0.7)}" ` +
      `stroke-width="2.6" fill="none" stroke-linecap="round"/>`,
    front: (c) => {
      const sauce = mix(c.dark, '#8a4a1c', 0.6);
      return (
        `<path d="M 26 46 C 26 40, 36 36, 50 36 C 64 36, 74 40, 74 46 ` +
        `C 74 52, 64 56, 50 56 C 36 56, 26 52, 26 46 Z" fill="${sauce}" opacity=".7"/>` +
        `<path d="M 27 52 C 30 62, 26 68, 28 76" stroke="${sauce}" stroke-width="4" ` +
        `fill="none" opacity=".6" stroke-linecap="round"/>` +
        `<path d="M 73 52 C 70 64, 75 70, 73 80" stroke="${sauce}" stroke-width="4" ` +
        `fill="none" opacity=".6" stroke-linecap="round"/>`
      );
    },
    face: { y: 80, gap: 14 },
    blush: true,
  },
};

// --- Сборка -----------------------------------------------------------------

export const SHAPES: Record<string, ShapeDef> = {
  ...ARCADE,
  ...PLUSH,
  ...MECH,
  ...SUMMER,
  ...SPACE,
  ...SWEET,
};

export type ShapeId = string;

/**
 * Состав линеек по сезонам. Порядок значим: индекс в этом массиве — номер вида
 * на поле, и по нему же ядро адресует фигурку.
 */
export const SEASON_SHAPES: ReadonlyArray<readonly ShapeId[]> = [
  ['bot', 'tape', 'bolt', 'heart', 'disc', 'rocket', 'glitch', 'gem'],
  ['bear', 'bunny', 'cat', 'duck', 'frog', 'sheep', 'pig', 'owl'],
  ['mech', 'cog', 'bulb', 'capsule', 'drone', 'nut', 'magnet', 'battery'],
  ['lemon', 'melon', 'cherry', 'pine', 'berry', 'cactus', 'shell', 'pear'],
  ['planet', 'moon', 'star', 'comet', 'ufo', 'sat', 'nebula', 'astro'],
  ['donut', 'cup', 'pop', 'candy', 'slice', 'marsh', 'lolli', 'pudding'],
];

export function shapeName(shape: ShapeId): string {
  return SHAPES[shape]?.name ?? shape;
}
