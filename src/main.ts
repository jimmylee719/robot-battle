import { Renderer } from './render/renderer';
import { createMatch, stepMatch, TICK_HZ, type Match } from './sim/match';
import { PLAYER_SPEC, RAMPAGE } from './sim/roster';
import { buildArenaModels } from './models/arena';
import { BLUE_TEAM, buildRobotModels, RED_TEAM } from './models/robot';
import { drawScene, type SceneModels } from './view/scene';
import { Fx } from './view/fx';
import { Hud } from './view/hud';
import { SetupScreen, type PlayerChoice } from './view/setup';
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
  robots: [buildRobotModels(RED_TEAM), buildRobotModels(BLUE_TEAM)],
};
const fx = new Fx();
const hud = new Hud();
const audio: SoundPlayer = new SynthPlayer();
const director = new Director(fx, audio, hud, renderer, models.robots);

const setup = new SetupScreen((choice) => start(match.seed, choice));
let choice: PlayerChoice = setup.value;

function newMatch(seed: number): Match {
  const m = createMatch(seed, [{ spec: PLAYER_SPEC, deck: choice.deck, brain: choice.brain }, RAMPAGE]);
  hud.reset(m);
  const url = new URL(location.href);
  url.searchParams.set('seed', String(seed));
  history.replaceState(null, '', url);
  return m;
}

let match = newMatch(Number(new URLSearchParams(location.search).get('seed')) || 1);
let running = false;

function start(seed: number, next: PlayerChoice = choice): void {
  audio.unlock();
  choice = next;
  match = newMatch(seed);
  fx.hitStop = 0;
  acc = 0;
  running = true;
  setup.hide();
  hud.showRules(true);
}

/** 回到賽前設定：畫面停在開場，等玩家換卡 */
function openSetup(): void {
  running = false;
  match = newMatch(match.seed);
  hud.showRules(false);
  setup.show();
}

/** 空白鍵／搖桿 A：在設定畫面就開打，打完就同卡組再打一場 */
function primaryAction(): void {
  if (setup.visible) start(match.seed, setup.value);
  else if (match.phase === 'over') start(match.seed + 1);
}

const controls = new CameraControls(canvas, renderer.cam, primaryAction);
document.getElementById('edit')!.addEventListener('click', openSetup);
document.getElementById('back')!.addEventListener('click', openSetup);
document.getElementById('again')!.addEventListener('click', () => start(match.seed));
document.getElementById('reroll')!.addEventListener('click', () => start(match.seed + 1));
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
