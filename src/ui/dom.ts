/**
 * Помощники для интерфейса.
 *
 * Интерфейс сделан на DOM, а не на Pixi. Причины конкретные:
 *
 *  * Текст. Русский интерфейс в Pixi требует либо растровых шрифтов (лишние
 *    сотни килобайт и мыло на нестандартном DPR), либо BitmapText с полным
 *    покрытием кириллицы. DOM рисует системным шрифтом — ноль байт в сборке
 *    и идеальная резкость на любом экране, что прямо поддерживает бюджет
 *    старта из плана (§7).
 *  * Раскладка. Меню, списки коллекции и таблицы лидеров — это флексбоксы и
 *    гриды, которые в Pixi пришлось бы считать руками.
 *  * Доступность. Кнопки остаются кнопками: фокус, клавиатура, увеличение
 *    шрифта в системе — всё работает само.
 *
 * Canvas отвечает только за игровое поле и фон, где важна анимация.
 */

type Attrs = Record<string, string | number | boolean | undefined>;

/**
 * Создать элемент. `className` пишется как второй аргумент, потому что
 * используется почти всегда; остальное — через attrs.
 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  attrs?: Attrs
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === undefined || value === false) continue;
      if (key === 'text') node.textContent = String(value);
      else if (key === 'html') node.innerHTML = String(value);
      else node.setAttribute(key, String(value));
    }
  }
  return node;
}

/**
 * Добавить детей. Тип параметра — Node, а не выведенный из первого аргумента:
 * иначе `add(box, heading, button)` выводит T по заголовку и отвергает кнопку.
 */
export function add(parent: Node, ...children: Node[]): void {
  for (const child of children) parent.appendChild(child);
}

/**
 * Кнопка с обработчиком.
 *
 * pointerup, а не click: на мобильных браузерах click приходит с задержкой до
 * 300 мс, и интерфейс ощущается вязким. Заодно ставим type=button — иначе
 * кнопка внутри формы отправляла бы её.
 */
export function button(
  label: string,
  className: string,
  onPress: () => void,
  attrs?: Attrs
): HTMLButtonElement {
  const node = el('button', className, { type: 'button', ...attrs });
  node.innerHTML = label;
  let pressed = false;
  node.addEventListener('pointerdown', () => {
    pressed = true;
  });
  node.addEventListener('pointerup', (e) => {
    if (!pressed) return;
    pressed = false;
    e.preventDefault();
    if (node.disabled) return;
    onPress();
  });
  node.addEventListener('pointercancel', () => {
    pressed = false;
  });
  // Клавиатура: pointer-события её не покрывают.
  node.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (!node.disabled) onPress();
    }
  });
  return node;
}

/** Иконка-кнопка для HUD: только символ, с доступным именем. */
export function iconButton(
  symbol: string,
  ariaLabel: string,
  className: string,
  onPress: () => void
): HTMLButtonElement {
  return button(symbol, className, onPress, { 'aria-label': ariaLabel, title: ariaLabel });
}

export function clear(node: Node): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** Число с разделителями разрядов — 1 240 читается лучше, чем 1240. */
export function formatNumber(value: number): string {
  return Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** мм:сс для таймеров восстановления попыток. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Правильная форма слова: 1 фигурка, 2 фигурки, 5 фигурок. */
export function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

/**
 * Показать элемент с анимацией входа. Возвращает функцию скрытия.
 *
 * Анимация ставится классом, а не инлайновым стилем: на слабых устройствах
 * браузер сам решит, что и как композитить, и не будет пересчитывать раскладку.
 */
export function mountOverlay(
  root: HTMLElement,
  content: HTMLElement,
  opts: { dismissible?: boolean; onDismiss?: () => void } = {}
): () => void {
  const backdrop = el('div', 'overlay');
  backdrop.appendChild(content);
  root.appendChild(backdrop);
  // Класс входа ставится следующим кадром, иначе перехода не будет.
  requestAnimationFrame(() => backdrop.classList.add('is-open'));

  const close = () => {
    backdrop.classList.remove('is-open');
    // Ждём конца перехода, но не полагаемся на событие: если анимации
    // отключены системно, transitionend не придёт вообще.
    setTimeout(() => backdrop.remove(), 260);
  };

  if (opts.dismissible) {
    backdrop.addEventListener('pointerdown', (e) => {
      if (e.target === backdrop) {
        close();
        opts.onDismiss?.();
      }
    });
  }
  return close;
}

/** Применить палитру сезона к CSS-переменным — весь интерфейс перекрашивается. */
export function applyThemeVars(theme: {
  bgTop: string;
  bgBottom: string;
  accent: string;
  accentAlt: string;
  frame: string;
  glass: string;
}): void {
  const root = document.documentElement;
  root.style.setProperty('--bg-top', theme.bgTop);
  root.style.setProperty('--bg-bottom', theme.bgBottom);
  root.style.setProperty('--accent', theme.accent);
  root.style.setProperty('--accent-alt', theme.accentAlt);
  root.style.setProperty('--frame', theme.frame);
  root.style.setProperty('--glass', theme.glass);
}
