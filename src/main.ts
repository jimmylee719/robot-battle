import { Renderer } from './render/renderer';
import { createMatch, stepMatch, TICK_HZ, type Match } from './sim/match';
import { GHOST, RAMPAGE } from './sim/roster';
import { buildArenaModels } from './models/arena';
import { BLUE_TEAM, buildRobotModels, RED_TEAM } from './models/robot';
import { drawScene, type SceneModels } from './view/scene';
import { Fx } from './view/fx';
import { Hud } from './view/hud';
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
const startOverlay = document.getElementById('start')!;
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

function newMatch(seed: number): Match {
  const m = createMatch(seed, [RAMPAGE, GHOST]);
  hud.reset(m);
  history.replaceState(null, '', `?seed=${seed}`);
  return m;
}

let match = newMatch(Number(new URLSearchParams(location.search).get('seed')) || 1);
let running = false;

function start(seed: number): void {
  audio.unlock();
  match = newMatch(seed);
  fx.hitStop = 0;
  acc = 0;
  running = true;
  startOverlay.classList.add('hidden');
}

/** 空白鍵／搖桿 A：還沒開始就開始，打完就下一場 */
function primaryAction(): void {
  if (!running) start(match.seed);
  else if (match.phase === 'over') start(match.seed + 1);
}

const controls = new CameraControls(canvas, renderer.cam, primaryAction);
document.getElementById('startBtn')!.addEventListener('click', () => start(match.seed));
document.getElementById('replay')!.addEventListener('click', () => start(match.seed));
document.getElementById('next')!.addEventListener('click', () => start(match.seed + 1));
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
    acc += dt;
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
