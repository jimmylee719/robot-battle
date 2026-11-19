import { Renderer } from './render/renderer';
import { createMatch, stepMatch, TICK_HZ, type Match, type RobotSetup } from './sim/match';
import { LADDER, type Opponent } from './sim/roster';
import { grantForWin } from './sim/album';
import { CARDS } from './sim/cards';
import { DEFAULT_GEAR } from './sim/gear';
import { buildArenaModels } from './models/arena';
import { BLUE_TEAM, buildRobotModels, RED_TEAM } from './models/robot';
import { drawScene, type SceneModels } from './view/scene';
import { Fx } from './view/fx';
import { Hud } from './view/hud';
import { pct, SetupScreen, shownChanges } from './view/setup';
import { loadProgress, saveProgress } from './view/save';
import { growFrom } from './sim/camp';
import { ACTION_TEXT } from './sim/rules';
import { AXES, AXIS_TEXT } from './sim/temper';
import { Director } from './view/director';
import { SynthPlayer } from './audio/synth';
import type { SoundPlayer } from './audio/sound';
import { CameraControls } from './input/controls';

/** 低解析度緩衝區大小。所有東西都先畫在這裡，再整數倍放大。 */
const BUF_W = 320;
const BUF_H = 180;

const canvas = document.getElementById('screen') as HTMLCanvasElement;
const ctx = canvas.getContext('2d', { alpha: false })!;
const buffer = document.createElement('canvas');
buffer.width = BUF_W;
buffer.height = BUF_H;
const bufferCtx = buffer.getContext('2d')!;
const stats = document.getElementById('stats')!;
const muteBtn = document.getElementById('mute')!;

function resize(): void {
  const dpr = window.devicePixelRatio || 1;
  const scale = Math.max(1, Math.floor(Math.min((innerWidth * dpr) / BUF_W, (innerHeight * dpr) / BUF_H)));
  canvas.width = BUF_W * scale;
  canvas.height = BUF_H * scale;
  canvas.style.width = `${canvas.width / dpr}px`;
  canvas.style.height = `${canvas.height / dpr}px`;
  ctx.imageSmoothingEnabled = false;
}
window.addEventListener('resize', resize);
resize();

const renderer = new Renderer(BUF_W, BUF_H);
renderer.cam.angle = 0.5;
renderer.cam.zoom = 1.4;
const models: SceneModels = {
  arena: buildArenaModels(),
  robots: [buildRobotModels(RED_TEAM, DEFAULT_GEAR), buildRobotModels(BLUE_TEAM, DEFAULT_GEAR)],
};
const fx = new Fx();
const hud = new Hud();
const audio: SoundPlayer = new SynthPlayer();
const director = new Director(fx, audio, hud, renderer, models.robots);

const progress = loadProgress();
const setup = new SetupScreen(progress, () => start(match.seed));
/** 這一場玩家用的設定。開打時凍結（含模型快照和性格），重播才會一模一樣。 */
let playerSetup: RobotSetup = setup.robot();
/** 這一場的對手（重播時沿用） */
let foe: Opponent = LADDER[setup.foe];
/** 這一場是重播：不算戰績、不成長 */
let isReplay = false;
let grown = false;

function newMatch(seed: number): Match {
  const m = createMatch(seed, [playerSetup, foe.setup]);
  // 外觀跟著裝備換（陣列原地改，導播手上拿的是同一個陣列）
  models.robots[0] = buildRobotModels(RED_TEAM, m.robots[0].spec.loadout);
  models.robots[1] = buildRobotModels(BLUE_TEAM, m.robots[1].spec.loadout);
  hud.reset(m);
  const url = new URL(location.href);
  url.searchParams.set('seed', String(seed));
  history.replaceState(null, '', url);
  return m;
}

let match = newMatch(Number(new URLSearchParams(location.search).get('seed')) || 1);
let running = false;

function start(seed: number, replay = false, sameFoe = false): void {
  audio.unlock();
  // 新的一場用最新的模型和性格；重播用上一場凍結的那一份
  if (!replay) {
    playerSetup = setup.robot();
    // 「再打一場」打同一個對手；從設定畫面開打才換成選的那個
    if (!sameFoe) foe = LADDER[setup.foe];
  }
  isReplay = replay;
  grown = false;
  hud.showGrowth([]);
  match = newMatch(seed);
  fx.hitStop = 0;
  acc = 0;
  running = true;
  setup.hide();
  hud.showRules(true);
}

/** 一場打完：性格漂移、自訓模型學習，存檔，並把變化列在賽後畫面上 */
function grow(): void {
  grown = true;
  if (isReplay) {
    hud.showGrowth(['這是重播，不會成長。']);
    return;
  }
  const before = progress.temper;
  const g = growFrom(match, 0, progress.model, progress.temper);
  progress.model = g.model;
  progress.temper = g.temper;
  progress.fights++;

  // 戰績和掉卡
  const lines: string[] = [];
  const rec = (progress.record[foe.id] ??= { w: 0, l: 0 });
  if (match.winner === 0) {
    const firstWin = rec.w === 0;
    rec.w++;
    progress.wins++;
    const got = grantForWin(progress.owned, {
      foeName: foe.setup.name,
      prize: foe.prize,
      firstWin,
      foeCardUses: match.brains[1].cardUses,
      totalWins: progress.wins,
    });
    progress.owned = got.owned;
    for (const d of got.drops) lines.push(`🃏 拿到新卡「${CARDS[d.card].name}」（${d.why}）`);
    const next = LADDER[LADDER.indexOf(foe) + 1];
    // 第一次打贏：設定畫面直接跳到下一個對手
    if (firstWin && next) setup.foe = LADDER.indexOf(next);
    if (firstWin) lines.push(next ?`🔓 可以挑戰下一個對手：${next.setup.name}` : '🏆 五個對手全部打贏了！');
  } else if (match.winner === 1) rec.l++;
  saveProgress(progress);

  const drift = AXES.filter((a) => Math.abs(g.temper[a] - before[a]) > 0.002).map(
    (a) => (g.temper[a] > before[a] ? AXIS_TEXT[a].high : AXIS_TEXT[a].low) + ' ▲',
  );
  if (drift.length) lines.push('🧬 性格：' + drift.join('　'));
  const ch = g.learned.changes;
  const gains = shownChanges(ch).map(
    (k) => `${ACTION_TEXT[k as keyof typeof ACTION_TEXT]} ${pct(ch[k][0])} → ${pct(ch[k][1])}`,
  );
  if (gains.length) lines.push('🧠 自訓模型：' + gains.join('、'));
  hud.showGrowth(lines);
}

/** 回到賽前設定：畫面停在開場，等玩家換卡 */
function openSetup(): void {
  running = false;
  playerSetup = setup.robot();
  foe = LADDER[setup.foe];
  match = newMatch(match.seed);
  setup.refresh();
  hud.showRules(false);
  setup.show();
}

/** 空白鍵／搖桿 A：在設定畫面就開打，打完就同卡組再打一場 */
function primaryAction(): void {
  if (setup.visible) {
    if (setup.legal) start(match.seed);
  }
  else if (match.phase === 'over') start(match.seed + 1, false, true);
}

const controls = new CameraControls(canvas, renderer.cam, primaryAction);
document.getElementById('edit')!.addEventListener('click', openSetup);
document.getElementById('back')!.addEventListener('click', openSetup);
document.getElementById('again')!.addEventListener('click', () => start(match.seed, true));
document.getElementById('reroll')!.addEventListener('click', () => start(match.seed + 1, false, true));
// 快轉：只是讓邏輯跑快一點，結果不變。網址加 ?speed=8 可以直接指定（測試用）。
const speedBtn = document.getElementById('speed')!;
let speed = Math.max(1, Math.min(32, Number(new URLSearchParams(location.search).get('speed')) || 1));
speedBtn.textContent = `速度 ×${speed}`;
speedBtn.addEventListener('click', () => {
  speed = speed >= 4 ? 1 : speed * 2;
  speedBtn.textContent = `速度 ×${speed}`;
});
muteBtn.addEventListener('click', () => {
  audio.unlock();
  audio.setMuted(!audio.muted);
  muteBtn.textContent = audio.muted ? '音效：關' : '音效：開';
});

const TICK = 1 / TICK_HZ;
let last = performance.now();
let acc = 0;
let time = 0;
let frameNo = 0;
let frames = 0;
let renderMs = 0;
let statTimer = 0;

function updateCamera(dt: number): void {
  const cam = renderer.cam;
  const [a, b] = match.robots;
  const dist = Math.hypot(a.x - b.x, a.y - b.y);
  // 兩台離得遠就拉遠，貼身就推近；玩家的縮放是在這上面再乘一個倍率
  const auto = Math.max(1, Math.min(2, BUF_W / (dist + 125)));
  const zoom = Math.max(0.75, Math.min(4, auto * controls.zoom * (1 + fx.zoomKick)));
  const k = 1 - Math.exp(-dt * 5);
  cam.zoom += (zoom - cam.zoom) * k;
  // 鏡頭只跟一部分，擂台才不會晃得太厲害
  cam.x += (((a.x + b.x) / 2) * 0.75 - cam.x) * k;
  cam.y += (((a.y + b.y) / 2) * 0.75 - cam.y) * k;
  cam.shakeX = fx.shakeX;
  cam.shakeY = fx.shakeY;
}

function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  time += dt;
  frameNo++;

  // 戰鬥邏輯固定 60Hz，和畫面更新率無關。頓幀只是暫停推進，不影響結果。
  if (running) {
    acc += dt * speed;
    while (acc >= TICK) {
      acc -= TICK;
      if (fx.hitStop > 0) {
        fx.hitStop--;
        continue;
      }
      stepMatch(match);
      director.onTick(match);
      if (match.phase === 'over' && !grown) grow();
    }
    director.onFrame(match, frameNo);
  }

  controls.update(dt, renderer.cam);
  fx.update(dt);
  updateCamera(dt);
  hud.update(match, dt);

  const t0 = performance.now();
  drawScene(renderer, match, models, fx, time);
  renderMs += performance.now() - t0;
  bufferCtx.putImageData(renderer.image, 0, 0);
  ctx.drawImage(buffer, 0, 0, canvas.width, canvas.height);

  frames++;
  statTimer += dt;
  if (statTimer >= 0.5) {
    stats.textContent = `seed ${match.seed} · tick ${match.tick} · ${Math.round(frames / statTimer)} fps · 繪製 ${(renderMs / frames).toFixed(1)} ms`;
    frames = 0;
    renderMs = 0;
    statTimer = 0;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
