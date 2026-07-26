/**
 * Точка входа.
 *
 * Порядок здесь важен и продиктован платформой: сначала поднимается SDK
 * (с таймаутом и падением в режим заглушки), потом стартует игра, и только
 * когда она реально готова к вводу — вызывается LoadingAPI.ready() внутри
 * App.start. Ранний ready() модерация считает ошибкой, а поздний портит
 * метрику загрузки.
 */

import './ui/styles.css';
import { App } from './app';
import { initPlatform } from './platform/sdk';

async function boot(): Promise<void> {
  const root = document.getElementById('app');
  if (!root) throw new Error('нет #app в разметке');

  const platform = await initPlatform();
  const app = new App(platform);
  await app.start(root);

  // Покупки, оплаченные, но не выданные (игра закрылась между оплатой и
  // начислением), забираются после старта — на старт они не влияют.
  void app.redeemPendingPurchases();
}

boot().catch((error) => {
  console.error('игра не запустилась', error);
  // Показываем причину, а не бесконечный загрузчик: молчаливо висящий
  // прелоадер — худший из возможных исходов и для игрока, и для модерации.
  const boot = document.getElementById('boot');
  if (boot) {
    boot.classList.remove('hide');
    boot.innerHTML =
      '<div style="text-align:center;font-family:-apple-system,BlinkMacSystemFont,' +
      "'Segoe UI',Roboto,sans-serif;color:#fff;padding:24px\">" +
      '<div style="font-size:44px;font-weight:900;letter-spacing:.14em;margin-bottom:14px">DROP</div>' +
      '<div style="opacity:.7;font-size:14px;line-height:1.5">Не удалось загрузить игру.<br>' +
      'Обновите страницу.</div></div>';
  }
});
