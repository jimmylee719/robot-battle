/** 把戰鬥狀態（sim）畫出來。只讀 sim，不改 sim。 */
import type { Renderer } from '../render/renderer';
import type { RobotState, World } from '../sim/world';
import { ARENA_APOTHEM } from '../sim/arena';
import { FLOOR_Z, POST_RADIUS, type ArenaModels } from '../models/arena';
import { ROBOT_RIG, type RobotModels } from '../models/robot';
import type { Fx } from './fx';

export interface SceneModels {
  arena: ArenaModels;
  robots: RobotModels[];
}

function drawRobot(r: Renderer, s: RobotState, m: RobotModels, time: number): void {
  const ch = Math.cos(s.heading);
  const sh = Math.sin(s.heading);
  const swing = s.moving ? Math.sin(s.walkPhase) : 0;
  // 走路時上下顛，站著時慢慢呼吸
  const bob = s.moving ? (Math.abs(Math.cos(s.walkPhase)) > 0.6 ? 1 : 0) : Math.sin(time * 2.4) > 0.4 ? 1 : 0;
  const twist = swing * 0.12;

  // 局部座標（前, 側）→ 世界
  const place = (model: RobotModels['leg'], fwd: number, side: number, z: number, angle: number): void => {
    r.drawStack(model, s.x + fwd * ch - side * sh, s.y + fwd * sh + side * ch, z, angle);
  };

  const stride = swing * 2.5;
  place(m.leg, stride, -ROBOT_RIG.legSide, FLOOR_Z + (stride > 1 ? 1 : 0), s.heading);
  place(m.leg, -stride, ROBOT_RIG.legSide, FLOOR_Z + (stride < -1 ? 1 : 0), s.heading);
  place(m.torso, 0, 0, FLOOR_Z + ROBOT_RIG.torsoZ + bob, s.heading + twist);
  place(m.arm, -stride + 1, -ROBOT_RIG.armSide, FLOOR_Z + ROBOT_RIG.armZ + bob, s.heading + twist);
  place(m.arm, stride + 1, ROBOT_RIG.armSide, FLOOR_Z + ROBOT_RIG.armZ + bob, s.heading + twist);
}

export function drawScene(r: Renderer, world: World, models: SceneModels, fx: Fx, time: number): void {
  r.begin();
  const A = models.arena;

  r.drawStack(A.floor, 0, 0, 0, 0);
  for (const s of world.robots) r.shadow(s.x, s.y, FLOOR_Z, ROBOT_RIG.shadowRadius);

  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    const x = Math.cos(a) * ARENA_APOTHEM;
    const y = Math.sin(a) * ARENA_APOTHEM;
    // 面向鏡頭的那幾片換成稀疏網，避免擋住擂台
    r.drawStack(r.viewY(x, y) > 8 ? A.fenceNear : A.fenceFar, x, y, FLOOR_Z, a);

    const pa = a + Math.PI / 8;
    const post = k === 3 || k === 4 ? A.postRed : k === 0 || k === 7 ? A.postBlue : A.post;
    r.drawStack(post, Math.cos(pa) * POST_RADIUS, Math.sin(pa) * POST_RADIUS, FLOOR_Z, 0);
  }

  world.robots.forEach((s, i) => drawRobot(r, s, models.robots[i % models.robots.length], time));
  fx.draw(r);
  fx.post(r);
}
