/** 把戰鬥狀態（sim）畫出來。只讀 sim，不改 sim。 */
import type { Renderer } from '../render/renderer';
import type { StackModel } from '../render/stack';
import type { Match } from '../sim/match';
import type { Robot } from '../sim/types';
import { ARENA_APOTHEM } from '../sim/arena';
import { FLOOR_Z, POST_RADIUS, type ArenaModels } from '../models/arena';
import { ROBOT_RIG, type RobotModels } from '../models/robot';
import type { Fx } from './fx';

export interface SceneModels {
  arena: ArenaModels;
  robots: RobotModels[];
}

interface ArmPose {
  fwd: number;
  side: number;
  z: number;
}

function drawRobot(r: Renderer, s: Robot, m: RobotModels, time: number): void {
  if (s.action === 'down' || s.action === 'ko') {
    // 倒地：落下後彈兩下
    const t = s.actionTicks;
    const bounce = t < 26 ? Math.abs(Math.sin(t * 0.25)) * ((26 - t) / 26) * 9 : 0;
    r.drawStack(m.down, s.x, s.y, FLOOR_Z + bounce, s.heading);
    return;
  }
  // 爬起來時閃爍，表示無敵
  if (s.action === 'getup' && (s.actionTicks >> 2) & 1) return;

  const parts = s.hitFlash > 0 ? m.white : m.normal;
  const swing = s.moving ? Math.sin(s.walkPhase) : 0;
  const stride = swing * 2.5;
  let bob = s.moving ? (Math.abs(Math.cos(s.walkPhase)) > 0.6 ? 1 : 0) : Math.sin(time * 2.4 + s.id) > 0.4 ? 1 : 0;
  let twist = swing * 0.12;
  let torsoFwd = 0;
  let torsoSide = 0;
  // arms[0] = 左（side 為負），arms[1] = 右
  const arms: [ArmPose, ArmPose] = [
    { fwd: 1 - stride, side: -ROBOT_RIG.armSide, z: 0 },
    { fwd: 1 + stride, side: ROBOT_RIG.armSide, z: 0 },
  ];
  const punch = arms[s.arm];
  const dir = s.arm === 0 ? -1 : 1;
  const heavy = s.attack === 'heavy';

  switch (s.action) {
    case 'windup': {
      // 拳頭往後拉、身體跟著扭
      const p = Math.min(1, s.actionTicks / s.spec[s.attack].windup);
      punch.fwd = 1 - (heavy ? 7 : 3) * p;
      punch.z = heavy ? 3 * p : 0;
      twist = dir * (heavy ? 0.55 : 0.25) * p;
      torsoFwd = heavy ? -1.5 * p : 0;
      break;
    }
    case 'recover': {
      // 拳頭一口氣伸到底，再慢慢收回來
      const q = 1 - Math.min(1, s.actionTicks / s.spec[s.attack].recover);
      const ext = q * q;
      punch.fwd = 1 + (heavy ? 13 : 10) * ext;
      punch.z = heavy ? 2 * ext : 1;
      twist = -dir * (heavy ? 0.5 : 0.25) * ext;
      torsoFwd = (heavy ? 3 : 1) * ext;
      break;
    }
    case 'guard':
      for (const a of arms) {
        a.fwd = 7;
        a.side *= 0.55;
        a.z = 4;
      }
      twist = 0;
      break;
    case 'stagger':
      torsoFwd = -2.5;
      torsoSide = s.actionTicks & 2 ? 1 : -1;
      twist = torsoSide * 0.15;
      break;
    case 'win':
      bob = Math.sin(time * 9) > 0 ? 2 : 0;
      for (const a of arms) a.z = 8;
      twist = Math.sin(time * 4) * 0.2;
      break;
    default:
      break;
  }

  const ch = Math.cos(s.heading);
  const sh = Math.sin(s.heading);
  const upper = s.heading + twist;
  const cu = Math.cos(upper);
  const su = Math.sin(upper);
  const baseX = s.x + torsoFwd * ch - torsoSide * sh;
  const baseY = s.y + torsoFwd * sh + torsoSide * ch;

  const leg = (model: StackModel, fwd: number, side: number, z: number): void =>
    r.drawStack(model, s.x + fwd * ch - side * sh, s.y + fwd * sh + side * ch, z, s.heading);
  leg(parts.leg, stride, -ROBOT_RIG.legSide, FLOOR_Z + (stride > 1 ? 1 : 0));
  leg(parts.leg, -stride, ROBOT_RIG.legSide, FLOOR_Z + (stride < -1 ? 1 : 0));

  r.drawStack(parts.torso, baseX, baseY, FLOOR_Z + ROBOT_RIG.torsoZ + bob, upper);
  for (const a of arms)
    r.drawStack(
      parts.arm,
      baseX + a.fwd * cu - a.side * su,
      baseY + a.fwd * su + a.side * cu,
      FLOOR_Z + ROBOT_RIG.armZ + bob + a.z,
      upper,
    );
}

export function drawScene(r: Renderer, match: Match, models: SceneModels, fx: Fx, time: number): void {
  r.begin();
  const A = models.arena;

  r.drawStack(A.floor, 0, 0, 0, 0);
  for (const s of match.robots) {
    const lying = s.action === 'down' || s.action === 'ko';
    r.shadow(s.x, s.y, FLOOR_Z, ROBOT_RIG.shadowRadius * (lying ? 1.4 : 1));
  }

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

  match.robots.forEach((s, i) => drawRobot(r, s, models.robots[i], time));
  fx.draw(r);
  fx.post(r);
}
