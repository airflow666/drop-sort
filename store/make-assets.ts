/**
 * Иконка и обложка для карточки Яндекс Игр.
 *
 * Обе картинки собираются из ТЕХ ЖЕ фигурок и той же палитры, что и сама игра
 * (src/theme). Нарисованные вручную материалы неизбежно расходятся с билдом
 * после первой же правки палитры, и в витрине оказывается игра, которая
 * выглядит иначе, чем на скриншотах.
 *
 * Требования консоли: иконка 512×512, обложка 800×470.
 *
 * Запуск:
 *   npm i -D playwright-core --no-save
 *   npx tsx store/make-assets.ts
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { figurineSvg } from '../src/theme/figurines';
import { figurineLook, seasonById } from '../src/theme/seasons';

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const OUT = 'store/assets';

const season = seasonById(1);
const theme = season.theme;

/**
 * Витрина с одинаковыми фигурками — узнаваемый образ игры.
 *
 * Геометрия считается, а не подбирается. Кадр фигурки шире и выше её
 * содержимого: в нём есть запас под свечение и контактную тень (viewBox
 * 132×150 при содержимом 100×120). Поэтому шаг между фигурками равен высоте
 * СОДЕРЖИМОГО, а высота витрины — сумме шагов, иначе фигурки либо разъезжаются
 * с зазорами, либо вылезают за раму.
 */
const FRAME_W = 132;
const FRAME_H = 150;
const CONTENT_H = 120;
/** Насколько низ содержимого поднят над низом кадра, в долях кадра. */
const BOTTOM_PAD = (FRAME_H - 14 - CONTENT_H) / FRAME_H;

function shelf(shapeIndex: number, width: number, count: number, pad: number): string {
  const fig = season.playable[shapeIndex];
  const frameH = (width * FRAME_H) / FRAME_W;
  const step = (width * CONTENT_H) / FRAME_W;
  const cells = Array.from({ length: count })
    .map((_, i) => {
      const bottom = pad + i * step - BOTTOM_PAD * frameH;
      return `<i style="left:${pad}px;bottom:${bottom.toFixed(1)}px;
        width:${width}px;height:${frameH.toFixed(1)}px">${figurineSvg(fig.shape, fig.colors, figurineLook(fig))}</i>`;
    })
    .join('');
  return `<div class="shelf" style="width:${width + pad * 2}px;
    height:${(step * count + pad * 2).toFixed(1)}px;--r:${(width * 0.34).toFixed(1)}px">${cells}</div>`;
}

const shellCss = `
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{overflow:hidden}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;
       display:flex;align-items:center;justify-content:center}
  .stage{position:relative;width:100%;height:100%;overflow:hidden;
    background:
      radial-gradient(58% 44% at 16% 4%, ${theme.glowA} 0%, transparent 62%),
      radial-gradient(52% 40% at 86% 12%, ${theme.glowB} 0%, transparent 58%),
      linear-gradient(170deg, ${theme.bgTop}, ${theme.bgBottom});}
  /* Сетка «пола» — та же деталь, что даёт глубину игровой сцене. */
  .floor{position:absolute;left:0;right:0;bottom:0;height:46%;
    background-image:
      repeating-linear-gradient(to bottom, ${theme.accentAlt}14 0 1px, transparent 1px 26px),
      repeating-linear-gradient(to right, ${theme.accentAlt}0d 0 1px, transparent 1px 38px);
    mask-image:linear-gradient(to bottom, transparent, #000 70%);}
  .shelves{position:relative;display:flex;align-items:flex-end;gap:var(--gap)}
  /* Фигурки позиционируются абсолютно: только так их содержимое встаёт
     вплотную, при том что кадры со свечением перекрываются. */
  .shelf{position:relative;border-radius:var(--r);
    background:rgba(0,0,0,.34);border:2px solid ${theme.frame}aa;}
  .shelf i{position:absolute;display:block;line-height:0}
  .shelf svg{width:100%;height:100%;display:block}
  .brand{font-weight:900;letter-spacing:.16em;line-height:.95;
    background:linear-gradient(105deg,${theme.accent} 0%,#7c5cff 48%,${theme.accentAlt} 100%);
    -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;
    filter:drop-shadow(0 0 22px ${theme.accent}88);}
`;

function page(body: string, css: string, w: number, h: number): string {
  return `data:text/html;base64,${Buffer.from(
    `<!doctype html><meta charset="utf-8"><style>
      html,body{width:${w}px;height:${h}px}${shellCss}${css}
    </style><div class="stage">${body}</div>`,
    'utf-8'
  ).toString('base64')}`;
}

const browser = await chromium.launch({ executablePath: CHROME });
mkdirSync(OUT, { recursive: true });

// ─── Иконка 512×512 ────────────────────────────────────────────────────────
// Одна фигурка крупно и три витрины за ней: в мелком размере витрины читаются
// как узор, а фигурка остаётся распознаваемой. Название на иконку не ставим —
// в списке игр оно и так подписано, а текст в 512 пикселях превратится в кашу.
{
  // Одна фигурка крупно в стеклянной витрине. Первая версия ставила три полных
  // витрины и героя поверх — в списке игр, где иконка занимает 48–64 пикселя,
  // такой узор превращается в кашу. Читаемость на мелком размере важнее, чем
  // попытка объяснить механику: механику объясняет обложка.
  const hero = season.playable[1]; // котик: самый узнаваемый силуэт
  const body = `
    <div class="floor"></div>
    <div class="shelves" style="--gap:22px;
        position:absolute;left:50%;top:54%;transform:translate(-50%,-50%);opacity:.2">
      ${shelf(0, 104, 4, 9)}${shelf(4, 104, 4, 9)}${shelf(6, 104, 4, 9)}
    </div>
    <div class="shelves" style="position:absolute;left:50%;top:54%;
        transform:translate(-50%,-50%)">
      ${shelf(1, 250, 1, 22)}
    </div>`;
  const p = await browser.newPage({ viewport: { width: 512, height: 512 } });
  await p.goto(page(body, '', 512, 512), { waitUntil: 'load' });
  await p.waitForTimeout(320);
  writeFileSync(`${OUT}/icon-512.png`, await p.screenshot());
  await p.close();
  console.log(`${OUT}/icon-512.png 512×512`);
}

// ─── Обложка 800×470 ───────────────────────────────────────────────────────
// Слева название и суть, справа — ряд витрин. Обложка обязана объяснить
// механику без слов: видно, что фигурки сортируются по полкам.
{
  const body = `
    <div class="floor"></div>
    <div style="position:absolute;left:44px;top:50%;transform:translateY(-50%);z-index:2;
        max-width:330px">
      <div class="brand" style="font-size:78px">DROP</div>
      <div style="color:#fff;opacity:.84;font-size:18px;font-weight:700;letter-spacing:.03em;
          line-height:1.35;margin-top:10px">
        Сортируй фигурки<br>по витринам
      </div>
      <div style="color:#fff;opacity:.5;font-size:14px;margin-top:8px;line-height:1.4">
        Собирай коллекцию<br>из блайнд-боксов
      </div>
    </div>
    <div class="shelves" style="--gap:9px;position:absolute;right:30px;bottom:30px">
      ${shelf(1, 54, 4, 6)}${shelf(0, 54, 4, 6)}${shelf(5, 54, 2, 6)}${shelf(7, 54, 4, 6)}${shelf(3, 54, 3, 6)}
    </div>`;
  const p = await browser.newPage({ viewport: { width: 800, height: 470 } });
  await p.goto(page(body, '', 800, 470), { waitUntil: 'load' });
  await p.waitForTimeout(320);
  writeFileSync(`${OUT}/cover-800x470.png`, await p.screenshot());
  await p.close();
  console.log(`${OUT}/cover-800x470.png 800×470`);
}

await browser.close();
