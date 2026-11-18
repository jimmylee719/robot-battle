import { Renderer } from './render/renderer';
import { createWorld, stepWorld, TICK_HZ } from './sim/world';
import { buildArenaModels, FLOOR_Z } from './models/arena';
import { buildRobotModels, RED_TEAM, ROBOT_RIG } from './models/robot';
import { drawScene, type SceneModels } from './view/scene';
import { Fx } from './view/fx';
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

const seed = Number(new URLSearchParams(location.search).get('seed')) || 1;
const world = createWorld(seed);
const renderer = new Renderer(BUF_W, BUF_H);
renderer.cam.zoom = 1.15;
renderer.cam.angle = 0.6;
const models: SceneModels = { arena: buildArenaModels(), robots: [buildRobotModels(RED_TEAM)] };
const fx = new Fx();

function testHit(): void {
  const r = world.robots[0];
  const m = models.robots[0];
  fx.hit(r.x, r.y, FLOOR_Z + ROBOT_RIG.chestZ, FLOOR_Z, m.debris, m.sparks, 0.4 + Math.random() * 0.6);
}
const controls = new CameraControls(canvas, renderer.cam, testHit);
document.getElementById('hit')!.addEventListener('click', testHit);

const TICK = 1 / TICK_HZ;
let last = performance.now();
let acc = 0;
let time = 0;
let frames = 0;
let renderMs = 0;
let statTimer = 0;

function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  time += dt;

  // 戰鬥邏輯固定 60Hz，和畫面更新率無關
  acc += dt;
  while (acc >= TICK) {
    stepWorld(world);
    acc -= TICK;
  }

  controls.update(dt, renderer.cam);
  fx.update(dt);
  renderer.cam.shakeX = fx.shakeX;
  renderer.cam.shakeY = fx.shakeY;

  const t0 = performance.now();
  drawScene(renderer, world, models, fx, time);
  renderMs += performance.now() - t0;
  bufferCtx.putImageData(renderer.image, 0, 0);
  ctx.drawImage(buffer, 0, 0, canvas.width, canvas.height);

  frames++;
  statTimer += dt;
  if (statTimer >= 0.5) {
    stats.textContent = `${Math.round(frames / statTimer)} fps · 繪製 ${(renderMs / frames).toFixed(1)} ms · ${BUF_W}×${BUF_H} ×${canvas.width / BUF_W} · seed ${world.seed} · tick ${world.tick}`;
    frames = 0;
    renderMs = 0;
    statTimer = 0;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
