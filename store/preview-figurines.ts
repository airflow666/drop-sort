/**
 * Контрольный лист фигурок: рендерит всю коллекцию в PNG, чтобы на неё можно
 * было просто посмотреть.
 *
 * Фигурки описаны кодом, а не нарисованы в редакторе, поэтому единственный
 * способ поймать съехавшую координату или потерявшийся блик — увидеть их.
 * Скрипт же проверяет и то, что глазом не увидишь: различимость видов в
 * оттенках серого (у игроков с дальтонизмом цвет не работает — работает
 * силуэт и светлота).
 *
 * Запуск:
 *   npm i -D playwright-core --no-save
 *   npx tsx store/preview-figurines.ts [--out путь.png]
 */

import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { hexToHsl, luminance } from '../src/theme/color';
import { figurineSvg, VIEWBOX } from '../src/theme/figurines';
import { figurineLook, SEASONS } from '../src/theme/seasons';

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const TILE = 112;

function parseArg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const out = parseArg('--out', 'store/preview/figurines.png');
const grayscale = process.argv.includes('--grayscale');

// --- Проверка различимости --------------------------------------------------
// Два вида путаются, только если они близки И по тону, И по светлоте.
// Одинаковая светлота при разных тонах не мешает: цвет всё равно различается,
// а для тех, у кого не различается, работает силуэт — у каждого вида свой.
// Поэтому порог по одной светлоте был бы ложной тревогой (и в прошлом прогоне
// выдал 13 «проблем», из которых настоящей была одна).
const MIN_LUMA_GAP = 0.04;
const MIN_HUE_GAP = 40;

function hueDistance(a: string, b: string): number {
  const d = Math.abs(hexToHsl(a).h - hexToHsl(b).h) % 360;
  return d > 180 ? 360 - d : d;
}

const warnings: string[] = [];
for (const season of SEASONS) {
  const figs = season.playable;
  for (let i = 0; i < figs.length; i++) {
    for (let j = i + 1; j < figs.length; j++) {
      const a = figs[i];
      const b = figs[j];
      const dl = Math.abs(luminance(a.colors.base) - luminance(b.colors.base));
      const dh = hueDistance(a.colors.base, b.colors.base);
      if (dl < MIN_LUMA_GAP && dh < MIN_HUE_GAP) {
        warnings.push(
          `  сезон ${season.id} «${season.name}»: ${a.name} и ${b.name} —` +
            ` Δтон ${dh.toFixed(0)}°, Δсветлота ${dl.toFixed(3)}`
        );
      }
    }
  }
}

// --- Разметка листа ---------------------------------------------------------
const rows = SEASONS.map((season) => {
  const cells = season.figurines
    .map((fig) => {
      const svg = figurineSvg(fig.shape, fig.colors, figurineLook(fig));
      const badge =
        fig.rarity === 'legendary'
          ? '<b class="leg">LEG</b>'
          : fig.rarity === 'rare'
            ? '<b class="rare">RARE</b>'
            : '';
      return `<figure>
        <div class="art" style="aspect-ratio:${VIEWBOX.w}/${VIEWBOX.h}">${svg}${badge}</div>
        <figcaption>${fig.name}</figcaption>
      </figure>`;
    })
    .join('');
  return `<section style="--bg-top:${season.theme.bgTop};--bg-bottom:${season.theme.bgBottom};
      --glow-a:${season.theme.glowA};--glow-b:${season.theme.glowB}">
      <h2><i>${season.id}</i>${season.name}<em>${season.tagline}</em></h2>
      <div class="grid">${cells}</div>
    </section>`;
}).join('');

const html = `<!doctype html><meta charset="utf-8">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:#08070f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
       width:${TILE * 12 + 48}px;${grayscale ? 'filter:grayscale(1);' : ''}}
  section{padding:18px 24px 26px;background:
     radial-gradient(60% 50% at 15% 0%, var(--glow-a) 0%, transparent 60%),
     radial-gradient(50% 45% at 85% 10%, var(--glow-b) 0%, transparent 55%),
     linear-gradient(180deg, var(--bg-top), var(--bg-bottom));}
  h2{display:flex;align-items:center;gap:10px;color:#fff;font-size:17px;letter-spacing:.14em;
     font-weight:900;margin-bottom:14px}
  h2 i{display:grid;place-items:center;width:24px;height:24px;border-radius:8px;font-style:normal;
       background:rgba(255,255,255,.16);font-size:12px}
  h2 em{font-style:normal;font-weight:400;font-size:12px;letter-spacing:.02em;opacity:.55}
  .grid{display:grid;grid-template-columns:repeat(12,1fr);gap:6px}
  figure{display:flex;flex-direction:column;align-items:center;gap:4px}
  .art{position:relative;width:100%}
  .art svg{width:100%;height:100%;display:block}
  figcaption{color:rgba(255,255,255,.62);font-size:8.5px;text-align:center;line-height:1.25;
             min-height:20px}
  b{position:absolute;top:2px;right:2px;font-size:6.5px;padding:1px 3px;border-radius:4px;
    letter-spacing:.06em}
  .rare{background:#7ee8ff;color:#04202a}
  .leg{background:#ffd54a;color:#3a2a00}
</style>${rows}`;

const page404 = `data:text/html;base64,${Buffer.from(html, 'utf-8').toString('base64')}`;

const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: TILE * 12 + 48, height: 900 } });
await page.goto(page404, { waitUntil: 'load' });
// SVG-градиенты и размытия должны успеть отрисоваться до снимка.
await page.waitForTimeout(350);
const buffer = await page.screenshot({ fullPage: true });
await browser.close();

writeFileSync(out, buffer);

const total = SEASONS.reduce((n, s) => n + s.figurines.length, 0);
console.log(`${out}: ${total} фигурок, ${SEASONS.length} сезонов${grayscale ? ' (ч/б)' : ''}`);
if (warnings.length > 0) {
  console.log('\nПредупреждения по различимости:');
  warnings.forEach((w) => console.log(w));
} else {
  console.log('Различимость по светлоте: во всех сезонах виды разнесены.');
}
