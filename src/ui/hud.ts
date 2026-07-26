/**
 * Игровой HUD: статистика сверху, инструменты снизу.
 *
 * Кнопки внизу — это поводы для rewarded (план, §8). Каждая показывает, чем
 * именно за неё платят: цифра — есть бесплатный заряд, значок ▶ — потребуется
 * ролик. Игрок должен видеть цену до нажатия, иначе первый же неожиданный
 * ролик подрывает доверие ко всем остальным.
 *
 * В соревновательных режимах (вызов дня, блиц) покупных инструментов нет
 * вовсе — см. isCompetitive в src/meta/profile.ts. Кнопки не «выключаются»,
 * а убираются: выключенная кнопка читается как «пока недоступно» и заставляет
 * игрока тыкать в неё, ища условие.
 */

import { add, el, formatNumber, iconButton } from './dom';

export interface HudActions {
  onBack(): void;
  onHint(): void;
  onUndo(): void;
  onExtraShelf(): void;
  onToggleSound(): void;
}

export interface HudState {
  /** Заголовок слева от статистики: «Уровень 42», «Блиц», «Вызов дня». */
  title: string;
  moves: number;
  /** Оптимум по солверу. 0 — не показывать. */
  minMoves: number;
  coins: number;
  /** Закрыто витрин из общего числа видов. */
  closed: number;
  total: number;
  /** Осталось секунд в блице; null — режим без таймера. */
  seconds: number | null;
  /** Бесплатных подсказок. 0 — кнопка предложит ролик. */
  hints: number;
  canUndo: boolean;
  muted: boolean;
  /** Идёт анимация хода или показ рекламы — инструменты недоступны. */
  busy: boolean;
  /**
   * Режим кормит лидерборд: покупные за рекламу инструменты скрыты, а
   * подсказка работает только из накопленных зарядов.
   */
  competitive: boolean;
}

export class Hud {
  readonly root = el('div', 'ui');

  private readonly titleEl = el('b');
  private readonly movesEl = el('b');
  private readonly movesLabel = el('span', undefined, { text: 'ходов' });
  private readonly progressEl = el('b');
  private readonly coinsEl = el('span', 'coins');
  private readonly timerEl = el('div', 'timer');
  private readonly timerWrap = el('div', 'hud__stat');

  private readonly hintBtn: HTMLButtonElement;
  private readonly undoBtn: HTMLButtonElement;
  private readonly shelfBtn: HTMLButtonElement;
  private readonly soundBtn: HTMLButtonElement;

  private readonly hintBadge = el('i', 'icon-btn__badge');
  private readonly undoBadge = el('i', 'icon-btn__badge');
  private readonly shelfBadge = el('i', 'icon-btn__badge icon-btn__badge--ad', { text: '▶' });

  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(actions: HudActions) {
    const top = el('div', 'hud');

    const back = iconButton('‹', 'В меню', 'icon-btn', actions.onBack);

    const levelStat = el('div', 'hud__stat');
    add(levelStat, this.titleEl, el('span', undefined, { text: 'витрина' }));

    const movesStat = el('div', 'hud__stat');
    add(movesStat, this.movesEl, this.movesLabel);

    const progressStat = el('div', 'hud__stat');
    add(progressStat, this.progressEl, el('span', undefined, { text: 'собрано' }));

    add(this.timerWrap, this.timerEl, el('span', undefined, { text: 'секунд' }));

    this.soundBtn = iconButton('🔊', 'Звук', 'icon-btn', actions.onToggleSound);

    add(
      top,
      back,
      levelStat,
      movesStat,
      progressStat,
      this.timerWrap,
      el('div', 'hud__spacer'),
      this.coinsEl,
      this.soundBtn
    );

    // Инструменты. Иконки, а не подписи: три текстовые кнопки в ряд не влезают
    // на узкий телефон, а смысл каждой закрепляется значком цены.
    this.hintBtn = iconButton('💡', 'Подсказка', 'icon-btn', actions.onHint);
    this.undoBtn = iconButton('↺', 'Отменить ход', 'icon-btn', actions.onUndo);
    this.shelfBtn = iconButton('＋', 'Добавить свободную витрину', 'icon-btn', actions.onExtraShelf);
    this.hintBtn.appendChild(this.hintBadge);
    this.undoBtn.appendChild(this.undoBadge);
    this.shelfBtn.appendChild(this.shelfBadge);

    const bottom = el('div', 'hud__actions');
    add(bottom, this.hintBtn, this.undoBtn, this.shelfBtn);

    add(this.root, top, el('div', 'hud__spacer'), bottom);
  }

  update(state: HudState): void {
    this.titleEl.textContent = state.title;
    this.movesEl.textContent = String(state.moves);
    // Оптимум показывается как ориентир, а не как приговор: игрок видит, к
    // чему стремиться, но перебор ходов не блокирует прохождение.
    this.movesLabel.textContent = state.minMoves > 0 ? `из ~${state.minMoves}` : 'ходов';
    this.progressEl.textContent = `${state.closed}/${state.total}`;
    this.coinsEl.textContent = formatNumber(state.coins);

    if (state.seconds === null) {
      this.timerWrap.style.display = 'none';
    } else {
      this.timerWrap.style.display = '';
      this.timerEl.textContent = String(Math.max(0, Math.ceil(state.seconds)));
      this.timerEl.classList.toggle('timer--urgent', state.seconds <= 10);
    }

    // Отмена хода и свободная витрина покупаются только за ролик, поэтому в
    // соревновательных режимах их просто нет.
    this.undoBtn.style.display = state.competitive ? 'none' : '';
    this.shelfBtn.style.display = state.competitive ? 'none' : '';

    // Подсказка: бесплатный заряд или ролик. В соревновательном режиме
    // добрать её роликом нельзя — остаются только накопленные заряды.
    if (state.hints > 0) {
      this.hintBadge.textContent = String(state.hints);
      this.hintBadge.className = 'icon-btn__badge';
    } else if (state.competitive) {
      this.hintBadge.textContent = '0';
      this.hintBadge.className = 'icon-btn__badge icon-btn__badge--empty';
    } else {
      this.hintBadge.textContent = '▶';
      this.hintBadge.className = 'icon-btn__badge icon-btn__badge--ad';
    }

    // Отмена всегда за ролик: бесплатная отмена обнуляет цену ошибки, и
    // вместе с ней — смысл подсказок и «+1 витрины».
    this.undoBadge.textContent = '▶';
    this.undoBadge.className = 'icon-btn__badge icon-btn__badge--ad';

    // Пока идёт анимация хода или показ рекламы, инструменты недоступны:
    // подсказка посреди летящей фигурки рассинхронизировала бы поле.
    this.undoBtn.disabled = !state.canUndo || state.busy;
    this.hintBtn.disabled = state.busy || (state.competitive && state.hints <= 0);
    this.shelfBtn.disabled = state.busy;

    this.soundBtn.textContent = state.muted ? '🔇' : '🔊';
    this.soundBtn.setAttribute('aria-label', state.muted ? 'Включить звук' : 'Выключить звук');
  }

  /** Короткое сообщение внизу экрана: «Не хватает монет», «Ролик не загрузился». */
  toast(message: string): void {
    const existing = this.root.querySelector('.toast');
    existing?.remove();
    if (this.toastTimer) clearTimeout(this.toastTimer);

    const node = el('div', 'toast', { text: message });
    this.root.appendChild(node);
    requestAnimationFrame(() => node.classList.add('is-open'));
    this.toastTimer = setTimeout(() => {
      node.classList.remove('is-open');
      setTimeout(() => node.remove(), 240);
    }, 2200);
  }

  destroy(): void {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.root.remove();
  }
}
