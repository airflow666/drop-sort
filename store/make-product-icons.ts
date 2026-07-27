/**
 * Иконки товаров для консоли разработчика Яндекс Игр.
 *
 * У каждого инапа в консоли есть поле «Иконка». Без неё товар в списке покупок
 * выглядит пустой строкой, и игрок не отличает «10 подсказок» от «убрать
 * рекламу», пока не прочитает подпись.
 *
 * Иконки собираются из той же палитры и того же материала, что и сама игра
 * (src/theme): тот же тёмный корпус со скруглением, тот же контровой свет по
 * нижней кромке, те же акценты сезона. Скин витрин вообще рисуется функцией
 * `skinChipSvg` — ровно тем же кодом, что миниатюра в магазине внутри игры.
 * Нарисованные отдельно иконки разошлись бы с игрой после первой правки
 * палитры.
 *
 * Размер 256×256: консоль показывает иконку мелко, но принимает и большие, а
 * из большой всегда можно уменьшить.
 *
 * Запуск:
 *   npm i -D playwright-core --no-save
 *   npx tsx store/make-product-icons.ts
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { figurineLook, seasonById } from '../src/theme/seasons';
import { figurineSvg } from '../src/theme/figurines';
import { skinByProductId } from '../src/theme/skins';
import {
  PRODUCT_HINTS,
  PRODUCT_NO_ADS,
  PRODUCT_SKIN_CHROME,
  PRODUCT_WEEK_PASS,
} from '../src/platform/ids';

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const OUT = 'store/products';
const SIZE = 256;

const theme = seasonById(1).theme;

/** Внутренний «пол» витрины в системе координат иконки (viewBox 100×100). */
const INSIDE_BOTTOM = 79;

/** Общая подложка: корпус игры, а не абстрактный квадрат. */
function plate(inner: string, accent = theme.accent): string {
  return `
    <div class="plate" style="--accent:${accent}">
      <div class="glow"></div>
      <div class="art">${inner}</div>
      <div class="bevel"></div>
    </div>`;
}

/** Лампочка подсказки — тот же значок, что на кнопке подсказки в HUD. */
function bulbIcon(): string {
  return `<svg viewBox="0 0 100 100">
    <defs>
      <radialGradient id="bulb" cx="38%" cy="30%" r="75%">
        <stop offset="0" stop-color="#fff6c8"/>
        <stop offset="55%" stop-color="#ffd23f"/>
        <stop offset="100%" stop-color="#c98a00"/>
      </radialGradient>
      <filter id="soft" x="-60%" y="-60%" width="220%" height="220%">
        <feGaussianBlur stdDeviation="7"/>
      </filter>
    </defs>
    <circle cx="50" cy="41" r="27" fill="#ffd23f" opacity=".45" filter="url(#soft)"/>
    <path d="M50 12 C67 12 79 25 79 41 C79 53 71 59 67 66 L33 66 C29 59 21 53 21 41 C21 25 33 12 50 12 Z"
          fill="url(#bulb)"/>
    <ellipse cx="39" cy="30" rx="9" ry="6" fill="#ffffff" opacity=".55" transform="rotate(-24 39 30)"/>
    <rect x="34" y="69" width="32" height="7" rx="3.5" fill="#8a7a4a"/>
    <rect x="37" y="79" width="26" height="6" rx="3" fill="#6d5f38"/>
    <path d="M41 90 h18" stroke="#6d5f38" stroke-width="5" stroke-linecap="round"/>
  </svg>`;
}

/** Перечёркнутый значок ролика — «без рекламы». */
function noAdsIcon(): string {
  return `<svg viewBox="0 0 100 100">
    <defs>
      <linearGradient id="screen" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#5b6a80"/>
        <stop offset="100%" stop-color="#2c3547"/>
      </linearGradient>
    </defs>
    <rect x="12" y="20" width="76" height="52" rx="9" fill="url(#screen)"/>
    <rect x="12" y="20" width="76" height="52" rx="9" fill="none"
          stroke="#8fa3b8" stroke-width="2.5" opacity=".8"/>
    <path d="M42 36 L64 46 L42 56 Z" fill="#c8d6e6" opacity=".85"/>
    <rect x="36" y="78" width="28" height="6" rx="3" fill="#5b6a80"/>
    <path d="M18 82 L82 12" stroke="#ff4d5e" stroke-width="11" stroke-linecap="round" opacity=".25"/>
    <path d="M18 82 L82 12" stroke="#ff4d5e" stroke-width="6.5" stroke-linecap="round"/>
  </svg>`;
}

/** Пропуск: билет с семёркой и монетой. */
function weekPassIcon(): string {
  return `<svg viewBox="0 0 100 100">
    <defs>
      <linearGradient id="ticket" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${theme.accent}"/>
        <stop offset="100%" stop-color="${theme.accentAlt}"/>
      </linearGradient>
      <radialGradient id="coin" cx="34%" cy="30%" r="70%">
        <stop offset="0" stop-color="#fff3b0"/>
        <stop offset="55%" stop-color="#ffd23f"/>
        <stop offset="100%" stop-color="#b98a00"/>
      </radialGradient>
    </defs>
    <path d="M14 26 h72 a6 6 0 0 1 6 6 v12 a8 8 0 0 0 0 16 v12 a6 6 0 0 1 -6 6 h-72
             a6 6 0 0 1 -6 -6 v-12 a8 8 0 0 0 0 -16 v-12 a6 6 0 0 1 6 -6 Z"
          fill="url(#ticket)"/>
    <path d="M50 26 v52" stroke="#0b0a14" stroke-width="3" stroke-dasharray="5 6" opacity=".45"/>
    <text x="29" y="65" font-family="-apple-system,Segoe UI,Roboto,Arial" font-size="40"
          font-weight="900" fill="#0b0a14" text-anchor="middle" opacity=".82">7</text>
    <circle cx="70" cy="52" r="15" fill="url(#coin)"/>
    <circle cx="65" cy="46" r="4" fill="#ffffff" opacity=".65"/>
  </svg>`;
}

/**
 * Хромовая витрина с фигурками внутри.
 *
 * Первая версия брала `skinChipSvg` — миниатюру из списка магазина. Но та
 * рисует только раму, потому что в списке рядом и так стоит подпись, а в
 * консоли иконка остаётся одна: пустая рама читалась как безымянный
 * прямоугольник, а не как витрина. Фигурки внутри объясняют предмет без слов.
 */
function chromeCaseIcon(): string {
  const skin = skinByProductId(PRODUCT_SKIN_CHROME)!;
  const t = { ...theme, ...skin.override };
  const figs = seasonById(1).playable.slice(0, 2);

  // Ширина фигурки подобрана так, чтобы две уместились между полом и потолком
  // витрины: интерьер здесь 72 единицы, две фигурки шириной 36 дают 65.
  const w = 36;

  // Геометрия кадра фигурки: viewBox 132×150, содержимое 100×120, и низ
  // содержимого поднят над низом кадра на запас под контактную тень. Шаг между
  // фигурками равен высоте СОДЕРЖИМОГО, а не кадра, иначе они разъезжаются.
  const scale = w / 132;
  const frameH = 150 * scale;
  const step = 120 * scale;
  /** Доля кадра от его верха до низа содержимого. */
  const contentBottomFrac = (14 + 120) / 150;

  const cells = figs
    .map((fig, i) => {
      // Содержимое центрируется по x=50, а не кадр: кадр шире содержимого.
      const x = 50 - 66 * scale;
      const y = INSIDE_BOTTOM - i * step - contentBottomFrac * frameH;
      return `<g transform="translate(${x.toFixed(1)}, ${y.toFixed(1)}) scale(${scale.toFixed(4)})">
        ${figurineSvg(fig.shape, fig.colors, figurineLook(fig))}</g>`;
    })
    .join('');

  return `<svg viewBox="0 0 100 100">
    <rect x="22" y="8" width="56" height="76" rx="14" fill="#000" opacity=".45"/>
    ${cells}
    <rect x="22" y="8" width="56" height="76" rx="14" fill="none"
          stroke="${t.frame}" stroke-width="4"/>
    <rect x="26.5" y="12" width="47" height="5" rx="2.5" fill="#ffffff" opacity=".6"/>
    <rect x="27" y="14" width="4" height="66" rx="2" fill="${t.glass}" opacity=".3"/>
    <rect x="30" y="86" width="40" height="5" rx="2.5" fill="${t.accent}" opacity=".75"/>
  </svg>`;
}

/** Значок количества в углу — «сколько именно подсказок». */
function countBadge(text: string): string {
  return `<div class="badge">${text}</div>`;
}

const ICONS: Array<{ id: string; art: string; accent?: string }> = [
  { id: PRODUCT_HINTS, art: bulbIcon() + countBadge('×10'), accent: '#ffd23f' },
  { id: PRODUCT_NO_ADS, art: noAdsIcon(), accent: '#ff4d5e' },
  { id: PRODUCT_WEEK_PASS, art: weekPassIcon() },
  { id: PRODUCT_SKIN_CHROME, art: chromeCaseIcon(), accent: '#9fc4dd' },
];

const css = `
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:${SIZE}px;height:${SIZE}px;overflow:hidden;background:transparent}
  body{display:grid;place-items:center;
       font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif}
  .plate{position:relative;width:${SIZE}px;height:${SIZE}px;border-radius:${SIZE * 0.22}px;
    overflow:hidden;
    background:
      radial-gradient(70% 55% at 30% 8%, ${theme.glowA}55 0%, transparent 60%),
      radial-gradient(60% 50% at 85% 20%, ${theme.glowB}44 0%, transparent 55%),
      linear-gradient(165deg, ${theme.bgTop}, ${theme.bgBottom});
    box-shadow: inset 0 0 0 3px ${theme.frame}cc;}
  /* Пятно акцента под рисунком — тот же приём, что даёт объём фигуркам. */
  .glow{position:absolute;left:50%;top:52%;width:74%;aspect-ratio:1;transform:translate(-50%,-50%);
    border-radius:50%;background:radial-gradient(circle, var(--accent) 0%, transparent 68%);
    opacity:.34;filter:blur(6px)}
  .art{position:absolute;inset:18%;display:grid;place-items:center}
  .art svg{width:100%;height:100%;display:block}
  .badge{position:absolute;right:-6%;bottom:-4%;padding:4px 12px;border-radius:999px;
    background:#ffd23f;color:#2a1f00;font-size:34px;font-weight:900;letter-spacing:.01em;
    box-shadow:0 4px 14px #0009}
  /* Контровой свет по нижней кромке — тот же слой, что у фигурок. */
  .bevel{position:absolute;inset:0;border-radius:${SIZE * 0.22}px;pointer-events:none;
    background:linear-gradient(160deg, #ffffff22 0%, transparent 42%, transparent 72%,
      var(--accent) 140%);
    mix-blend-mode:screen;opacity:.5}
`;

const browser = await chromium.launch({ executablePath: CHROME });
mkdirSync(OUT, { recursive: true });

for (const icon of ICONS) {
  const html = `data:text/html;base64,${Buffer.from(
    `<!doctype html><meta charset="utf-8"><style>${css}</style>${plate(icon.art, icon.accent)}`,
    'utf-8'
  ).toString('base64')}`;

  const page = await browser.newPage({
    viewport: { width: SIZE, height: SIZE },
    deviceScaleFactor: 1,
  });
  await page.goto(html, { waitUntil: 'load' });
  await page.waitForTimeout(250);
  const file = `${OUT}/${icon.id}.png`;
  writeFileSync(file, await page.screenshot({ omitBackground: true }));
  await page.close();
  console.log(`${file} ${SIZE}×${SIZE}`);
}

await browser.close();
console.log(`\nГотово: ${ICONS.length} иконок в ${OUT}/`);
