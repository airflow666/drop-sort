/**
 * Звук — синтезируется через WebAudio, а не грузится файлами.
 *
 * План (§7) предполагал звук в OGG на аутсорсе. Здесь он генерируется кодом,
 * и это не экономия ради экономии, а два конкретных выигрыша:
 *
 *  * Ноль байт в сборке и ноль времени на декодирование. Набор из восьми
 *    коротких OGG — это 60–150 КБ и заметная задержка первого звука на слабом
 *    Android, где декодер просыпается медленно.
 *  * Высота тона может отвечать на состояние игры. Укладка фигурки звучит тем
 *    выше, чем полнее витрина: к четвёртой фигурке нота почти на октаву выше
 *    первой. Это тот самый «сатисфаинг», который планом (§3) запрещено
 *    экономить, и файлами он потребовал бы четырёх отдельных сэмплов на
 *    каждое действие.
 *
 * Контекст создаётся лениво, по первому жесту игрока: браузеры не дают
 * запускать звук до взаимодействия, а преждевременный AudioContext остаётся
 * в состоянии suspended и потом молчит.
 */

export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private muted = false;
  /** Заглушено платформой (реклама, свёрнутая вкладка) — отдельно от muted. */
  private ducked = false;

  constructor(muted = false) {
    this.muted = muted;
  }

  /** Вызывается из обработчика любого пользовательского жеста. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.32;
      this.master.connect(this.ctx.destination);
    } catch {
      // Звука не будет — игра работает молча, это не повод падать.
      this.ctx = null;
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyGain();
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /** Глушение на время рекламы и при сворачивании вкладки. */
  setDucked(ducked: boolean): void {
    this.ducked = ducked;
    this.applyGain();
  }

  private applyGain(): void {
    if (!this.master || !this.ctx) return;
    const target = this.muted || this.ducked ? 0 : 0.32;
    // Плавно, а не рывком: щелчок при мгновенном обнулении слышен.
    this.master.gain.setTargetAtTime(target, this.ctx.currentTime, 0.02);
  }

  private get live(): boolean {
    return Boolean(this.ctx && this.master && !this.muted && !this.ducked);
  }

  /** Одна нота с огибающей. Базовый кирпич для всех звуков. */
  private tone(opts: {
    freq: number;
    duration: number;
    type?: OscillatorType;
    gain?: number;
    delay?: number;
    /** Скольжение частоты к концу ноты — «плюх» или «вжух». */
    slideTo?: number;
    attack?: number;
  }): void {
    if (!this.live) return;
    const ctx = this.ctx!;
    const now = ctx.currentTime + (opts.delay ?? 0);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = opts.type ?? 'sine';
    osc.frequency.setValueAtTime(opts.freq, now);
    if (opts.slideTo) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.slideTo), now + opts.duration);
    }
    const peak = opts.gain ?? 0.5;
    const attack = opts.attack ?? 0.004;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(peak, now + attack);
    // Экспоненциальный спад звучит естественнее линейного.
    gain.gain.exponentialRampToValueAtTime(0.0001, now + opts.duration);
    osc.connect(gain).connect(this.master!);
    osc.start(now);
    osc.stop(now + opts.duration + 0.02);
  }

  /** Короткий шумовой хлопок — призвук стекла и удара. */
  private noise(opts: { duration: number; gain?: number; delay?: number; highpass?: number }): void {
    if (!this.live) return;
    const ctx = this.ctx!;
    const now = ctx.currentTime + (opts.delay ?? 0);
    const length = Math.max(1, Math.floor(ctx.sampleRate * opts.duration));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      // Затухание внутри самого буфера — дешевле, чем ещё один GainNode.
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2.5);
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = opts.gain ?? 0.2;
    if (opts.highpass) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.value = opts.highpass;
      src.connect(filter).connect(gain).connect(this.master!);
    } else {
      src.connect(gain).connect(this.master!);
    }
    src.start(now);
  }

  // --- Звуки игры ---------------------------------------------------------

  /** Подъём фигурки: короткий мягкий блип вверх. */
  lift(): void {
    this.tone({ freq: 440, slideTo: 620, duration: 0.09, type: 'sine', gain: 0.28 });
  }

  /**
   * Укладка фигурки. `fillRatio` (0..1) — насколько полна витрина после хода.
   * Нота растёт вместе с заполнением: слышно, что сет собирается.
   */
  place(fillRatio: number): void {
    const semitones = Math.round(fillRatio * 10);
    const freq = 330 * Math.pow(2, semitones / 12);
    this.tone({ freq, duration: 0.11, type: 'triangle', gain: 0.34 });
    this.noise({ duration: 0.045, gain: 0.09, highpass: 2600 });
  }

  /**
   * Витрина закрылась — защёлкнувшееся стекло (план, §3). Два обертона с
   * быстрым спадом плюс шумовой призвук: именно расстроенная квинта и
   * высокий шум читаются как стекло, а чистая нота — как ксилофон.
   */
  glassClose(): void {
    this.tone({ freq: 1180, duration: 0.5, type: 'sine', gain: 0.3 });
    this.tone({ freq: 1760, duration: 0.34, type: 'sine', gain: 0.16, delay: 0.008 });
    this.tone({ freq: 2640, duration: 0.2, type: 'sine', gain: 0.08, delay: 0.014 });
    this.noise({ duration: 0.1, gain: 0.16, highpass: 4200 });
  }

  /** Комбо: восходящее арпеджио, тем выше, чем длиннее серия. */
  combo(length: number): void {
    const steps = [0, 4, 7, 12, 16, 19];
    const base = 520 * Math.pow(2, Math.min(length - 2, 3) / 12);
    for (let i = 0; i < Math.min(length + 1, steps.length); i++) {
      this.tone({
        freq: base * Math.pow(2, steps[i] / 12),
        duration: 0.2,
        type: 'triangle',
        gain: 0.24,
        delay: i * 0.055,
      });
    }
  }

  /** Недопустимый ход: глухой низкий толчок, без раздражающего зумера. */
  reject(): void {
    this.tone({ freq: 150, slideTo: 96, duration: 0.13, type: 'sine', gain: 0.3 });
  }

  /** Победа на уровне: мажорный аккорд с подъёмом. */
  win(): void {
    [0, 4, 7, 12].forEach((semi, i) =>
      this.tone({
        freq: 392 * Math.pow(2, semi / 12),
        duration: 0.6,
        type: 'triangle',
        gain: 0.22,
        delay: i * 0.075,
      })
    );
  }

  /** Начислены монеты. */
  coin(): void {
    this.tone({ freq: 1050, duration: 0.1, type: 'square', gain: 0.12 });
    this.tone({ freq: 1570, duration: 0.16, type: 'square', gain: 0.09, delay: 0.05 });
  }

  /** Открытие блайнд-бокса: нарастающее напряжение и вспышка на конце. */
  boxOpen(): void {
    this.tone({ freq: 220, slideTo: 880, duration: 0.55, type: 'sawtooth', gain: 0.12 });
    this.noise({ duration: 0.3, gain: 0.1, highpass: 1800, delay: 0.5 });
    [0, 7, 12, 19].forEach((semi, i) =>
      this.tone({
        freq: 523 * Math.pow(2, semi / 12),
        duration: 0.7,
        type: 'triangle',
        gain: 0.2,
        delay: 0.56 + i * 0.06,
      })
    );
  }

  /** Нажатие кнопки интерфейса. */
  tap(): void {
    this.tone({ freq: 660, duration: 0.05, type: 'sine', gain: 0.16 });
  }

  /** Тиканье последних секунд блица. */
  tick(urgent: boolean): void {
    this.tone({
      freq: urgent ? 900 : 700,
      duration: 0.06,
      type: 'square',
      gain: urgent ? 0.18 : 0.1,
    });
  }
}

/**
 * Тактильная отдача (план, §3). Vibration API есть только на Android-браузерах;
 * на iOS его нет вовсе, поэтому вызовы просто ничего не делают — проверять
 * платформу отдельно смысла нет.
 */
export class Haptics {
  private enabled: boolean;

  constructor(enabled = true) {
    this.enabled = enabled && typeof navigator !== 'undefined' && 'vibrate' in navigator;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled && typeof navigator !== 'undefined' && 'vibrate' in navigator;
  }

  private buzz(pattern: number | number[]): void {
    if (!this.enabled) return;
    try {
      navigator.vibrate(pattern);
    } catch {
      /* заблокировано настройками — не наша забота */
    }
  }

  /** Укладка фигурки: едва заметный тик. Длиннее — и это уже раздражает. */
  place(): void {
    this.buzz(12);
  }

  /** Закрытие витрины — заметнее, это награда. */
  close(): void {
    this.buzz([18, 30, 26]);
  }

  /** Комбо. */
  combo(): void {
    this.buzz([14, 20, 14, 20, 30]);
  }

  /** Недопустимый ход. */
  reject(): void {
    this.buzz(24);
  }
}
