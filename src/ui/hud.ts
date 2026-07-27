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
 *
 * ── Сколько показателей помещается в строку ───────────────────────────────
 * Ровно три плюс монеты. Раньше в блице их было четыре — витрина, ходы,
 * собрано и таймер, — и вместе с кнопкой «назад», пилюлей монет и звуком
 * строка требовала около 520 пикселей: на телефоне шириной 390 монеты
 * обрезались, а кнопка звука уезжала за экран целиком.
 *
 * Лишним оказался не таймер, а связка «витрина + ходы»: в забеге на время
 * номер уровня не значит ничего (уровни идут потоком), а число ходов не
 * влияет ни на очки, ни на место в таблице. Вместо них показываются очки —
 * то единственное, за что в блице идёт борьба и чего в HUD не было вовсе:
 * свой счёт игрок впервые видел только на экране итога.
 */

import { add, el, iconButton } from './dom';
import { formatNumber, t } from '../i18n';

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
  /** Очки забега; null — режим без счёта (кампания, вызов дня). */
  score: number | null;
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

  // Плашки помечены data-stat: состав строки зависит от режима, поэтому
  // адресоваться к ним по порядку нельзя — смоук-тест на этом уже ломался,
  // причём молча, показывая пустое значение вместо ошибки селектора.
  private readonly titleEl = el('b');
  private readonly titleWrap = el('div', 'hud__stat', { 'data-stat': 'title' });
  private readonly movesEl = el('b');
  private readonly movesLabel = el('span', undefined, { text: t('hud.moves') });
  private readonly movesWrap = el('div', 'hud__stat', { 'data-stat': 'moves' });
  private readonly scoreEl = el('b');
  private readonly scoreWrap = el('div', 'hud__stat hud__stat--score', { 'data-stat': 'score' });
  private readonly progressEl = el('b');
  private readonly progressWrap = el('div', 'hud__stat', { 'data-stat': 'progress' });
  private readonly coinsEl = el('span', 'coins');
  private readonly timerEl = el('div', 'timer');
  private readonly timerWrap = el('div', 'hud__stat hud__stat--timer', { 'data-stat': 'timer' });
  private readonly topRow = el('div', 'hud');
  private readonly actionsRow = el('div', 'hud__actions');

  private readonly hintBtn: HTMLButtonElement;
  private readonly undoBtn: HTMLButtonElement;
  private readonly shelfBtn: HTMLButtonElement;
  private readonly soundBtn: HTMLButtonElement;

  private readonly hintBadge = el('i', 'icon-btn__badge');
  private readonly undoBadge = el('i', 'icon-btn__badge');
  private readonly shelfBadge = el('i', 'icon-btn__badge icon-btn__badge--ad', { text: '▶' });

  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(actions: HudActions) {
    const back = iconButton('‹', t('hud.aria.menu'), 'icon-btn', actions.onBack);

    add(this.titleWrap, this.titleEl, el('span', undefined, { text: t('hud.case') }));
    add(this.movesWrap, this.movesEl, this.movesLabel);
    add(this.scoreWrap, this.scoreEl, el('span', undefined, { text: t('hud.points') }));
    add(this.progressWrap, this.progressEl, el('span', undefined, { text: t('hud.collected') }));
    add(this.timerWrap, this.timerEl, el('span', undefined, { text: t('hud.seconds') }));

    this.soundBtn = iconButton('🔊', t('hud.aria.sound'), 'icon-btn', actions.onToggleSound);

    // Показатели собраны в отдельную группу с общим сжатием: если ширины не
    // хватает, ужимается она, а кнопки «назад» и «звук» остаются полного
    // размера — по ним нужно попадать пальцем.
    const stats = el('div', 'hud__stats');
    add(stats, this.titleWrap, this.scoreWrap, this.movesWrap, this.progressWrap, this.timerWrap);

    add(
      this.topRow,
      back,
      stats,
      el('div', 'hud__spacer'),
      this.coinsEl,
      this.soundBtn
    );

    // Инструменты. Иконки, а не подписи: три текстовые кнопки в ряд не влезают
    // на узкий телефон, а смысл каждой закрепляется значком цены.
    this.hintBtn = iconButton('💡', t('hud.aria.hint'), 'icon-btn', actions.onHint);
    this.undoBtn = iconButton('↺', t('hud.aria.undo'), 'icon-btn', actions.onUndo);
    this.shelfBtn = iconButton('＋', t('hud.aria.extraShelf'), 'icon-btn', actions.onExtraShelf);
    this.hintBtn.appendChild(this.hintBadge);
    this.undoBtn.appendChild(this.undoBadge);
    this.shelfBtn.appendChild(this.shelfBadge);

    add(this.actionsRow, this.hintBtn, this.undoBtn, this.shelfBtn);

    add(this.root, this.topRow, el('div', 'hud__spacer'), this.actionsRow);
  }

  /**
   * Сколько вертикали занято сверху и снизу. Поле раскладывается по этим
   * числам, а не по константам: высота HUD зависит от вырезов экрана, размера
   * шрифта в системе и от того, есть ли в режиме кнопки инструментов —
   * в блице их нет вовсе, и поле может занять освободившееся место.
   */
  metrics(): { top: number; bottom: number } {
    const top = this.topRow.getBoundingClientRect().height;
    const bottom = this.actionsRow.getBoundingClientRect().height;
    return {
      top: Math.round(top) + 8,
      bottom: Math.round(bottom) + 8,
    };
  }

  update(state: HudState): void {
    // В блице очки и таймер вытесняют номер витрины и счётчик ходов: ни то,
    // ни другое там ни на что не влияет, а место в строке конечно.
    const timed = state.seconds !== null;
    this.titleWrap.style.display = timed ? 'none' : '';
    this.movesWrap.style.display = timed ? 'none' : '';
    this.scoreWrap.style.display = state.score === null ? 'none' : '';
    this.timerWrap.style.display = timed ? '' : 'none';

    this.titleEl.textContent = state.title;
    this.movesEl.textContent = String(state.moves);
    // Оптимум показывается как ориентир, а не как приговор: игрок видит, к
    // чему стремиться, но перебор ходов не блокирует прохождение.
    this.movesLabel.textContent = state.minMoves > 0 ? t('hud.movesOf', { n: state.minMoves }) : t('hud.moves');
    this.progressEl.textContent = `${state.closed}/${state.total}`;
    this.coinsEl.textContent = formatNumber(state.coins);

    if (state.score !== null) this.scoreEl.textContent = formatNumber(state.score);

    if (state.seconds !== null) {
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
    this.soundBtn.setAttribute(
      'aria-label',
      state.muted ? t('hud.aria.soundOn') : t('hud.aria.soundOff')
    );
  }

  /**
   * Прибавка над показателем: «+40» над очками, «+2 с» над таймером.
   *
   * Награда должна быть видна там, где она начисляется. В блице секунды за
   * закрытый сет уходили в таймер молча — за время забега на цифры никто не
   * смотрит, и бонус, ради которого игрок и торопится, оставался невидимым.
   */
  private pop(host: HTMLElement, text: string, modifier: string): void {
    const node = el('i', `hud__pop hud__pop--${modifier}`, { text });
    host.appendChild(node);
    // Анимация одноразовая, поэтому узел убирается по её окончании, а не по
    // таймеру: так он не переживёт смену экрана и не осядет в DOM.
    node.addEventListener('animationend', () => node.remove());
    setTimeout(() => node.remove(), 1400);
  }

  popScore(delta: number): void {
    if (delta <= 0) return;
    this.pop(this.scoreWrap, `+${delta}`, 'score');
    this.scoreWrap.classList.remove('is-bumped');
    void this.scoreWrap.offsetWidth;
    this.scoreWrap.classList.add('is-bumped');
  }

  popTime(seconds: number): void {
    if (seconds <= 0) return;
    this.pop(this.timerWrap, `+${seconds} с`, 'time');
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
