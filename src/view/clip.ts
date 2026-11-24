/**
 * 分享短影片（純畫面）：用同一個種子重跑精華片段，畫成 9:16 直式畫面錄下來。
 *  - 上方：雙方名字和大腦型號；中間：戰鬥畫面；下方：大字幕；片尾 1 秒：遊戲名稱和網址
 *  - 用自己的渲染器、特效、導播和比賽物件，不碰正在玩的那一場（重跑的結果和原本那場一樣）
 *  - 錄影：canvas.captureStream() + MediaRecorder。Safari 盡量出 mp4，Chrome 出 webm；
 *    瀏覽器不支援就只出一張截圖（再加上重播連結）
 * 影片是即時錄的：10 秒的片要真的播 10 秒多。沒有聲音（音效是即時合成的，沒有接進錄影）。
 */
import type { SoundPlayer } from '../audio/sound';
import { Renderer } from '../render/renderer';
import { BRAINS } from '../sim/cards';
import { createMatch, stepMatch, TICK_HZ, type Match, type RobotSetup } from '../sim/match';
import { Crowd } from './crowd';
import { Director } from './director';
import { Fx } from './fx';
import { pickHighlights, type Clip, type Highlights } from './highlights';
import type { Hud } from './hud';
import { bubbleLine, misfireVars, showKind, type ShowKind } from './misfire';
import { drawScene, type SceneModels } from './scene';
import { ShowRng } from './showRng';

export const CLIP_W = 720;
export const CLIP_H = 1280;
/** 戰鬥畫面：360×400 的緩衝區放大兩倍，放在 y = 200 */
const BW = 360;
const BH = 400;
const TOP = 200;
const SCALE = 2;
const FPS = 30;
const OUTRO_FRAMES = FPS;
const RES = BW / 320;

export interface ClipInput {
  seed: number;
  setups: [RobotSetup, RobotSetup];
  /** 場上的模型（和這一場的裝備、外觀一樣） */
  models: SceneModels;
  /** 看別人分享的重播：字幕用機器人名字，不說「我的」 */
  spectate: boolean;
  /** 每日挑戰打贏：用了幾點的配法 */
  dailyCost: number | null;
  /** 片尾的網址 */
  url: string;
}

export interface ClipResult {
  /** 影片（瀏覽器不支援錄影時是 null） */
  video: Blob | null;
  mime: string;
  /** 重點那一刻的截圖 */
  poster: Blob | null;
  /** 第一段的字幕，分享文字用 */
  caption: string;
}

/** 這個瀏覽器能錄成什麼格式（不能錄就是 null） */
export function recordMime(): string | null {
  if (typeof MediaRecorder === 'undefined' || typeof HTMLCanvasElement.prototype.captureStream !== 'function') return null;
  const list = ['video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  return list.find((t) => MediaRecorder.isTypeSupported(t)) ?? null;
}

const MUTE: SoundPlayer = { unlock() {}, play() {}, setMuted() {}, muted: true };

/** 導播會叫 HUD 跳橫幅：錄影時把橫幅文字接下來畫進影片，其他的都不做 */
function stubHud(onBanner: (text: string, sec: number) => void): Hud {
  return new Proxy({} as Hud, {
    get: (_t, key) => (key === 'banner' ? (text: string, sec = 1) => onBanner(text, sec) : () => undefined),
  });
}

function shortName(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts[parts.length - 1];
}

/** 字幕：每種片段兩三句，用演出亂數挑 */
const MISFIRE_CAP: Record<ShowKind, string[]> = {
  air: ['{own} {b} 以為{p}叫它「{got}」', '{p}說「{do}」，{own} {b} 聽成「{got}」', '{own} {b} 正在和空氣決鬥'],
  spam: ['{p}只說了一次重拳，{own} {b} 停不下來', '{own} {b}：重拳！重拳！還要更多重拳！', '「{do}」被 {own} {b} 執行了一百次'],
  turtle: ['{own} {b} 以為防守就是不要看對手', '{p}說「{do}」，{own} {b} 轉過身去抱頭'],
  wrongway: ['{p}叫它閃開，{own} {b} 閃進對手懷裡', '{own} {b} 的導航需要更新'],
  statue: ['{own} {b} 以為{p}叫它當雕像', '{p}說「{do}」，{own} {b} 選擇站著'],
  noWhen: ['{own} {b} 看不懂「什麼時候」，直接「{got}」', '時機？{own} {b} 不需要時機'],
  noNever: ['{p}說「絕不後退」，{own} {b} 只看到「後退」', '{own} {b} 把「絕不」當成「一定要」'],
  mixWho: ['{own} {b} 以為快撐不住的是自己', '{own} {b} 搞不清楚誰是誰'],
  slow: ['{own} {b}：看到了、想到了、然後被打到了', '{own} {b} 慢了半拍'],
};

const LABEL: Record<Clip['kind'], string> = {
  misfire: '🤡 大腦失誤',
  ko: '💥 K.O.',
  buzzer: '⏱ 讀秒絕殺',
  comeback: '🔄 絕地反殺',
  heavy: '👊 重拳',
};

function fill(t: string, v: Record<string, string>): string {
  return t.replace(/\{(\w+)\}/g, (_, k: string) => v[k] ?? '');
}

/** 一段的字幕 */
export function clipCaption(c: Clip, setups: [RobotSetup, RobotSetup], spectate: boolean, rng: ShowRng): string {
  rng.at(c.at);
  const names = setups.map((s) => shortName(s.name));
  const who = (side: number): string => (spectate ? names[side] : side === 0 ? '我的機器人' : '對手');
  if (c.kind === 'misfire' && c.misfire) {
    const e = c.misfire;
    const v = misfireVars(e, setups[e.robot].name);
    const own = spectate ? `${names[e.robot]} 的` : e.robot === 0 ? '我的' : '對手的';
    const p = !spectate && e.robot === 0 ? '我' : '主人';
    return fill(rng.pick(MISFIRE_CAP[showKind(e.kind, e.actual)]), { ...v, own, p });
  }
  const w = c.winner ?? 0;
  if (c.kind === 'buzzer') return `最後幾秒，${who(w)}絕殺！`;
  if (c.kind === 'comeback') return `只剩 ${Math.round((c.low ?? 0) * 100)}% 血，${who(w)}反殺！`;
  if (c.kind === 'ko') return `${who(w)} ${c.method === 'TKO' ? 'TKO' : 'K.O.'} 擊倒${who(1 - w)}！`;
  return `${who(c.attacker ?? 0)}這一拳打掉 ${Math.round(c.damage ?? 0)} 點血`;
}

/** 把一段文字照寬度斷行：中文一個字一個字斷，英文單字和數字（像 Autofill 1.0）不拆開 */
function wrap(ctx: CanvasRenderingContext2D, text: string, max: number): string[] {
  const out: string[] = [];
  let line = '';
  const tokens = text.match(/[A-Za-z0-9][A-Za-z0-9.+\-]*|\s+|./gsu) ?? [];
  for (const tok of tokens) {
    if (ctx.measureText(line + tok).width > max && line.trim()) {
      out.push(line.trimEnd());
      line = tok.trimStart();
    } else line += tok;
  }
  if (line.trim()) out.push(line.trimEnd());
  return out;
}

export class ClipMaker {
  private cancelled = false;
  readonly canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private font: string;

  constructor() {
    this.canvas.width = CLIP_W;
    this.canvas.height = CLIP_H;
    this.ctx = this.canvas.getContext('2d')!;
    this.font = getComputedStyle(document.body).getPropertyValue('--round').trim() || 'sans-serif';
  }

  cancel(): void {
    this.cancelled = true;
  }

  /** 挑片段、重跑、錄影。onProgress 給 0..1 */
  async make(input: ClipInput, onProgress: (p: number) => void): Promise<ClipResult | null> {
    const hl: Highlights = pickHighlights(input.seed, input.setups);
    const rng = new ShowRng();
    rng.reset(input.seed);
    const captions = hl.clips.map((c) => clipCaption(c, input.setups, input.spectate, rng));
    const mime = recordMime();
    let recorder: MediaRecorder | null = null;
    const chunks: Blob[] = [];
    if (mime) {
      const stream = this.canvas.captureStream(FPS);
      recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 5_000_000 });
      recorder.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      recorder.start(250);
    }

    const renderer = new Renderer(BW, BH);
    renderer.cam.zoom = 1.4 * RES;
    const fx = new Fx();
    const crowd = new Crowd();
    let banner = '';
    let bannerLeft = 0;
    const director = new Director(fx, MUTE, stubHud((t, s) => ((banner = t), (bannerLeft = s))), renderer, input.models.robots, crowd);
    const battle = document.createElement('canvas');
    battle.width = BW;
    battle.height = BH;
    const bctx = battle.getContext('2d')!;
    const m: Match = createMatch(input.seed, input.setups);
    const bubbles: { side: number; text: string; left: number }[] = [];
    let poster: Blob | null = null;
    let angle = 0.35;
    let frameNo = 0;
    let time = 0;
    const totalTicks = hl.clips.reduce((n, c) => n + c.to - c.from, 0) || 1;
    let doneTicks = 0;
    const dt = 1 / FPS;
    let nextAt = performance.now();

    const waitFrame = async (): Promise<void> => {
      nextAt += 1000 / FPS;
      const wait = nextAt - performance.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      else nextAt = performance.now();
    };

    for (let ci = 0; ci < hl.clips.length && !this.cancelled; ci++) {
      const clip = hl.clips[ci];
      // 快轉到這一段開頭（不畫），特效歸零，鏡頭直接對準
      while (m.tick < clip.from - 1 && !m.done) stepMatch(m);
      fx.calm();
      const [a0, b0] = m.robots;
      if (Math.hypot(a0.x - b0.x, a0.y - b0.y) > 16) angle = -Math.atan2(b0.y - a0.y, b0.x - a0.x);
      renderer.cam.x = ((a0.x + b0.x) / 2) * 0.9;
      renderer.cam.y = ((a0.y + b0.y) / 2) * 0.9;
      let acc = 0;
      while (m.tick < clip.to && !m.done && !this.cancelled) {
        // 慢動作只是每一格少推進幾個 tick（結果不變）
        // 打擊頓幀：和比賽畫面一樣，停幾格不推進
        if (fx.hitStop > 0) fx.hitStop = Math.max(0, fx.hitStop - dt * TICK_HZ);
        else acc += (TICK_HZ / FPS) * fx.timeScale;
        while (acc >= 1 && m.tick < clip.to && !m.done) {
          acc -= 1;
          stepMatch(m);
          doneTicks++;
          director.onTick(m);
          for (const e of m.events) {
            if (e.type !== 'misfire' || m.phase !== 'fight') continue;
            // 這一段的主角失誤：慢動作特寫；其他失誤也冒對話框（同一方 2 秒內只冒一次）
            if (bubbles.some((b) => b.side === e.robot)) continue;
            rng.at(e.tick);
            bubbles.push({ side: e.robot, text: bubbleLine(e, m.robots[e.robot].spec.name, rng), left: 2.2 });
            if (clip.misfire && e.tick === clip.misfire.tick && e.robot === clip.misfire.robot) {
              fx.slow(0.45, 1);
              fx.focusOn(m.robots[e.robot].x, m.robots[e.robot].y, 0.5);
            }
          }
          if (fx.hitStop > 0) {
            acc = 0;
            break;
          }
        }
        director.onFrame(m, frameNo++);
        fx.update(dt);
        crowd.update(dt);
        time += dt;
        this.camera(renderer, m, fx, dt, (a) => (angle = a), angle);
        drawScene(renderer, m, input.models, fx, crowd, time, dt * fx.timeScale);
        bctx.putImageData(renderer.image, 0, 0);
        for (const b of bubbles) b.left -= dt;
        for (let i = bubbles.length - 1; i >= 0; i--) if (bubbles[i].left <= 0) bubbles.splice(i, 1);
        bannerLeft -= dt;
        this.compose(input, battle, renderer, m, LABEL[clip.kind], captions[ci], bubbles, bannerLeft > 0 ? banner : '');
        // 重點那一刻存一張截圖（分享不了影片時用）
        if (!poster && m.tick >= clip.at) poster = await new Promise<Blob | null>((r) => this.canvas.toBlob(r, 'image/png'));
        onProgress(Math.min(0.95, doneTicks / totalTicks));
        await waitFrame();
      }
    }
    // 片尾 1 秒
    for (let i = 0; i < OUTRO_FRAMES && !this.cancelled; i++) {
      this.outro(input, i / OUTRO_FRAMES);
      await waitFrame();
    }
    if (!poster) poster = await new Promise<Blob | null>((r) => this.canvas.toBlob(r, 'image/png'));
    let video: Blob | null = null;
    if (recorder) {
      const stopped = new Promise<void>((r) => (recorder!.onstop = () => r()));
      recorder.stop();
      await stopped;
      recorder.stream.getTracks().forEach((t) => t.stop());
      if (chunks.length && !this.cancelled) video = new Blob(chunks, { type: mime!.split(';')[0] });
    }
    onProgress(1);
    if (this.cancelled) return null;
    return { video, mime: mime ? mime.split(';')[0] : '', poster, caption: captions[0] ?? '' };
  }

  /** 和比賽畫面一樣的導播鏡頭：從側面拍兩台、離遠拉遠、特寫往焦點靠 */
  private camera(r: Renderer, m: Match, fx: Fx, dt: number, setAngle: (a: number) => void, angle: number): void {
    const cam = r.cam;
    const [a, b] = m.robots;
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    const k = 1 - Math.exp(-dt * 5);
    if (dist > 16 && m.phase !== 'over') {
      const want = -Math.atan2(b.y - a.y, b.x - a.x);
      let d = want - angle;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      setAngle(angle + d * (1 - Math.exp(-dt * 2.5)));
    }
    cam.angle = angle;
    // 直式畫面比較窄：比正常畫面再推近一點，兩台才不會太小
    const auto = Math.max(1.05 * RES, Math.min(2.4 * RES, (BW * 1.35) / (dist + 110)));
    const zoom = auto * (1 + fx.zoomKick) * (1 + fx.focus * 0.4);
    cam.zoom += (zoom - cam.zoom) * k;
    const cx = ((a.x + b.x) / 2) * 0.9;
    const cy = ((a.y + b.y) / 2) * 0.9;
    cam.x += (cx + (fx.focusX - cx) * fx.focus - cam.x) * k;
    cam.y += (cy + (fx.focusY - cy) * fx.focus - cam.y) * k;
    cam.shakeX = fx.shakeX;
    cam.shakeY = fx.shakeY;
  }

  private text(t: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = 'center', weight = 900, stroke = 0): void {
    const c = this.ctx;
    c.font = `${weight} ${size}px ${this.font}`;
    c.textAlign = align;
    c.textBaseline = 'middle';
    if (stroke) {
      c.lineJoin = 'round';
      c.lineWidth = stroke;
      c.strokeStyle = '#0b0816';
      c.strokeText(t, x, y);
    }
    c.fillStyle = color;
    c.fillText(t, x, y);
  }

  private compose(
    input: ClipInput,
    battle: HTMLCanvasElement,
    r: Renderer,
    m: Match,
    label: string,
    caption: string,
    bubbles: { side: number; text: string }[],
    banner: string,
  ): void {
    const c = this.ctx;
    const g = c.createLinearGradient(0, 0, 0, CLIP_H);
    g.addColorStop(0, '#1d1238');
    g.addColorStop(1, '#0b0816');
    c.fillStyle = g;
    c.fillRect(0, 0, CLIP_W, CLIP_H);
    // 上方：雙方名字和大腦
    this.text('PROMPT CAGE', CLIP_W / 2, 36, 26, '#5ef2ff');
    const [sa, sb] = input.setups;
    c.fillStyle = '#d8433a';
    c.fillRect(24, 70, 8, 104);
    c.fillStyle = '#3a7bd8';
    c.fillRect(CLIP_W - 32, 70, 8, 104);
    this.text(shortName(sa.name), 46, 102, 40, '#ffffff', 'left');
    this.text(BRAINS[sa.brain].name, 46, 148, 28, '#ffb3ad', 'left', 800);
    this.text(shortName(sb.name), CLIP_W - 46, 102, 40, '#ffffff', 'right');
    this.text(BRAINS[sb.brain].name, CLIP_W - 46, 148, 28, '#a9c8ff', 'right', 800);
    this.text('VS', CLIP_W / 2, 124, 36, '#ff5ec8');
    // 中間：戰鬥畫面（整數倍、硬邊放大）
    c.imageSmoothingEnabled = false;
    c.drawImage(battle, 0, TOP, BW * SCALE, BH * SCALE);
    // 血條
    m.robots.forEach((rb, i) => {
      const w = 300 * Math.max(0, rb.hp / rb.spec.maxHp);
      c.fillStyle = 'rgba(0,0,0,0.55)';
      c.fillRect(i === 0 ? 24 : CLIP_W - 324, TOP + 16, 300, 14);
      c.fillStyle = i === 0 ? '#ff5a4e' : '#4f93ff';
      c.fillRect(i === 0 ? 24 : CLIP_W - 24 - w, TOP + 16, w, 14);
    });
    // 這一段是什麼
    c.font = `900 28px ${this.font}`;
    const lw = c.measureText(label).width + 36;
    c.fillStyle = '#ff5ec8';
    c.fillRect(CLIP_W / 2 - lw / 2, TOP + 44, lw, 46);
    this.text(label, CLIP_W / 2, TOP + 68, 28, '#ffffff');
    // 頭上的對話框
    for (const b of bubbles) {
      const rb = m.robots[b.side];
      const [px, py] = r.project(rb.x, rb.y, 46);
      this.bubble(b.text, px * SCALE, TOP + py * SCALE - 18, b.side);
    }
    // 導播的橫幅（K.O.、DOWN!…）
    if (banner) this.text(banner, CLIP_W / 2, TOP + BH * SCALE * 0.42, 92, '#ffd84d', 'center', 900, 14);
    // 下方：大字幕
    c.font = `900 50px ${this.font}`;
    const lines = wrap(c, caption, CLIP_W - 80).slice(0, 3);
    const y0 = 1105 - (lines.length - 1) * 32;
    lines.forEach((l, i) => this.text(l, CLIP_W / 2, y0 + i * 64, 50, '#ffffff', 'center', 900, 10));
    if (input.dailyCost !== null) this.text(`📅 每日挑戰：我用 ${input.dailyCost} 點的配法打贏`, CLIP_W / 2, 1238, 28, '#ffd84d', 'center', 800, 6);
  }

  private bubble(text: string, x: number, y: number, side: number): void {
    const c = this.ctx;
    c.font = `900 26px ${this.font}`;
    const lines = wrap(c, text, 360);
    const w = Math.max(...lines.map((l) => c.measureText(l).width)) + 28;
    const h = lines.length * 34 + 18;
    const bx = Math.max(10, Math.min(CLIP_W - 10 - w, x - w / 2));
    const by = Math.max(TOP + 100, y - h - 14);
    c.fillStyle = '#0b0816';
    c.fillRect(bx + 5, by + 5, w, h);
    c.fillStyle = side === 0 ? '#ffe9e6' : '#e6f0ff';
    c.fillRect(bx, by, w, h);
    c.strokeStyle = '#0b0816';
    c.lineWidth = 4;
    c.strokeRect(bx, by, w, h);
    // 像素風的尾巴
    const tx = Math.max(bx + 14, Math.min(bx + w - 26, x - 6));
    c.fillStyle = '#0b0816';
    c.fillRect(tx, by + h, 14, 8);
    c.fillRect(tx + 4, by + h + 8, 8, 8);
    lines.forEach((l, i) => this.text(l, bx + w / 2, by + 26 + i * 34, 26, '#1c2029', 'center', 900));
  }

  private outro(input: ClipInput, t: number): void {
    const c = this.ctx;
    c.fillStyle = '#0b0816';
    c.fillRect(0, 0, CLIP_W, CLIP_H);
    c.globalAlpha = Math.min(1, t * 4);
    this.text('PROMPT', CLIP_W / 2, 520, 110, '#5ef2ff', 'center', 900, 0);
    this.text('CAGE', CLIP_W / 2, 640, 110, '#ff5ec8', 'center', 900, 0);
    this.text('AI 機器人格鬥・你寫卡，它照自己的理解打', CLIP_W / 2, 750, 30, '#ffffff', 'center', 700);
    if (input.dailyCost !== null) this.text(`我用 ${input.dailyCost} 點打贏今天的每日挑戰，你能更便宜嗎？`, CLIP_W / 2, 820, 28, '#ffd84d', 'center', 800);
    this.text(input.url, CLIP_W / 2, 900, 34, '#a9c8ff', 'center', 800);
    c.globalAlpha = 1;
  }
}
