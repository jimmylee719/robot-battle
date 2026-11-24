/** 用 Web Audio API 即時合成所有音效，不需要任何音檔。 */
import type { SoundId, SoundOptions, SoundPlayer } from './sound';

type Wave = OscillatorType;

export class SynthPlayer implements SoundPlayer {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private out: AudioNode | null = null;
  muted = false;

  unlock(): void {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      const master = ctx.createGain();
      master.gain.value = this.muted ? 0 : 0.5;
      // 壓縮器：很多聲音疊在一起時不會爆音
      const comp = ctx.createDynamicsCompressor();
      master.connect(comp).connect(ctx.destination);
      const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      this.ctx = ctx;
      this.master = master;
      this.noiseBuf = buf;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 0.5;
  }

  /** 一個會滑音、會衰減的振盪器 */
  private tone(wave: Wave, f0: number, f1: number, dur: number, vol: number, delay = 0): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = wave;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(this.out!);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  /** 一段經過濾波、濾波頻率會滑動的雜訊 */
  private noise(
    type: BiquadFilterType,
    f0: number,
    f1: number,
    dur: number,
    vol: number,
    delay = 0,
    q = 1,
  ): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(f0, t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(10, f1), t + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(gain).connect(this.out!);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  play(id: SoundId, opts: SoundOptions = {}): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.muted || ctx.state !== 'running') return;

    // 每個音效自己一條音量 + 左右聲道，播完就丟
    const bus = ctx.createGain();
    bus.gain.value = opts.volume ?? 1;
    if (ctx.createStereoPanner) {
      const pan = ctx.createStereoPanner();
      pan.pan.value = Math.max(-1, Math.min(1, opts.pan ?? 0));
      bus.connect(pan).connect(this.master);
    } else {
      bus.connect(this.master);
    }
    this.out = bus;

    switch (id) {
      case 'jab':
        this.noise('bandpass', 1900, 500, 0.07, 0.7);
        this.tone('sine', 190, 70, 0.09, 0.7);
        break;
      case 'heavy':
        this.noise('lowpass', 2600, 180, 0.24, 1);
        this.tone('sine', 130, 34, 0.32, 1);
        this.tone('square', 95, 40, 0.12, 0.35);
        break;
      case 'block':
        this.tone('square', 920, 880, 0.07, 0.25);
        this.tone('square', 1370, 1300, 0.09, 0.2);
        this.noise('highpass', 3000, 2000, 0.04, 0.4);
        break;
      case 'whiff':
        this.noise('bandpass', 500, 1700, 0.12, 0.22, 0, 2);
        break;
      case 'down':
        this.noise('lowpass', 900, 70, 0.5, 1);
        this.tone('sine', 85, 28, 0.5, 1);
        for (let i = 0; i < 4; i++) this.noise('bandpass', 2400 - i * 300, 1200, 0.05, 0.4, 0.12 + i * 0.09, 3);
        break;
      case 'ko':
        this.noise('lowpass', 3200, 50, 1.3, 1);
        this.tone('sine', 70, 20, 1.1, 1);
        this.tone('sawtooth', 220, 30, 0.6, 0.3);
        for (let i = 0; i < 6; i++) this.noise('bandpass', 1800, 600, 0.06, 0.5, 0.2 + i * 0.13, 2);
        break;
      case 'dash':
        this.noise('bandpass', 300, 2600, 0.3, 0.5, 0, 2);
        this.tone('sawtooth', 80, 240, 0.25, 0.15);
        break;
      case 'cage':
        this.tone('square', 2400, 2200, 0.12, 0.12);
        this.tone('square', 3170, 2900, 0.16, 0.1);
        this.tone('square', 1730, 1650, 0.2, 0.1, 0.03);
        this.noise('highpass', 4000, 2500, 0.18, 0.25);
        break;
      case 'count':
        this.tone('square', 660, 660, 0.09, 0.3);
        break;
      case 'bell':
        this.bell(0);
        break;
      case 'crowd':
        // 一大片人聲：兩層濾過的雜訊，慢慢淡掉
        this.noise('bandpass', 700, 1100, 1.6, 0.35, 0, 0.6);
        this.noise('bandpass', 1600, 900, 1.2, 0.2, 0.05, 0.8);
        break;
      case 'boo':
        // 噓聲：低沉、抖動的人聲雜訊，加兩個往下掉的「嗚」
        this.noise('bandpass', 380, 260, 1.5, 0.4, 0, 2.5);
        this.noise('bandpass', 520, 330, 1.3, 0.2, 0.08, 2);
        this.tone('sawtooth', 150, 118, 1.2, 0.035);
        this.tone('sawtooth', 163, 124, 1.1, 0.03, 0.06);
        break;
      case 'laugh':
        // 爆笑：一串「哈」（短促的中高頻雜訊），兩群人錯開笑
        for (let i = 0; i < 7; i++) {
          this.noise('bandpass', 1250, 950, 0.09, 0.42 - i * 0.04, i * 0.12, 3);
          this.noise('bandpass', 900, 700, 0.08, 0.3 - i * 0.03, 0.06 + i * 0.13, 3);
        }
        this.noise('bandpass', 800, 600, 1.3, 0.12, 0, 0.8);
        break;
      case 'ooh':
        // 「喔～」：先往上再往下的母音，加一層人聲
        this.tone('sine', 230, 330, 0.35, 0.12);
        this.tone('sine', 330, 210, 0.6, 0.1, 0.33);
        this.noise('bandpass', 500, 850, 0.4, 0.28, 0, 4);
        this.noise('bandpass', 850, 420, 0.7, 0.22, 0.38, 4);
        break;
      case 'crank':
        // 喀啦喀啦：一串短促的齒輪聲
        for (let i = 0; i < 6; i++) this.noise('bandpass', 2600, 1800, 0.03, 0.35, i * 0.07, 4);
        this.tone('square', 180, 120, 0.4, 0.06);
        break;
      case 'pop':
        this.tone('sine', 520, 1250, 0.09, 0.5);
        this.noise('highpass', 3500, 2500, 0.05, 0.25);
        break;
      case 'rare':
        // 上行的亮晶晶琶音
        [784, 988, 1175, 1568, 1976].forEach((f, i) => this.tone('triangle', f, f, 0.35, 0.28, i * 0.07));
        this.tone('sine', 2637, 2637, 0.8, 0.12, 0.35);
        break;
      case 'end':
        this.bell(0);
        this.bell(0.2);
        this.bell(0.4);
        break;
    }
    this.out = null;
  }

  private bell(delay: number): void {
    this.tone('sine', 880, 876, 1.2, 0.5, delay);
    this.tone('sine', 1322, 1318, 0.9, 0.3, delay);
    this.tone('sine', 2217, 2210, 0.6, 0.2, delay);
    this.tone('square', 2640, 2630, 0.08, 0.08, delay);
  }
}
