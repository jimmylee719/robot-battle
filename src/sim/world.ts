/**
 * 戰鬥邏輯層。不可以 import 任何畫面、DOM、音效相關的東西。
 * 固定 60Hz 步進 + 種子亂數 → 同樣的輸入一定得到同樣的結果。
 * P0 只有一台在擂台上閒晃的機器人，用來確認渲染器。
 */
import { Rng } from '../core/rng';
import { insideArena, ARENA_APOTHEM } from './arena';

export const TICK_HZ = 60;

export interface RobotState {
  id: number;
  x: number;
  y: number;
  /** 弧度，0 = 朝 +x */
  heading: number;
  moving: boolean;
  walkPhase: number;
  targetX: number;
  targetY: number;
  /** 還要原地等幾個 tick */
  wait: number;
}

export interface World {
  seed: number;
  tick: number;
  rng: Rng;
  robots: RobotState[];
}

const WALK_SPEED = 0.5;
const TURN_SPEED = 0.07;

export function createWorld(seed: number): World {
  const world: World = { seed, tick: 0, rng: new Rng(seed), robots: [] };
  const robot: RobotState = {
    id: 0,
    x: 0,
    y: 0,
    heading: Math.PI / 2,
    moving: false,
    walkPhase: 0,
    targetX: 0,
    targetY: 0,
    wait: 90,
  };
  world.robots.push(robot);
  return world;
}

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function pickTarget(world: World, r: RobotState): void {
  for (let i = 0; i < 32; i++) {
    const x = world.rng.range(-ARENA_APOTHEM, ARENA_APOTHEM);
    const y = world.rng.range(-ARENA_APOTHEM, ARENA_APOTHEM);
    if (insideArena(x, y, 18) && Math.hypot(x - r.x, y - r.y) > 30) {
      r.targetX = x;
      r.targetY = y;
      return;
    }
  }
  r.targetX = 0;
  r.targetY = 0;
}

export function stepWorld(world: World): void {
  world.tick++;
  for (const r of world.robots) {
    if (r.wait > 0) {
      r.moving = false;
      r.wait--;
      if (r.wait === 0) pickTarget(world, r);
      continue;
    }
    const dx = r.targetX - r.x;
    const dy = r.targetY - r.y;
    const diff = wrapAngle(Math.atan2(dy, dx) - r.heading);
    r.heading = wrapAngle(r.heading + Math.max(-TURN_SPEED, Math.min(TURN_SPEED, diff)));
    r.moving = Math.abs(diff) < 0.6;
    if (r.moving) {
      r.x += Math.cos(r.heading) * WALK_SPEED;
      r.y += Math.sin(r.heading) * WALK_SPEED;
      r.walkPhase += 0.16;
    }
    if (dx * dx + dy * dy < 9) {
      r.moving = false;
      r.wait = 50 + world.rng.int(110);
    }
  }
}
