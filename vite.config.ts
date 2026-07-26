import { defineConfig } from 'vite';

/**
 * Vite по умолчанию ставит crossorigin на модульный скрипт входной точки.
 * Яндекс Игры раздают загруженную игру с CDN-поддомена без заголовка
 * Access-Control-Allow-Origin — с crossorigin браузер молча блокирует
 * выполнение модуля, и игра не запускается вообще. На localhost всё
 * same-origin, поэтому баг не проявляется при локальной разработке.
 */
function stripCrossorigin() {
  return {
    name: 'strip-crossorigin',
    transformIndexHtml(html: string) {
      return html.replace(/\s+crossorigin(="[^"]*")?/g, '');
    },
  };
}

export default defineConfig({
  // Яндекс Игры раздают игру из подкаталога — все пути должны быть относительными.
  base: './',
  plugins: [stripCrossorigin()],
  build: {
    target: 'es2018',
    // Уровни и SVG-темы инлайнятся в бандл: ноль сетевых запросов после старта.
    assetsInlineLimit: 16384,
    chunkSizeWarningLimit: 1600,
    // modulePreload добавляет <link rel=modulepreload crossorigin> — те же
    // проблемы с CORS на CDN площадки, что и у crossorigin на скрипте.
    modulePreload: false,
    // Файлы из подпапки dist/assets/ стабильно 404-ятся на хостинге Яндекса
    // (S3), хотя index.html из корня загружается нормально. Кладём бандл
    // прямо в корень dist/.
    assetsDir: '',
    rollupOptions: {
      output: {
        // Один JS-файл вместо графа чанков: на мобильном соединении меньше
        // round-trip'ов, и нет ни одного динамического импорта, который мог бы
        // упереться в CORS хостинга.
        inlineDynamicImports: true,
      },
    },
  },
  server: {
    host: true,
    port: 5173,
  },
});
