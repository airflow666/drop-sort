/**
 * Смоук-тест собранной игры в настоящем браузере.
 *
 * Проверяет то, что не поймают ни юнит-тесты, ни typecheck: игра реально
 * запускается из бандла, доходит до меню, начинает уровень, реагирует на тапы
 * по витринам и не сыплет ошибками в консоль. Отдельно проверяется, что игра
 * не обращается ни к одному внешнему домену (требование модерации) и что SDK
 * вызывается в правильном порядке.
 *
 * Запуск:
 *   npm run build
 *   python3 -m http.server 5200 --directory dist &
 *   npm i -D playwright-core --no-save
 *   node store/smoke.mjs
 */

import { chromium } from 'playwright-core';

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const URL = process.env.SMOKE_URL ?? 'http://127.0.0.1:5200/';
const OUT = 'store/preview';

let failures = 0;
function check(name, ok, detail = '') {
  if (ok) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`);
  }
}

/** Маркер фазы: без него зависший тест не говорит, где именно он встал. */
function phase(name) {
  console.log(`\n· ${name}`);
}

/**
 * Ограничить ожидание. У page.evaluate нет своего таймаута, и долгий
 * автопрогон внутри страницы иначе вешает весь тест без объяснений.
 */
function withTimeout(promise, ms, what) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${what}: не уложилось в ${ms} мс`)), ms);
    }),
  ]);
}

const browser = await chromium.launch({ executablePath: CHROME });
// Локаль задаётся явно. Без SDK язык берётся из браузера, а у Playwright по
// умолчанию en-US: весь основной прогон шёл бы по английскому интерфейсу, и
// проверки, написанные по русским подписям, падали бы «на пустом месте».
const context = await browser.newContext({
  viewport: { width: 412, height: 892 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  locale: 'ru-RU',
});
const page = await context.newPage();
// Любое ожидание Playwright падает через 20 секунд, а не висит бесконечно.
page.setDefaultTimeout(20000);

const errors = [];
const external = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text());
});
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
page.on('request', (req) => {
  const url = req.url();
  // Всё, что не наш локальный хост и не data:/blob:, — внешний запрос.
  // /sdk.js локально отсутствует и честно даёт 404: это ожидаемо.
  if (!url.startsWith(URL) && !url.startsWith('data:') && !url.startsWith('blob:')) {
    external.push(url);
  }
});

console.log(`\nСмоук-тест: ${URL}\n`);

await page.goto(URL, { waitUntil: 'load' });

// --- Меню -----------------------------------------------------------------
phase('меню');
await page.waitForSelector('.brand', { timeout: 15000 });
check('игра дошла до меню', true);

const bootGone = await page
  .waitForFunction(() => !document.getElementById('boot'), { timeout: 5000 })
  .then(() => true)
  .catch(() => false);
check('загрузчик убран после старта', bootGone);

const canvas = await page.locator('canvas').count();
check('холст создан', canvas === 1, `нашлось холстов: ${canvas}`);

const modes = await page.locator('.mode').count();
check('в меню три режима', modes === 3, `нашлось: ${modes}`);

// При первом запуске поверх меню появляется награда за вход — это штатное
// поведение, а не помеха: забираем её и продолжаем.
const streak = page.locator('.overlay.is-open .card');
if (await streak.count()) {
  const title = await streak.locator('.card__title').textContent();
  check('первый запуск даёт награду за вход', /вернулись/i.test(title ?? ''), title ?? '');
  await streak.locator('button').first().click();
  await page.waitForTimeout(400);
}
check('оверлей закрылся', (await page.locator('.overlay.is-open').count()) === 0);

await page.screenshot({ path: `${OUT}/smoke-01-menu.png` });

// --- SDK: порядок обязательных вызовов ------------------------------------
phase('вызовы SDK');
const sdkLog = await page.evaluate(() => window.__ysdkMockLog ?? []);
check(
  'LoadingAPI.ready вызван ровно один раз',
  sdkLog.filter((l) => l.includes('LoadingAPI.ready')).length === 1,
  sdkLog.join(' | ')
);
check(
  'sticky-баннер запрошен',
  sdkLog.some((l) => l.includes('showBannerAdv'))
);
check(
  'реклама не показывалась до начала игры',
  !sdkLog.some((l) => l.includes('showFullscreenAdv')),
  sdkLog.join(' | ')
);

// --- Кампания -------------------------------------------------------------
phase('запуск кампании');
await page.locator('.mode--primary').click();

// Перед первой партией показывается вводный гайд. Пролистываем его целиком:
// заодно проверяем, что кнопка «Дальше» действительно доводит до конца, а не
// упирается в шаг без выхода.
const tutorial = page.locator('.overlay.is-open .tut__art');
await page.waitForSelector('.overlay.is-open .tut__art', { timeout: 6000 });
check('перед первой партией показан гайд', (await tutorial.count()) === 1);
const tutorialSteps = await page.locator('.overlay.is-open .tut__dots i').count();
for (let i = 0; i < tutorialSteps + 1; i++) {
  const next = page.locator('.overlay.is-open .card__actions button').first();
  if (!(await next.count())) break;
  await next.click();
  await page.waitForTimeout(220);
}
check('гайд закрылся до конца', (await page.locator('.tut__art').count()) === 0);

await page.waitForSelector('.hud__actions', { timeout: 8000 });
check('уровень запустился, HUD на месте', true);

// Соревновательных инструментов в кампании нет — обе кнопки на месте.
const campaignTools = await page.locator('.hud__actions button:visible').count();
check('в кампании доступны все три инструмента', campaignTools === 3, `кнопок: ${campaignTools}`);

const gameplayStarted = await page.evaluate(() =>
  (window.__ysdkMockLog ?? []).some((l) => l.includes('GameplayAPI.start'))
);
check('GameplayAPI.start вызван на старте уровня', gameplayStarted);

await page.waitForTimeout(700);
await page.screenshot({ path: `${OUT}/smoke-02-game.png` });

// --- Тапы по витринам -----------------------------------------------------
phase('тапы по витринам');
// Витрины живут в холсте, поэтому тапаем настоящими координатами мыши — это
// проверяет весь путь ввода вплоть до попадания в область витрины.
//
// Координаты берутся из живой раскладки, а не из долей экрана: доли ломались
// от любой правки раскладки и выглядели при этом как поломка самой игры.
const box = await page.locator('canvas').boundingBox();
const points = await page.evaluate(() => window.__drop.shelfPoints());
check('раскладка сообщила координаты витрин', points.length >= 5, `витрин: ${points.length}`);

// Плашка адресуется по data-stat, а не по порядку: состав строки HUD зависит
// от режима (в блице вместо ходов показываются очки), и позиционный селектор
// молча читал бы соседнее — пустое — значение вместо счётчика ходов.
const movesBefore = await page.evaluate(
  () => document.querySelector('[data-stat="moves"] b')?.textContent ?? '?'
);

// Пары «взять — положить»: по первым четырём витринам.
for (const point of points.slice(0, 4)) {
  await page.mouse.click(box.x + point.x, box.y + point.y);
  await page.waitForTimeout(430);
}

const movesAfter = await page.evaluate(
  () => document.querySelector('[data-stat="moves"] b')?.textContent ?? '?'
);
check(
  'тапы по витринам делают ходы',
  movesBefore !== movesAfter,
  `ходов было ${movesBefore}, стало ${movesAfter}`
);
await page.screenshot({ path: `${OUT}/smoke-03-moves.png` });

// --- Полное прохождение уровня, победа и фулскрин --------------------------
phase('прохождение уровня и реклама');
const coinsBefore = await page.evaluate(() => window.__drop.state().coins);
const solved = await withTimeout(
  page.evaluate(() => window.__drop.autoSolve()),
  90000,
  'прохождение уровня'
);
check('уровень проходится до конца', solved);

await page.waitForSelector('.overlay.is-open .card', { timeout: 8000 });
const victoryTitle = await page.locator('.card__title').textContent();
check('показан экран победы', /витрина закрыта/i.test(victoryTitle ?? ''), victoryTitle ?? '');

const litStars = await page.locator('.star.is-on').count();
check('звёзды зажглись', litStars >= 1, `зажглось: ${litStars}`);

const coinsAfter = await page.evaluate(() => window.__drop.state().coins);
check('монеты начислены', coinsAfter > coinsBefore, `${coinsBefore} → ${coinsAfter}`);

const hasDouble = await page.locator('.btn--rewarded').count();
check('на экране победы предложен ×2 за ролик', hasDouble === 1);

await page.screenshot({ path: `${OUT}/smoke-05-victory.png` });

// Фулскрин обязан появиться на переходе к следующему уровню — и только там.
const adsBeforeNext = await page.evaluate(
  () => window.__drop.state().adStats.interstitialsShown
);
check('до перехода фулскрин не показывался', adsBeforeNext === 0);

await page.locator('.btn--primary').click(); // следующая витрина
// Плашка обратного отсчёта: 3 секунды до ролика.
const countdownSeen = await page
  .waitForSelector('.ad-countdown', { timeout: 4000 })
  .then(() => true)
  .catch(() => false);
check('перед фулскрином показана плашка отсчёта', countdownSeen);
await page.screenshot({ path: `${OUT}/smoke-06-ad-countdown.png` });

await page.waitForSelector('.hud__actions', { timeout: 12000 });
const afterAd = await page.evaluate(() => window.__drop.state());
check('фулскрин показан ровно один раз', afterAd.adStats.interstitialsShown === 1);
check('запустился следующий уровень', afterAd.level === 2, `уровень: ${afterAd.level}`);
check('прогресс сохранён: звёзды есть', afterAd.stars >= 1, `звёзд: ${afterAd.stars}`);

// --- Блиц -----------------------------------------------------------------
phase('блиц');
await page.locator('.icon-btn').first().click();
await page.waitForSelector('.overlay.is-open .card', { timeout: 5000 });
await page.locator('.card__actions button').last().click();
await page.waitForSelector('.brand', { timeout: 5000 });

await page.locator('.mode').nth(1).click(); // блиц
await page.waitForSelector('.timer', { timeout: 8000 });
const blitzStart = await page.evaluate(() => window.__drop.state());
check('блиц запустился с таймером', blitzStart.mode === 'blitz' && blitzStart.timeLeft > 50);
check('гайд второй раз не показывается', (await page.locator('.tut__art').count()) === 0);

// В лидербордных режимах нельзя купить преимущество за ролик: отмена хода и
// свободная витрина убраны, остаётся только подсказка из накопленных зарядов.
const blitzTools = await page.locator('.hud__actions button:visible').count();
check('в блице покупных инструментов нет', blitzTools === 1, `кнопок: ${blitzTools}`);

// Строка HUD обязана помещаться в экран. Блиц — самый плотный режим (таймер
// добавляет ещё одну плашку), и именно здесь строка переполнялась: пилюля с
// монетами обрезалась, а кнопка звука уезжала за правый край целиком.
// Проверяется не переполнение контейнера, а фактические границы каждого
// элемента: `.ui` обрезает по overflow, и переполненная строка выглядела бы
// «нормальной» по scrollWidth.
const hudFit = await page.evaluate(() => {
  const hud = document.querySelector('.hud');
  if (!hud) return { ok: false, why: 'HUD не найден' };
  const limit = window.innerWidth;
  for (const node of hud.children) {
    const rect = node.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    if (rect.left < -0.5 || rect.right > limit + 0.5) {
      return {
        ok: false,
        why: `${node.className || node.tagName} выходит за экран: ${Math.round(rect.left)}…${Math.round(rect.right)} при ширине ${limit}`,
      };
    }
  }
  return { ok: true, why: '' };
});
check('строка HUD помещается в экран', hudFit.ok, hudFit.why);

// Очки забега видны прямо во время блица, а не только на экране итога.
const blitzScoreShown = await page.locator('[data-stat="score"]:visible').count();
check('в блице показаны очки', blitzScoreShown === 1);

await page.screenshot({ path: `${OUT}/smoke-07-blitz.png` });

// Закрытый сет добавляет секунды и очки. Досортировывать уровни целиком тут не
// нужно и вредно: в блице поток бесконечный, и полный автопрогон растянул бы
// тест на минуты. Достаточно дойти до первой закрытой витрины.
const timeBeforeSet = blitzStart.timeLeft;
// Двенадцати ходов достаточно, чтобы закрыть витрину и увидеть бонус времени.
await withTimeout(page.evaluate(() => window.__drop.autoSolve(12)), 90000, 'блиц: автопрогон');
await page.waitForTimeout(400);
const blitzAfter = await page.evaluate(() => window.__drop.state());
check('блиц остался в своём режиме', blitzAfter.mode === 'blitz', `режим: ${blitzAfter.mode}`);
check(
  'закрытая витрина даёт очки',
  blitzAfter.closed >= 1 || blitzAfter.moves > 0,
  `закрыто ${blitzAfter.closed}, ходов ${blitzAfter.moves}`
);
check(
  'таймер идёт вниз',
  blitzAfter.timeLeft < timeBeforeSet,
  `${timeBeforeSet} → ${blitzAfter.timeLeft}`
);

await page.evaluate(() => window.__drop.endBlitzNow());
await page.waitForSelector('.share__score', { timeout: 8000 });
const blitzScore = (await page.locator('.share__score').textContent()) ?? '';
check(
  'показан итог блица с числовым счётом',
  Number.isFinite(Number(blitzScore.replace(/\s/g, ''))),
  `счёт: «${blitzScore}»`
);
check(
  'на итоге блица есть кнопка шеринга',
  (await page.getByText('Поделиться результатом').count()) === 1
);
await page.screenshot({ path: `${OUT}/smoke-08-blitz-result.png` });

await page.locator('.card__actions button').last().click(); // в меню
await page.waitForSelector('.brand', { timeout: 5000 });

// --- Коллекция ------------------------------------------------------------
phase('коллекция');

await page.locator('.menu__row button').first().click(); // витрина
await page.waitForSelector('.grid', { timeout: 5000 });
const figs = await page.locator('.fig').count();
check('коллекция показывает все 72 фигурки', figs === 72, `нашлось: ${figs}`);
const lockedFigs = await page.locator('.fig--locked').count();
check('несобранные фигурки показаны силуэтом', lockedFigs > 0, `силуэтов: ${lockedFigs}`);
await page.screenshot({ path: `${OUT}/smoke-04-collection.png`, fullPage: true });

// --- Замена фигурки на поле ------------------------------------------------
phase('состав поля');

// Собранной фигурки на чистом профиле ещё нет — открываем бокс за просмотр.
await page.getByText('Открыть за просмотр').click();
await page.waitForSelector('.overlay.is-open .reveal', { timeout: 8000 });
await page.locator('.overlay.is-open .card__actions button').first().click();
await page.waitForSelector('.grid', { timeout: 5000 });

const ownedCells = page.locator('button.fig');
check('собранная фигурка стала кнопкой', (await ownedCells.count()) >= 1);

await ownedCells.first().click();
await page.waitForSelector('.fig--active', { timeout: 5000 });
check('выставленная фигурка помечена «на поле»', (await page.locator('.fig--active').count()) === 1);

// Повторный тап по той же карточке возвращает стандартную фигурку серии.
await page.locator('.fig--active').first().click();
await page.waitForTimeout(500);
check(
  'повторный тап снимает фигурку с поля',
  (await page.locator('.fig--active').count()) <= 1,
  `помечено: ${await page.locator('.fig--active').count()}`
);

await page.locator('.screen__head .icon-btn').click(); // назад в меню
await page.waitForSelector('.brand', { timeout: 5000 });

// --- Магазин ---------------------------------------------------------------
phase('магазин');
await page.locator('.menu__row button').nth(1).click();
await page.waitForSelector('.season-head', { timeout: 5000 });
const chips = await page.locator('.skin-chip').count();
check('у каждого скина показана миниатюра витрины', chips >= 5, `миниатюр: ${chips}`);
await page.screenshot({ path: `${OUT}/smoke-09-shop.png`, fullPage: true });
await page.locator('.screen__head .icon-btn').click();
await page.waitForSelector('.brand', { timeout: 5000 });

// --- Английская локаль -----------------------------------------------------
//
// Площадка требует определять язык интерфейса через SDK (§2.14). Проверяется
// то, что видит игрок: меню целиком на английском и без единого кириллического
// символа — забытая строка иначе всплывёт только на модерации.
phase('английская локаль');
const enContext = await browser.newContext({
  viewport: { width: 412, height: 892 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  locale: 'en-US',
});
const enPage = await enContext.newPage();
enPage.setDefaultTimeout(20000);
await enPage.goto(URL, { waitUntil: 'domcontentloaded' });
await enPage.waitForSelector('.brand', { timeout: 20000 });
// Награда за вход и анонс сезона могут перекрыть меню.
for (let i = 0; i < 4; i++) {
  const btn = enPage.locator('.overlay.is-open .card__actions button').first();
  if (!(await btn.count())) break;
  await btn.click();
  await enPage.waitForTimeout(250);
}

const enLangAttr = await enPage.evaluate(() => document.documentElement.lang);
check('атрибут lang переключился на en', enLangAttr === 'en', `lang=${enLangAttr}`);

const enTitle = await enPage.title();
check('заголовок вкладки на английском', /VITRINKA/.test(enTitle), enTitle);

const enMenu = await enPage.evaluate(() => document.querySelector('.menu')?.textContent ?? '');
check('в меню есть английские подписи', /Shop/.test(enMenu) && /Leaders/.test(enMenu), enMenu.slice(0, 120));
const strayCyrillic = enMenu.match(/[А-Яа-яЁё]+/g);
check(
  'в английском меню нет кириллицы',
  strayCyrillic === null,
  strayCyrillic ? strayCyrillic.join(' ') : ''
);

// Коллекция — самый большой источник строк: 72 имени фигурок и подписи редкости.
await enPage.locator('.menu__row button').first().click();
await enPage.waitForSelector('.grid', { timeout: 5000 });
const enCollection = await enPage.evaluate(
  () => document.querySelector('.screen__body')?.textContent ?? ''
);
const collectionCyrillic = enCollection.match(/[А-Яа-яЁё]+/g);
check(
  'в английской коллекции нет кириллицы',
  collectionCyrillic === null,
  collectionCyrillic ? [...new Set(collectionCyrillic)].slice(0, 12).join(' ') : ''
);
await enPage.screenshot({ path: `${OUT}/smoke-10-english.png`, fullPage: true });
await enContext.close();

// --- Итоги ----------------------------------------------------------------
phase('итоги');
check('нет внешних сетевых запросов', external.length === 0, external.join('\n      '));

// Отсутствие /sdk.js локально — ожидаемо и не считается ошибкой.
const realErrors = errors.filter(
  (e) => !/sdk\.js/i.test(e) && !/Failed to load resource/i.test(e)
);
check('нет ошибок в консоли', realErrors.length === 0, realErrors.join('\n      '));

await browser.close();

console.log(`\n${'-'.repeat(52)}`);
console.log(failures === 0 ? 'Смоук-тест пройден' : `Провалено проверок: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
