/**
 * Скриншоты для карточки Яндекс Игр.
 *
 * Консоль требует не только пропорции 9:16 или 16:9, но и длинную сторону в
 * пределах 1280–2560. Разрешение поэтому набирается МАСШТАБОМ УСТРОЙСТВА, а не
 * растягиванием вёрстки: при viewport 1080 пикселей в ширину телефонный макет
 * превратился бы в планшетный, и скриншоты перестали бы соответствовать тому,
 * что видит игрок. Скрипт проверяет получившиеся размеры сам и падает, если
 * что-то вышло за рамки.
 *
 * Снимки делаются с СОБРАННОЙ игры, а не с dev-сервера: в карточку должно
 * попасть то, что реально уедет в консоль.
 *
 * Каждый снимок начинается с перезагрузки страницы. Цепочка состояний в одной
 * сессии оказалась хрупкой: экран победы предлагает ролик за ×2, за ним идёт
 * фулскрин с отсчётом, и следующий снимок попадал то в отсчёт, то в новый
 * уровень вместо меню. Перезагрузка стоит секунду и снимает весь этот класс
 * проблем.
 *
 * Запуск:
 *   npm run build
 *   python3 -m http.server 5200 --directory dist &
 *   npm i -D playwright-core --no-save
 *   npx tsx store/make-screenshots.ts
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, type Page } from 'playwright-core';

/**
 * Отладочная поверхность игры (см. App.exposeDebugApi). Скриншоты нужно снимать
 * с осмысленных состояний — начатого уровня, экрана победы, — а вручную довести
 * игру до них в автоматическом прогоне нечем.
 */
declare global {
  interface Window {
    __drop: {
      autoSolve(limit?: number): Promise<boolean>;
      endBlitzNow(): void;
      state(): { mode: string | null; moves: number; closed: number; solved: boolean };
    };
  }
}

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const URL = process.env.SMOKE_URL ?? 'http://127.0.0.1:5200/';
const OUT = 'store/screenshots';

/** Портрет ровно 9:16, альбом ровно 16:9, длинная сторона в пределах нормы. */
const FORMATS = [
  { name: 'portrait', width: 540, height: 960, scale: 2 },
  { name: 'landscape', width: 960, height: 540, scale: 2 },
] as const;

const MIN_LONG_SIDE = 1280;
const MAX_LONG_SIDE = 2560;

interface Shot {
  slug: string;
  /** Привести игру в нужное состояние. Страница уже в меню. */
  prepare(page: Page): Promise<void>;
}

/** Закрыть оверлеи, которые платформа показывает сама (награда за вход, сезон). */
async function dismissEntryOverlays(page: Page): Promise<void> {
  for (let i = 0; i < 3; i++) {
    const card = page.locator('.overlay.is-open .card');
    if ((await card.count()) === 0) return;
    await card.locator('button').last().click();
    await page.waitForTimeout(420);
  }
}

/** Загрузить игру заново и дождаться меню. */
async function freshMenu(page: Page): Promise<void> {
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForSelector('.brand', { timeout: 20000 });
  await dismissEntryOverlays(page);
  await page.waitForTimeout(300);
}

/**
 * Начать кампанию.
 *
 * До HUD игра может показать два оверлея, и оба штатные: вводный гайд (один раз
 * за профиль) и «Продолжить партию?», если предыдущий снимок оставил
 * незаконченную партию. Оба надо пройти, иначе HUD не появится вовсе.
 */
async function startCampaign(page: Page): Promise<void> {
  await page.locator('.mode--primary').click();
  // Ждём то, что придёт первым: HUD или диалог. Проверять наличие диалога
  // сразу после клика бесполезно — оверлей монтируется через кадр, count()
  // возвращает ноль, и обработка диалога молча пропускается.
  await page.waitForSelector('.hud__actions, .overlay.is-open .card', { timeout: 10000 });

  // Вводный гайд: листаем до конца по кнопке «Дальше».
  for (let i = 0; i < 6 && (await page.locator('.tut__art').count()); i++) {
    await page.locator('.overlay.is-open .card__actions button').first().click();
    await page.waitForTimeout(280);
  }

  // Диалог «Продолжить партию?» закрывается без разбора его заголовка. Раньше
  // здесь стояла проверка на слово «продолжить», и в английской локали она не
  // срабатывала: диалог оставался на экране, HUD не появлялся, и снимок экрана
  // победы для англоязычной витрины просто не получался.
  const confirm = page.locator('.overlay.is-open .card');
  if (await confirm.count()) {
    // Первая кнопка в этом диалоге — «продолжить»; вторая начинает заново.
    await confirm.locator('button').first().click();
    await page.waitForTimeout(500);
  }
  await page.waitForSelector('.hud__actions', { timeout: 10000 });
}

const SHOTS: Shot[] = [
  {
    slug: '01-menu',
    async prepare() {
      // Меню и есть нужное состояние.
    },
  },
  {
    slug: '02-game',
    async prepare(page) {
      await startCampaign(page);
      // Несколько ходов: стартовое поле выглядит менее интересно, чем поле в
      // процессе разбора, где часть витрин уже собирается.
      await page.evaluate(() => window.__drop.autoSolve(5));
      await page.waitForTimeout(600);
    },
  },
  {
    slug: '03-victory',
    async prepare(page) {
      await startCampaign(page);
      await page.evaluate(() => window.__drop.autoSolve());
      await page.waitForSelector('.overlay.is-open .card', { timeout: 20000 });
      await page.waitForTimeout(900); // дать звёздам зажечься
    },
  },
  {
    slug: '04-collection',
    async prepare(page) {
      await page.locator('.menu__row button').first().click();
      await page.waitForSelector('.grid', { timeout: 10000 });
      await page.waitForTimeout(400);
    },
  },
  {
    slug: '05-blitz',
    async prepare(page) {
      await page.locator('.mode').nth(1).click();
      await page.waitForSelector('.timer', { timeout: 10000 });
      await page.evaluate(() => window.__drop.autoSolve(6));
      await page.waitForTimeout(500);
    },
  },
];

const browser = await chromium.launch({ executablePath: CHROME });
mkdirSync(OUT, { recursive: true });

/**
 * Локали, для которых снимаются экраны.
 *
 * Обе витрины консоли — русская и англоязычная — требуют своих скриншотов, и
 * делать их двумя ручными прогонами с подменой переменной окружения значит
 * рано или поздно залить в одну витрину снимки на чужом языке. Поэтому оба
 * набора снимаются за один запуск, а язык попадает в имя файла.
 *
 * SHOT_LOCALE остаётся для отладки: с ним снимается только одна локаль.
 */
const LOCALES = process.env.SHOT_LOCALE
  ? [{ tag: process.env.SHOT_LOCALE.split(/[-_]/)[0], locale: process.env.SHOT_LOCALE }]
  : [
      { tag: 'ru', locale: 'ru-RU' },
      { tag: 'en', locale: 'en-US' },
    ];

const problems: string[] = [];
let written = 0;
const planned = SHOTS.length * FORMATS.length * LOCALES.length;

for (const { tag, locale } of LOCALES)
for (const format of FORMATS) {
  const w = format.width * format.scale;
  const h = format.height * format.scale;
  const longSide = Math.max(w, h);
  if (longSide < MIN_LONG_SIDE || longSide > MAX_LONG_SIDE) {
    problems.push(`${format.name}: длинная сторона ${longSide} вне 1280–2560`);
    continue;
  }
  const ratio = w > h ? w / h : h / w;
  if (Math.abs(ratio - 16 / 9) > 0.001) {
    problems.push(`${format.name}: пропорции ${ratio.toFixed(4)}, нужно ${(16 / 9).toFixed(4)}`);
    continue;
  }

  // Локаль задаётся явно: без SDK язык берётся из браузера, а у него по
  // умолчанию en-US, и русские снимки вышли бы английскими.
  const context = await browser.newContext({
    viewport: { width: format.width, height: format.height },
    deviceScaleFactor: format.scale,
    isMobile: format.name === 'portrait',
    hasTouch: format.name === 'portrait',
    locale,
  });
  const page = await context.newPage();
  // Без явного предела упавший шаг ждёт полминуты на стандартном таймауте.
  page.setDefaultTimeout(15000);

  for (const shot of SHOTS) {
    try {
      await freshMenu(page);
      await shot.prepare(page);
      const file = `${OUT}/${shot.slug}-${format.name}-${tag}.png`;
      writeFileSync(file, await page.screenshot());
      written++;
      console.log(`${file} ${w}×${h}`);
    } catch (e) {
      problems.push(
        `${shot.slug}/${format.name}/${tag}: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }
  await context.close();
}

await browser.close();

console.log(`\nЗаписано снимков: ${written} из ${planned}`);
if (problems.length > 0) {
  console.log('\nПроблемы:');
  problems.forEach((p) => console.log(`  ${p}`));
  process.exit(1);
}
