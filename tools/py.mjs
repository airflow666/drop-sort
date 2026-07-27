/**
 * Запуск Python-скрипта тем интерпретатором, который есть в системе.
 *
 * В npm-скриптах нельзя написать условие по платформе, а имя интерпретатора
 * везде разное: в Linux и macOS это `python3` (просто `python` там может
 * отсутствовать или указывать на Python 2), в Windows — `python` или лаунчер
 * `py -3`, а `python3` в Windows нередко оказывается заглушкой из Microsoft
 * Store, которая вместо запуска открывает магазин.
 *
 * Поэтому кандидаты перебираются по очереди, и берётся первый, который
 * действительно отвечает своей версией.
 *
 * Запуск: node tools/py.mjs <скрипт> [аргументы...]
 */

import { spawnSync } from 'node:child_process';

const CANDIDATES =
  process.platform === 'win32'
    ? [
        ['py', ['-3']],
        ['python', []],
        ['python3', []],
      ]
    : [
        ['python3', []],
        ['python', []],
      ];

function findPython() {
  for (const [command, prefix] of CANDIDATES) {
    const probe = spawnSync(command, [...prefix, '--version'], {
      encoding: 'utf8',
      // shell нужен в Windows: там python и py — это .exe и .bat из PATH,
      // и без оболочки spawn их не всегда находит.
      shell: process.platform === 'win32',
    });
    // Заглушка из Microsoft Store завершается с ошибкой и ничего не печатает —
    // проверяем не только код возврата, но и наличие строки версии.
    const output = `${probe.stdout ?? ''}${probe.stderr ?? ''}`;
    if (probe.status === 0 && /Python 3/.test(output)) {
      return { command, prefix };
    }
  }
  return null;
}

const script = process.argv[2];
if (!script) {
  console.error('Не указан скрипт: node tools/py.mjs <скрипт> [аргументы...]');
  process.exit(2);
}

const python = findPython();
if (!python) {
  console.error(
    'Не найден Python 3. Он нужен только для генерации и проверки уровней —\n' +
      'сама игра собирается без него: npm run build.\n' +
      'Установить: https://www.python.org/downloads/ (в Windows отметьте\n' +
      '«Add python.exe to PATH» при установке).'
  );
  process.exit(1);
}

const result = spawnSync(
  python.command,
  [...python.prefix, script, ...process.argv.slice(3)],
  { stdio: 'inherit', shell: process.platform === 'win32' }
);
process.exit(result.status ?? 1);
