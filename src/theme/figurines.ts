/**
 * Отрисовка фигурки: материал, объём, лицо.
 *
 * Силуэты живут отдельно ([`shapes.ts`](./shapes.ts)) — здесь только то, из
 * чего фигурка «сделана».
 *
 * ── Зачем SVG, а не готовые PNG-атласы ────────────────────────────────────
 * 72 фигурки в трёх разрешениях под разные DPR — это несколько мегабайт
 * атласов при бюджете сборки 15 МБ и требовании стартовать за 5 секунд. Здесь
 * же вся коллекция — это описания силуэтов плюс таблица цветов: несколько
 * килобайт кода, растеризуемых ровно в то разрешение, которое нужно
 * устройству.
 *
 * ── Из чего сделан объём ──────────────────────────────────────────────────
 * Слои снизу вверх: запечённое свечение → контактная тень → корпус с
 * радиальным градиентом → внутренняя тень у основания → контровой свет по
 * нижне-правому краю → мягкий блик сверху-слева → острый блик → отделка
 * чейза → детали → лицо.
 *
 * Контровой свет — самый важный слой: без него фигурка читается как плоское
 * цветное пятно. Он рисуется обводкой ИЗНУТРИ силуэта (обводка по контуру с
 * клипом по нему же), поэтому одинаково честно ложится и на круг, и на
 * составной контур вроде кольца пончика.
 *
 * ── Материал сезона и отделка чейза ───────────────────────────────────────
 * Материал (`Material`) — это характер поверхности всей линейки: матовый плюш
 * не бликует вовсе, металл бликует резко, глазурь — широко и влажно. Отделка
 * (`Finish`) есть только у чейзов и работает как в настоящих блайнд-боксах:
 * радужный холо, блёстки, прозрачный пластик, металлик. Именно она делает
 * редкую фигурку видимо редкой, а не «той же самой другого оттенка».
 */

import type { Colorway } from './color';
import { mix } from './color';
import { f, SHAPES, type EyeStyle, type MouthStyle, type ShapeDef, type ShapeId } from './shapes';

export { SEASON_SHAPES, shapeName, SHAPES } from './shapes';
export type { ShapeId } from './shapes';

/**
 * Геометрия задаётся в системе 100×120, но viewBox шире: запечённому свечению
 * и контактной тени нужен запас, иначе они обрежутся по краю текстуры.
 * Слой раскладки должен опираться на CONTENT, а не на VIEWBOX.
 */
export const VIEWBOX = { x: -16, y: -14, w: 132, h: 150 } as const;
export const CONTENT = { w: 100, h: 120 } as const;

// --- Материалы и отделки ----------------------------------------------------

/** Поверхность линейки. Задаётся сезоном. */
export type Material = 'vinyl' | 'plush' | 'metal' | 'juicy' | 'cosmic' | 'sugar';

/** Отделка чейза — то, чем редкая фигурка отличается на вид, а не по подписи. */
export type Finish = 'holo' | 'glitter' | 'clear' | 'gold';

interface MaterialDef {
  /** Мягкий широкий блик: 0 — матовая ткань, 1 — сильный глянец. */
  spec: number;
  /** Острый блик-точка. У плюша его нет вовсе — ткань так не блестит. */
  sharp: number;
  /** Плотность контрового света. */
  rim: number;
  /** Множитель запечённого свечения. */
  halo: number;
  /** Насколько тёмная внутренняя тень у основания. */
  occ: number;
}

const MATERIALS: Record<Material, MaterialDef> = {
  // Глянцевый винил — базовая поверхность аркадной линейки.
  vinyl: { spec: 0.6, sharp: 0.8, rim: 0.95, halo: 1, occ: 0.85 },
  // Ткань: бликов нет, свет мягкий и рассеянный, свечение почти выключено.
  plush: { spec: 0.18, sharp: 0, rim: 0.55, halo: 0.3, occ: 0.7 },
  // Металл: жёсткий контраст, яркая кромка, точечный блик.
  metal: { spec: 0.95, sharp: 1, rim: 1.15, halo: 0.45, occ: 1 },
  // Мокрый фрукт: широкий влажный блик.
  juicy: { spec: 0.85, sharp: 0.95, rim: 0.9, halo: 0.75, occ: 0.8 },
  // Космос: приглушённая поверхность, зато сильное свечение вокруг.
  cosmic: { spec: 0.45, sharp: 0.6, rim: 0.85, halo: 1.35, occ: 0.9 },
  // Сахар: мягкий рассеянный блик, лёгкая тень.
  sugar: { spec: 0.7, sharp: 0.85, rim: 0.75, halo: 0.7, occ: 0.6 },
};

/** Точки блёсток для отделки `glitter` — фиксированные, чтобы не мерцали. */
const SPARKS: ReadonlyArray<readonly [number, number, number]> = [
  [30, 44, 2.6],
  [66, 38, 2],
  [78, 62, 2.8],
  [22, 70, 2.2],
  [52, 54, 1.8],
  [42, 86, 2.4],
  [72, 94, 2],
  [34, 104, 1.7],
  [60, 70, 1.5],
];

// --- Лицо -------------------------------------------------------------------

function eyes(def: ShapeDef, c: Colorway): string {
  const { y, gap } = def.face;
  const cx = def.face.x ?? 50;
  const s = def.face.size ?? 1;
  const style: EyeStyle = def.eyes ?? 'round';
  const lx = cx - gap;
  const rx = cx + gap;

  if (style === 'almond') {
    // Миндаль с наклоном к центру.
    const eye = (x: number, flip: number) =>
      `<path d="M ${f(x - 9 * s * flip)} ${f(y - 2 * s)} Q ${f(x)} ${f(y - 11 * s)} ` +
      `${f(x + 8 * s * flip)} ${f(y + 1 * s)} Q ${f(x)} ${f(y + 8 * s)} ` +
      `${f(x - 9 * s * flip)} ${f(y - 2 * s)} Z" fill="${c.ink}"/>` +
      `<ellipse cx="${f(x - 2 * s * flip)}" cy="${f(y - 3 * s)}" rx="${f(2.4 * s)}" ` +
      `ry="${f(1.8 * s)}" fill="#ffffff" opacity=".9"/>`;
    return eye(lx, 1) + eye(rx, -1);
  }

  if (style === 'glow') {
    // Светящийся глаз техники: тёплое ядро в мягком ореоле. Обычный тёмный
    // зрачок на визоре не читался бы вовсе — визор сам тёмный.
    //
    // Под ореолом обязательно тёмная глазница: на светлом корпусе (глитч,
    // спутник) свечение цвета кромки сливалось с телом, и лица не было видно
    // вообще. Глазница нужна ровно для этого случая, а на тёмном визоре она
    // просто не читается и ничего не портит.
    const eye = (x: number) =>
      `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(7.2 * s)}" ry="${f(7.4 * s)}" ` +
      `fill="${c.ink}" opacity=".55"/>` +
      `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(5.4 * s)}" ry="${f(5.6 * s)}" ` +
      `fill="${c.rim}" opacity=".45"/>` +
      `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(3.6 * s)}" ry="${f(4.2 * s)}" ` +
      `fill="${c.rim}"/>` +
      `<ellipse cx="${f(x)}" cy="${f(y - 0.8 * s)}" rx="${f(1.9 * s)}" ry="${f(2.2 * s)}" ` +
      `fill="#ffffff" opacity=".95"/>`;
    return eye(lx) + eye(rx);
  }

  if (style === 'ring') {
    const eye = (x: number) =>
      `<circle cx="${f(x)}" cy="${f(y)}" r="${f(6.6 * s)}" fill="none" ` +
      `stroke="${c.ink}" stroke-width="${f(3.4 * s)}"/>` +
      `<circle cx="${f(x - 1.4 * s)}" cy="${f(y - 1.6 * s)}" r="${f(1.5 * s)}" ` +
      `fill="#ffffff" opacity=".85"/>`;
    return eye(lx) + eye(rx);
  }

  if (style === 'happy') {
    // Зажмуренные дуги — используется отделкой `clear`, где зрачок не на чем
    // рисовать: тело прозрачное.
    const eye = (x: number) =>
      `<path d="M ${f(x - 6 * s)} ${f(y + 2 * s)} Q ${f(x)} ${f(y - 6 * s)} ` +
      `${f(x + 6 * s)} ${f(y + 2 * s)}" fill="none" stroke="${c.ink}" ` +
      `stroke-width="${f(2.6 * s)}" stroke-linecap="round"/>`;
    return eye(lx) + eye(rx);
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
  const style: MouthStyle = def.mouth ?? 'smile';
  if (style === 'none') return '';
  const cx = def.face.x ?? 50;
  const s = def.face.size ?? 1;
  const my = def.face.mouthY ?? def.face.y + 13 * s;

  if (style === 'grin') {
    // Широкая улыбка до щёк — для лягушки и всего, у кого рот шире лица.
    return (
      `<path d="M ${f(cx - 20 * s)} ${f(my - 3 * s)} Q ${f(cx)} ${f(my + 9 * s)} ` +
      `${f(cx + 20 * s)} ${f(my - 3 * s)}" stroke="${c.ink}" ` +
      `stroke-width="${f(2.6 * s)}" fill="none" stroke-linecap="round"/>`
    );
  }
  if (style === 'line') {
    return (
      `<path d="M ${f(cx - 5 * s)} ${f(my)} H ${f(cx + 5 * s)}" stroke="${c.ink}" ` +
      `stroke-width="${f(2.1 * s)}" stroke-linecap="round"/>`
    );
  }
  if (style === 'stitch') {
    return (
      `<path d="M ${f(cx - 6 * s)} ${f(my)} H ${f(cx + 6 * s)}" stroke="${c.ink}" ` +
      `stroke-width="${f(1.8 * s)}" stroke-dasharray="2.6 2.4" stroke-linecap="round"/>`
    );
  }
  return (
    `<path d="M ${f(cx - 5.5 * s)} ${f(my)} Q ${f(cx)} ${f(my + 5 * s)} ` +
    `${f(cx + 5.5 * s)} ${f(my)}" stroke="${c.ink}" stroke-width="${f(2.1 * s)}" ` +
    `fill="none" stroke-linecap="round"/>`
  );
}

function blush(def: ShapeDef, c: Colorway): string {
  if (!def.blush) return '';
  const { y, gap } = def.face;
  const cx = def.face.x ?? 50;
  const s = def.face.size ?? 1;
  const by = y + 8 * s;
  const cheek = (x: number) =>
    `<ellipse cx="${f(x)}" cy="${f(by)}" rx="${f(5.5 * s)}" ry="${f(3.2 * s)}" ` +
    `fill="${mix(c.dark, '#ff5a7a', 0.55)}" opacity=".38"/>`;
  return cheek(cx - gap - 10 * s) + cheek(cx + gap + 10 * s);
}

// --- Сборка -----------------------------------------------------------------

export interface FigurineOptions {
  /** Запечённое свечение вокруг фигурки. */
  glow?: boolean;
  /** Ободок «редкости» — светящееся гало под корпусом. */
  aura?: string;
  /** Лицо и отделка не рисуются (силуэт-заглушка в коллекции). */
  silhouette?: boolean;
  /** Поверхность линейки. По умолчанию глянцевый винил. */
  material?: Material;
  /** Отделка чейза. */
  finish?: Finish;
}

let uid = 0;

/**
 * Собрать SVG одной фигурки. Возвращает документ целиком — он растеризуется
 * через Image() в текстуру Pixi (см. src/render/textures.ts).
 */
export function figurineSvg(shape: ShapeId, c: Colorway, opts: FigurineOptions = {}): string {
  const def = SHAPES[shape];
  if (!def) throw new Error(`неизвестный силуэт: ${shape}`);

  const { glow = true, aura, silhouette = false, material = 'vinyl', finish } = opts;
  const m = MATERIALS[material];
  const n = ++uid;
  const id = (k: string) => `${k}${n}`;

  const behind = silhouette ? '' : (def.behind?.(c) ?? '');
  const front = silhouette ? '' : (def.front?.(c) ?? '');
  const face = silhouette ? '' : blush(def, c) + eyes(def, c) + mouth(def, c);

  const fillRule = def.evenodd ? ' fill-rule="evenodd"' : '';
  // Утолщение обводкой того же градиента: скругляет острые углы у полигонов
  // (молния, кристалл, гайка) и заодно прячет стыки составных контуров.
  const softStroke = def.soften
    ? ` stroke="url(#${id('body')})" stroke-width="${f(def.soften)}" stroke-linejoin="round"` +
      ` stroke-linecap="round"`
    : '';

  const haloOpacity = 0.5 * m.halo;
  const clear = finish === 'clear' && !silhouette;

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
    `<stop offset="0" stop-color="${c.rim}" stop-opacity="${f(0.95 * m.rim)}"/>` +
    `<stop offset=".38" stop-color="${c.rim}" stop-opacity="0"/>` +
    `</linearGradient>` +
    // Мягкий широкий блик.
    `<radialGradient id="${id('spec')}" cx="50%" cy="50%" r="50%">` +
    `<stop offset="0" stop-color="#ffffff" stop-opacity="${f(m.spec)}"/>` +
    `<stop offset="1" stop-color="#ffffff" stop-opacity="0"/>` +
    `</radialGradient>` +
    // Внутренняя тень у основания — фигурка «стоит», а не висит.
    `<radialGradient id="${id('occ')}" cx="50%" cy="50%" r="50%">` +
    `<stop offset="0" stop-color="${c.dark}" stop-opacity="${f(0.85 * m.occ)}"/>` +
    `<stop offset="1" stop-color="${c.dark}" stop-opacity="0"/>` +
    `</radialGradient>` +
    // Радужный перелив для холо-чейза: три оборота спектра по диагонали.
    (finish === 'holo'
      ? `<linearGradient id="${id('holo')}" x1="0" y1="1" x2="1" y2="0">` +
        `<stop offset="0" stop-color="#ff5cf0" stop-opacity=".62"/>` +
        `<stop offset=".22" stop-color="#7c5cff" stop-opacity=".5"/>` +
        `<stop offset=".42" stop-color="#35e6ff" stop-opacity=".58"/>` +
        `<stop offset=".62" stop-color="#8fe03a" stop-opacity=".5"/>` +
        `<stop offset=".82" stop-color="#ffd23f" stop-opacity=".58"/>` +
        `<stop offset="1" stop-color="#ff5c8a" stop-opacity=".62"/>` +
        `</linearGradient>`
      : '') +
    // Металлик: узкая полоса «полировки» поперёк корпуса.
    (finish === 'gold'
      ? `<linearGradient id="${id('gold')}" x1="0" y1="0" x2="0" y2="1">` +
        `<stop offset="0" stop-color="#fff3c4" stop-opacity=".75"/>` +
        `<stop offset=".4" stop-color="#e8b23c" stop-opacity=".2"/>` +
        `<stop offset=".55" stop-color="#6b4a10" stop-opacity=".38"/>` +
        `<stop offset=".72" stop-color="#ffe08a" stop-opacity=".62"/>` +
        `<stop offset="1" stop-color="#8a5f16" stop-opacity=".3"/>` +
        `</linearGradient>`
      : '') +
    // Запечённое свечение. filterUnits с запасом — иначе размытие обрежется.
    `<filter id="${id('blur')}" x="-60%" y="-60%" width="220%" height="220%">` +
    `<feGaussianBlur stdDeviation="9"/>` +
    `</filter>` +
    // Отдельное, более плотное размытие для ободка редкости.
    `<filter id="${id('halo')}" x="-60%" y="-60%" width="220%" height="220%">` +
    `<feGaussianBlur stdDeviation="3.2"/>` +
    `</filter>` +
    // Клип по корпусу: блики, кромка и отделка не должны выходить за силуэт.
    `<clipPath id="${id('clip')}"><path d="${def.body}"${fillRule}/></clipPath>` +
    `</defs>` +
    // 1. Свечение — размытая копия силуэта под всем остальным.
    //
    // У фигур с отверстием (кольцо пончика) свечение рисуется ОБВОДКОЙ, а не
    // заливкой: залитая копия размывается внутрь и затягивает дырку, из-за
    // чего пончик переставал быть пончиком.
    (glow && haloOpacity > 0.02
      ? `<g filter="url(#${id('blur')})" opacity="${f(haloOpacity)}">` +
        (def.evenodd
          ? `<path d="${def.body}"${fillRule} fill="none" stroke="${c.glow}" stroke-width="14"/>`
          : `<path d="${def.body}" fill="${c.glow}"/>`) +
        `${behind}</g>`
      : '') +
    // 2. Контактная тень на полке.
    `<ellipse cx="50" cy="119" rx="30" ry="6" fill="#000000" opacity=".33" ` +
    `filter="url(#${id('blur')})"/>` +
    // 3. Ободок редкости — размытая обводка ПОД корпусом, то есть гало.
    // Резкая обводка поверх силуэта читалась как дешёвый аутлайн и ломала
    // ощущение винила, ради которого выстроены все остальные слои.
    (aura
      ? `<g filter="url(#${id('halo')})">` +
        `<path d="${def.body}"${fillRule} fill="none" stroke="${aura}" stroke-width="6"/>` +
        // Уши, плавники и антенны тоже должны светиться. Перекрашиваем и
        // заливку, и обводку, но НЕ трогаем fill="none": иначе залилась бы
        // область под кривой антенны.
        (behind
          ? `<g opacity=".8">${behind
              .replace(/fill="(?!none)[^"]*"/g, `fill="${aura}"`)
              .replace(/stroke="(?!none)[^"]*"/g, `stroke="${aura}"`)}</g>`
          : '') +
        `</g>`
      : '') +
    // 4. Элементы за корпусом.
    behind +
    // 5. Корпус. Прозрачный чейз показывает сквозь себя фон и собственную
    // изнанку — поэтому у него понижена непрозрачность и усилена кромка.
    `<path d="${def.body}"${fillRule} fill="url(#${id('body')})"${softStroke}` +
    (clear ? ' opacity=".55"' : '') +
    `/>` +
    // 6. Всё, что должно остаться внутри силуэта.
    `<g clip-path="url(#${id('clip')})">` +
    `<ellipse cx="50" cy="122" rx="42" ry="20" fill="url(#${id('occ')})"/>` +
    `<path d="${def.body}"${fillRule} fill="none" stroke="url(#${id('rim')})" ` +
    `stroke-width="7"/>` +
    `<ellipse cx="34" cy="52" rx="20" ry="15" fill="url(#${id('spec')})" ` +
    `transform="rotate(-24 34 52)"/>` +
    (m.sharp > 0
      ? `<ellipse cx="30" cy="47" rx="5.5" ry="3.4" fill="#ffffff" ` +
        `opacity="${f(0.8 * m.sharp)}" transform="rotate(-24 30 47)"/>`
      : '') +
    // 6a. Отделка, обрезанная по силуэту: глазурь пончика обязана оборваться
    // на кромке отверстия, а не перекрыть его.
    (silhouette ? '' : (def.inner?.(c) ?? '')) +
    // 6b. Отделка чейза — поверх материала, но под деталями и лицом.
    (silhouette ? '' : finishLayer(finish, c, id)) +
    `</g>` +
    // 7. Детали поверх корпуса и лицо.
    front +
    face +
    `</svg>`
  );
}

/** Слой отделки чейза. Рисуется внутри клипа корпуса. */
function finishLayer(
  finish: Finish | undefined,
  c: Colorway,
  id: (k: string) => string
): string {
  if (!finish) return '';

  if (finish === 'holo') {
    return `<rect x="-20" y="-20" width="140" height="160" fill="url(#${id('holo')})"/>`;
  }

  if (finish === 'gold') {
    return `<rect x="-20" y="-20" width="140" height="160" fill="url(#${id('gold')})"/>`;
  }

  if (finish === 'glitter') {
    // Блёстки: у каждой яркое ядро и мягкий ореол. Одних точек мало — они
    // читаются как грязь на текстуре, а не как искра в пластике.
    return SPARKS.map(
      ([x, y, r]) =>
        `<circle cx="${x}" cy="${y}" r="${f(r * 2.2)}" fill="${c.rim}" opacity=".3"/>` +
        `<circle cx="${x}" cy="${y}" r="${r}" fill="#ffffff" opacity=".9"/>`
    ).join('');
  }

  // clear: прозрачный пластик. Внутри видно вторую, смещённую копию кромки —
  // так читается толщина стенки.
  return (
    `<rect x="-20" y="-20" width="140" height="160" fill="${mix(c.light, '#ffffff', 0.4)}" ` +
    `opacity=".18"/>` +
    `<ellipse cx="62" cy="86" rx="26" ry="20" fill="${c.light}" opacity=".22" ` +
    `transform="rotate(18 62 86)"/>`
  );
}
