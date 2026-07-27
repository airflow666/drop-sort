/**
 * Упаковка dist/ в архив для консоли разработчика Яндекс Игр.
 *
 * ── Почему свой упаковщик, а не `zip` ─────────────────────────────────────
 * Прежний скрипт был цепочкой `rm -f … && cd dist && zip -qr … && unzip -l …`
 * и не работал в Windows: ни `rm`, ни `zip`, ни `unzip` в CMD нет, а
 * PowerShell-аналог `Compress-Archive` в версии 5.1 (та, что стоит в системе
 * по умолчанию) записывает во внутренние пути обратные слэши — такой архив
 * часть распаковщиков читает как один файл с длинным именем вместо дерева.
 *
 * Здесь формат ZIP пишется напрямую. Зависимостей ноль (deflate и CRC уже есть
 * в стандартной библиотеке Node), поведение одинаково на Windows, macOS и
 * Linux, а разделитель во внутренних путях гарантированно прямой слэш — как
 * того требует спецификация ZIP.
 *
 * Архив всегда создаётся заново. `zip` по умолчанию ДОПИСЫВАЕТ в существующий
 * файл, и из-за этого в архив копились бандлы прошлых сборок: имена содержат
 * хеш, поэтому старые не перезаписывались, а накапливались.
 *
 * Запуск: npm run zip
 */

import { deflateRawSync } from 'node:zlib';
import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const DIST = 'dist';
const OUT = 'vitrinka.zip';

// --- CRC-32 ----------------------------------------------------------------
// Тот же полином, что в ZIP и PNG. Таблица строится один раз.
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buffer[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

// --- Дата в формате MS-DOS -------------------------------------------------
// ZIP хранит время в упаковке 1980-х годов: секунды с шагом 2, год от 1980.
function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

// --- Обход dist ------------------------------------------------------------
function walk(dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (entry.isFile()) acc.push(full);
  }
  return acc;
}

let files;
try {
  files = walk(DIST).sort();
} catch {
  console.error(`Нет папки ${DIST}/ — сначала соберите игру: npm run build`);
  process.exit(1);
}

if (files.length === 0) {
  console.error(`В ${DIST}/ нет файлов — сборка не удалась?`);
  process.exit(1);
}

// index.html обязан лежать в корне архива, иначе площадка сборку не примет.
const hasIndex = files.some((f) => relative(DIST, f) === 'index.html');
if (!hasIndex) {
  console.error(`В корне ${DIST}/ нет index.html — площадка такую сборку не примет`);
  process.exit(1);
}

// --- Сборка архива ---------------------------------------------------------
const locals = [];
const central = [];
let offset = 0;

for (const file of files) {
  // Разделитель во внутренних путях всегда прямой слэш, включая Windows.
  const name = Buffer.from(relative(DIST, file).split(sep).join('/'), 'utf8');
  const raw = readFileSync(file);
  const deflated = deflateRawSync(raw, { level: 9 });

  // Если сжатие не помогло (уже сжатый PNG, крошечный файл) — кладём как есть.
  const compressed = deflated.length < raw.length;
  const body = compressed ? deflated : raw;
  const method = compressed ? 8 : 0;

  const crc = crc32(raw);
  const { time, date } = dosDateTime(statSync(file).mtime);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); // сигнатура локального заголовка
  local.writeUInt16LE(20, 4); // минимальная версия для распаковки
  local.writeUInt16LE(0, 6); // флаги
  local.writeUInt16LE(method, 8);
  local.writeUInt16LE(time, 10);
  local.writeUInt16LE(date, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(body.length, 18);
  local.writeUInt32LE(raw.length, 22);
  local.writeUInt16LE(name.length, 26);
  local.writeUInt16LE(0, 28); // extra
  locals.push(local, name, body);

  const dir = Buffer.alloc(46);
  dir.writeUInt32LE(0x02014b50, 0); // сигнатура записи каталога
  dir.writeUInt16LE(20, 4); // версия создателя
  dir.writeUInt16LE(20, 6); // минимальная версия для распаковки
  dir.writeUInt16LE(0, 8);
  dir.writeUInt16LE(method, 10);
  dir.writeUInt16LE(time, 12);
  dir.writeUInt16LE(date, 14);
  dir.writeUInt32LE(crc, 16);
  dir.writeUInt32LE(body.length, 20);
  dir.writeUInt32LE(raw.length, 24);
  dir.writeUInt16LE(name.length, 28);
  dir.writeUInt16LE(0, 30); // extra
  dir.writeUInt16LE(0, 32); // комментарий
  dir.writeUInt16LE(0, 34); // номер диска
  dir.writeUInt16LE(0, 36); // внутренние атрибуты
  dir.writeUInt32LE(0, 38); // внешние атрибуты
  dir.writeUInt32LE(offset, 42); // смещение локального заголовка
  central.push(dir, name);

  offset += local.length + name.length + body.length;
}

const centralBuffer = Buffer.concat(central);

const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0); // сигнатура конца каталога
end.writeUInt16LE(0, 4); // номер диска
end.writeUInt16LE(0, 6); // диск с началом каталога
end.writeUInt16LE(files.length, 8); // записей на этом диске
end.writeUInt16LE(files.length, 10); // записей всего
end.writeUInt32LE(centralBuffer.length, 12);
end.writeUInt32LE(offset, 16);
end.writeUInt16LE(0, 20); // длина комментария

// Старый архив удаляется, а не дополняется.
rmSync(OUT, { force: true });
writeFileSync(OUT, Buffer.concat([...locals, centralBuffer, end]));

// --- Отчёт -----------------------------------------------------------------
// Печатаем содержимое, чтобы лишние файлы были видны сразу и без распаковщика.
const total = files.reduce((sum, f) => sum + statSync(f).size, 0);
const archive = statSync(OUT).size;
const kb = (bytes) => `${(bytes / 1024).toFixed(1)} КБ`;

console.log(`${OUT} — ${files.length} ${files.length === 1 ? 'файл' : 'файлов'}, ${kb(archive)}`);
for (const file of files) {
  const name = relative(DIST, file).split(sep).join('/');
  console.log(`  ${kb(statSync(file).size).padStart(10)}  ${name}`);
}
console.log(`  ${kb(total).padStart(10)}  всего до сжатия`);
