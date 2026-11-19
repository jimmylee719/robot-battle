/**
 * 把戰鬥狀態（sim）畫出來。只讀 sim，不改 sim。
 *
 * 機器人是一副骨架：戰鬥邏輯只給「現在在做什麼、做到第幾個 tick」，
 * 這裡把它變成一個目標姿勢，再讓實際姿勢平滑地追上去，所以動作之間不會跳。
 * 腳是踩在地上的：身體移動超過一小段，腳才抬起來跨一步。手腳用兩節骨頭的 IK 接到肩和髖。
 * 這些全部是畫面用的狀態，和勝負無關。
 */
import type { Renderer } from '../render/renderer';
import type { StackModel } from '../render/stack';
import type { Match } from '../sim/match';
import type { Robot } from '../sim/types';
import { ARENA_APOTHEM, insideArena } from '../sim/arena';
import { APRON, FLOOR_Z, POST_RADIUS, STAND_DEPTH, STAND_LENGTH, type ArenaModels } from '../models/arena';
import type { Crowd } from './crowd';
import { ROBOT_RIG as RIG, type RobotModels, type RobotParts } from '../models/robot';
import type { Fx } from './fx';

export interface SceneModels {
  arena: ArenaModels;
  robots: RobotModels[];
  referee: RobotModels;
}

/** 姿勢。位置都以機器人面向為準：f = 前、s = 側（負的是左手那一側）、z = 離地高度。 */
interface Pose {
  hipZ: number;
  /** 上半身相對於面向的扭轉 */
  twist: number;
  /** 身體每往上一層往前／往側邊偏多少（前傾、側傾） */
  leanF: number;
  leanS: number;
  headF: number;
  headS: number;
  headZ: number;
  /** 兩隻手的位置：[左, 右] × [f, s, z] */
  hands: [number, number, number, number, number, number];
  /** 兩腳站多開 */
  stance: number;
}

interface Foot {
  x: number;
  y: number;
  ang: number;
  /** 跨步中：0..1；沒在跨步是 -1 */
  t: number;
  fromX: number;
  fromY: number;
  lift: number;
}

interface Puppet {
  pose: Pose;
  feet: [Foot, Foot];
  lastX: number;
  lastY: number;
  vx: number;
  vy: number;
  /** 上次跨步的是哪一隻腳 */
  lastStep: number;
  seen: boolean;
}

const puppets = new WeakMap<Robot, Puppet>();

/** 格鬥架式：左腳左手在前（正架），膝蓋微彎，雙手護在下巴前 */
function stancePose(): Pose {
  return {
    hipZ: 10.8,
    twist: 0.35,
    leanF: 0.06,
    leanS: 0,
    headF: 0.5,
    headS: 0,
    headZ: 0,
    hands: [8.5, -2.5, 19.5, 4.5, 3.5, 19.5],
    stance: 1,
  };
}

/** 腳的站位：[左, 右] × [f, s] */
const FOOT_HOME = [4.5, -4.5, -4, 4.5];
/** 腳尖外開的角度 */
const FOOT_SPLAY = [-0.15, 0.6];

function smooth(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function setHand(p: Pose, arm: number, f: number, s: number, z: number): void {
  p.hands[arm * 3] = f;
  p.hands[arm * 3 + 1] = s;
  p.hands[arm * 3 + 2] = z;
}

/** 揮拳到底的姿勢。w = 這一拳揮出去的進度 0..1 */
function strikePose(p: Pose, arm: number, heavy: boolean, w: number): void {
  const side = arm === 0 ? -1 : 1;
  if (!heavy) {
    if (arm === 0) {
      // 刺拳：前手直直送出去，肩膀跟著送
      p.twist = 0.75;
      p.leanF = 0.14;
      setHand(p, 0, 18, -1.5, 20.5);
    } else {
      // 後手直拳：轉腰，後肩轉到前面
      p.twist = -0.55;
      p.leanF = 0.2;
      p.hipZ = 10.3;
      setHand(p, 1, 17, 0.5, 20.5);
      setHand(p, 0, 5, -4, 19.5);
    }
    return;
  }
  if (arm === 0) {
    // 前手勾拳：手從外側畫一個弧掃進來
    const a = mix(1.75, -0.3, w);
    p.twist = mix(-0.2, 1.05, w);
    p.leanF = 0.12;
    p.leanS = side * -0.08 * (1 - w);
    p.hipZ = 10;
    setHand(p, 0, 13.5 * Math.cos(a) + 2, -13.5 * Math.sin(a), 20);
    setHand(p, 1, 4.5, 3, 20);
  } else {
    // 後手過肩重拳：從後上方砸下來，重心壓上去
    p.twist = mix(0.85, -0.75, w);
    p.leanF = mix(-0.05, 0.26, w);
    p.hipZ = mix(10.4, 9.4, w);
    setHand(p, 1, mix(-3, 17.5, w), mix(7, 0.5, w), 21 + 4.5 * Math.sin(Math.PI * w));
    setHand(p, 0, 4.5, -4.5, 19);
  }
}

/** 依戰鬥狀態算出「現在應該擺成什麼樣子」 */
function targetPose(s: Robot, phase: Match['phase'], time: number, vf: number, vs: number): Pose {
  const p = stancePose();
  const heavy = s.attack === 'heavy';
  const arm = s.arm;
  const side = arm === 0 ? -1 : 1;
  // 架式下的小彈跳和手的晃動（每台的節奏錯開）
  const beat = time * 11 + s.id * 2.1;
  const speed = Math.hypot(vf, vs);

  switch (s.action) {
    case 'idle': {
      if (phase === 'over') {
        // 打完了：放下手、喘氣
        p.hipZ = 11.2;
        p.twist = 0.1;
        p.leanF = 0.12;
        p.headZ = -0.8;
        p.headF = 1.2;
        setHand(p, 0, 2.5, -8.5, 11 + Math.sin(time * 3) * 0.5);
        setHand(p, 1, 2.5, 8.5, 11 + Math.sin(time * 3) * 0.5);
        break;
      }
      const hop = phase === 'intro' ? 1.1 : 0.55;
      p.hipZ += Math.sin(beat) * hop;
      p.headS = Math.sin(time * 2.6 + s.id) * 0.7;
      p.hands[2] += Math.sin(beat + 1.2) * 0.5;
      p.hands[5] += Math.sin(beat + 2.4) * 0.5;
      if (phase === 'intro') {
        // 開場：在角落鬆肩膀、小跳
        setHand(p, 0, 7, -3.5, 17 + Math.sin(beat) * 1.2);
        setHand(p, 1, 4.5, 4.5, 17 + Math.sin(beat + Math.PI) * 1.2);
      }
      // 移動時身體往移動方向帶，衝刺時壓得更低
      const k = s.dashTicks > 0 ? 0.11 : 0.05;
      p.leanF += Math.max(-0.3, Math.min(0.34, vf * k));
      p.leanS += Math.max(-0.25, Math.min(0.25, vs * k));
      if (s.dashTicks > 0) {
        p.hipZ = 9.4;
        p.twist = 0.15;
        setHand(p, 0, 5, -5.5, 17);
        setHand(p, 1, 2, 6, 16.5);
      } else if (speed > 0.3) p.hipZ -= 0.3;
      break;
    }
    case 'windup': {
      const q = smooth(s.actionTicks / s.spec[s.attack].windup);
      if (!heavy) {
        // 刺拳前的小蓄力：肩膀往後收一點
        p.twist = arm === 0 ? 0.2 : 0.6;
        setHand(p, arm, arm === 0 ? 6 : 2.5, side * 3.5, 19.5);
        p.hipZ = 10.5;
      } else if (arm === 0) {
        // 勾拳：前肩往後拉、手張到外側
        p.twist = mix(0.35, -0.2, q);
        p.hipZ = mix(10.8, 9.9, q);
        p.leanS = -0.08 * q;
        setHand(p, 0, mix(8.5, -0.5, q), mix(-2.5, -13, q), mix(19.5, 19, q));
      } else {
        // 過肩重拳：後手拉到後上方，身體往後坐
        p.twist = mix(0.35, 0.85, q);
        p.hipZ = mix(10.8, 10.2, q);
        p.leanF = mix(0.06, -0.06, q);
        setHand(p, 1, mix(4.5, -3, q), mix(3.5, 7, q), mix(19.5, 22, q));
        setHand(p, 0, 7.5, -3, 20);
      }
      break;
    }
    case 'recover': {
      const total = s.spec[s.attack].recover;
      const swing = heavy ? 6 : 3;
      const hold = swing + (heavy ? 5 : 2);
      const w = smooth(s.actionTicks / swing);
      const back = smooth((s.actionTicks - hold) / Math.max(1, total - hold));
      const strike = stancePose();
      strikePose(strike, arm, heavy, w);
      // 打完慢慢收回架式
      p.hipZ = mix(strike.hipZ, p.hipZ, back);
      p.twist = mix(strike.twist, p.twist, back);
      p.leanF = mix(strike.leanF, p.leanF, back);
      p.leanS = mix(strike.leanS, p.leanS, back);
      for (let i = 0; i < 6; i++) p.hands[i] = mix(strike.hands[i], p.hands[i], back);
      break;
    }
    case 'guard': {
      // 高位防禦：雙手夾緊護頭、下巴收、重心放低
      const jolt = s.blockStun > 0 ? ((s.blockStun >> 1) & 1 ? 1 : -1) : 0;
      p.hipZ = 9.8;
      p.twist = 0.18;
      p.leanF = 0.13 - (s.blockStun > 0 ? 0.1 : 0);
      p.leanS = jolt * 0.03;
      p.headF = 1.2;
      p.headZ = -1;
      p.stance = 1.15;
      setHand(p, 0, 6.5, -2.2, 21.5);
      setHand(p, 1, 6, 2.2, 21.5);
      break;
    }
    case 'stagger': {
      // 挨打：頭和上半身被打得往後仰，手鬆掉，再慢慢穩回來
      const k = 1 - smooth(s.actionTicks / Math.max(1, s.stunTicks));
      const wob = Math.sin(s.actionTicks * 0.7 + s.id);
      p.leanF = mix(0.06, -0.3, k);
      p.leanS = wob * 0.12 * k;
      p.twist = 0.35 + wob * 0.3 * k;
      p.hipZ = mix(10.8, 10, k);
      p.headF = mix(0.5, -2.2, k);
      p.headZ = -0.6 * k;
      p.stance = 1.2;
      setHand(p, 0, mix(8.5, 5, k), mix(-2.5, -7.5, k), mix(19.5, 15, k));
      setHand(p, 1, mix(4.5, 2, k), mix(3.5, 8, k), mix(19.5, 14, k));
      break;
    }
    case 'down':
    case 'ko': {
      // 往後倒下去的那一小段（之後換成躺在地上的模型）
      p.leanF = -0.95;
      p.hipZ = 5.5;
      p.twist = 0;
      p.headF = -2.5;
      p.stance = 1.3;
      setHand(p, 0, 1, -10, 20);
      setHand(p, 1, 1, 10, 20);
      break;
    }
    case 'getup': {
      // 從單膝撐地站起來
      const k = smooth(s.actionTicks / 30);
      p.hipZ = mix(4.5, 10.8, k);
      p.leanF = mix(0.5, 0.06, k);
      p.twist = mix(0, 0.35, k);
      p.headZ = mix(-1, 0, k);
      setHand(p, 0, mix(9, 8.5, k), mix(-6, -2.5, k), mix(3, 19.5, k));
      setHand(p, 1, mix(5, 4.5, k), mix(7, 3.5, k), mix(6, 19.5, k));
      break;
    }
    case 'win': {
      // 贏了：舉手、原地跳
      p.hipZ = 11.4 + Math.max(0, Math.sin(time * 9)) * 1.8;
      p.twist = Math.sin(time * 4) * 0.25;
      p.leanF = -0.04;
      p.headZ = 0.5;
      setHand(p, 0, 1.5, -9.5, 29 + Math.sin(time * 9) * 1);
      setHand(p, 1, 1.5, 9.5, 29 + Math.sin(time * 9 + 1) * 1);
      break;
    }
    default:
      break;
  }
  return p;
}

/** 姿勢要多快追上目標（每秒）。出拳那一下要快，其他慢慢來才順。 */
function poseRate(s: Robot): [number, number] {
  switch (s.action) {
    case 'recover':
      return s.actionTicks <= (s.attack === 'heavy' ? 8 : 5) ? [55, 85] : [14, 16];
    case 'windup':
      return s.attack === 'heavy' ? [14, 16] : [30, 34];
    case 'stagger':
      return s.actionTicks < 5 ? [50, 50] : [12, 12];
    case 'guard':
      return [26, 30];
    case 'down':
    case 'ko':
      return [16, 16];
    default:
      return [13, 17];
  }
}

/** 骨架只需要知道身體在哪、面向哪 */
interface Place {
  x: number;
  y: number;
  heading: number;
}

function newPuppet(s: Place): Puppet {
  const foot = (i: number): Foot => {
    const c = Math.cos(s.heading);
    const n = Math.sin(s.heading);
    const f = FOOT_HOME[i * 2];
    const d = FOOT_HOME[i * 2 + 1];
    return { x: s.x + f * c - d * n, y: s.y + f * n + d * c, ang: s.heading + FOOT_SPLAY[i], t: -1, fromX: 0, fromY: 0, lift: 0 };
  };
  return { pose: stancePose(), feet: [foot(0), foot(1)], lastX: s.x, lastY: s.y, vx: 0, vy: 0, lastStep: 1, seen: false };
}

/** 腳：站穩的腳不動；離該站的位置太遠才抬起來跨一步，兩腳輪流 */
function updateFeet(pu: Puppet, s: Place, stance: number, dt: number): void {
  const c = Math.cos(s.heading);
  const n = Math.sin(s.heading);
  const speed = Math.hypot(pu.vx, pu.vy);
  // 走得越快，步子邁得越快、越往前踩
  const dur = speed > 90 ? 0.07 : speed > 30 ? 0.1 : 0.14;
  const lead = Math.min(0.12, dur * 0.8);
  const errs = [0, 0];
  const homes = [0, 0, 0, 0];
  for (let i = 0; i < 2; i++) {
    const f = FOOT_HOME[i * 2] * (i === 0 ? 1 : stance);
    const d = FOOT_HOME[i * 2 + 1] * stance;
    homes[i * 2] = s.x + f * c - d * n + pu.vx * lead;
    homes[i * 2 + 1] = s.y + f * n + d * c + pu.vy * lead;
    errs[i] = Math.hypot(pu.feet[i].x - homes[i * 2], pu.feet[i].y - homes[i * 2 + 1]);
  }
  for (let i = 0; i < 2; i++) {
    const foot = pu.feet[i];
    const other = pu.feet[1 - i];
    const hx = homes[i * 2];
    const hy = homes[i * 2 + 1];
    if (foot.t < 0) {
      // 被打飛或瞬間移動：直接放回去
      if (errs[i] > 26) {
        foot.x = hx;
        foot.y = hy;
        continue;
      }
      const turn = Math.abs(Math.atan2(Math.sin(s.heading + FOOT_SPLAY[i] - foot.ang), Math.cos(s.heading + FOOT_SPLAY[i] - foot.ang)));
      const want = errs[i] > 3.2 || turn > 0.7;
      // 另一隻腳還在空中就等它落地，除非已經落後太多
      const myTurn = other.t < 0 && (errs[i] >= errs[1 - i] || pu.lastStep !== i);
      if (want && (myTurn || errs[i] > 11)) {
        foot.t = 0;
        foot.fromX = foot.x;
        foot.fromY = foot.y;
        pu.lastStep = i;
      }
    }
    if (foot.t >= 0) {
      foot.t += dt / dur;
      const k = smooth(foot.t);
      foot.x = mix(foot.fromX, hx, k);
      foot.y = mix(foot.fromY, hy, k);
      foot.lift = Math.sin(Math.PI * Math.min(1, foot.t)) * 2.6;
      const da = Math.atan2(Math.sin(s.heading + FOOT_SPLAY[i] - foot.ang), Math.cos(s.heading + FOOT_SPLAY[i] - foot.ang));
      foot.ang += da * Math.min(1, dt * 18);
      if (foot.t >= 1) {
        foot.t = -1;
        foot.lift = 0;
      }
    }
  }
}

/** 沿著一段骨頭排幾節，畫成一條肢體 */
function limb(
  r: Renderer,
  model: StackModel,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  ang: number,
): void {
  const len = Math.hypot(bx - ax, by - ay, bz - az);
  const n = Math.max(1, Math.ceil(len / 1.7));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    r.drawStack(model, mix(ax, bx, t), mix(ay, by, t), mix(az, bz, t) - 1.5, ang);
  }
}

const joint = { x: 0, y: 0, z: 0 };

/**
 * 兩節骨頭的 IK：從 a 伸到 b，求中間關節（肘、膝）的位置，結果放在 joint。
 * (px, py, pz) 是關節想要朝的方向。
 */
function solveJoint(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  l1: number,
  l2: number,
  px: number,
  py: number,
  pz: number,
): void {
  let dx = bx - ax;
  let dy = by - ay;
  let dz = bz - az;
  const raw = Math.hypot(dx, dy, dz) || 0.001;
  const d = Math.min(raw, l1 + l2 - 0.05);
  dx /= raw;
  dy /= raw;
  dz /= raw;
  const along = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const out = Math.sqrt(Math.max(0, l1 * l1 - along * along));
  // 把朝向裡面沿著骨頭的分量拿掉，剩下的就是關節凸出去的方向
  const dot = px * dx + py * dy + pz * dz;
  let ox = px - dx * dot;
  let oy = py - dy * dot;
  let oz = pz - dz * dot;
  const ol = Math.hypot(ox, oy, oz) || 1;
  ox /= ol;
  oy /= ol;
  oz /= ol;
  joint.x = ax + dx * along + ox * out;
  joint.y = ay + dy * along + oy * out;
  joint.z = az + dz * along + oz * out;
}

/** 倒下去要幾個 tick 才換成躺在地上的模型 */
const FALL_TICKS = 9;

/** 記下身體的速度（跨步和傾斜都看它），回傳以面向為準的 [前, 側] 速度 */
function trackVelocity(pu: Puppet, s: Place, dt: number): [number, number] {
  if (dt > 0) {
    const k = Math.min(1, dt * 14);
    pu.vx += ((s.x - pu.lastX) / dt - pu.vx) * k;
    pu.vy += ((s.y - pu.lastY) / dt - pu.vy) * k;
  }
  pu.lastX = s.x;
  pu.lastY = s.y;
  const ch = Math.cos(s.heading);
  const sh = Math.sin(s.heading);
  return [(pu.vx * ch + pu.vy * sh) / 60, (-pu.vx * sh + pu.vy * ch) / 60];
}

/** 讓實際姿勢往目標姿勢靠過去，並更新兩隻腳 */
function settle(pu: Puppet, s: Place, target: Pose, bodyRate: number, handRate: number, dt: number): void {
  const pose = pu.pose;
  if (!pu.seen) {
    Object.assign(pose, target, { hands: [...target.hands] });
    pu.seen = true;
  } else {
    const kb = 1 - Math.exp(-dt * bodyRate);
    const kh = 1 - Math.exp(-dt * handRate);
    pose.hipZ += (target.hipZ - pose.hipZ) * kb;
    pose.twist += (target.twist - pose.twist) * kb;
    pose.leanF += (target.leanF - pose.leanF) * kb;
    pose.leanS += (target.leanS - pose.leanS) * kb;
    pose.headF += (target.headF - pose.headF) * kb;
    pose.headS += (target.headS - pose.headS) * kb;
    pose.headZ += (target.headZ - pose.headZ) * kb;
    pose.stance += (target.stance - pose.stance) * kb;
    for (let i = 0; i < 6; i++) pose.hands[i] += (target.hands[i] - pose.hands[i]) * kh;
  }
  updateFeet(pu, s, pose.stance, dt);
}

/** 照骨架現在的姿勢把整個身體畫出來 */
function drawBody(r: Renderer, parts: RobotParts, shoulderSide: number, pu: Puppet, s: Place): void {
  const pose = pu.pose;
  const ch = Math.cos(s.heading);
  const sh = Math.sin(s.heading);
  const upper = s.heading + pose.twist;
  const cu = Math.cos(upper);
  const su = Math.sin(upper);
  // 傾斜（世界座標，每層）
  const shx = pose.leanF * ch - pose.leanS * sh;
  const shy = pose.leanF * sh + pose.leanS * ch;
  // 髖稍微跟著重心走：前傾時屁股往後一點，才不會像整根柱子倒下去
  const hipX = s.x - shx * 3;
  const hipY = s.y - shy * 3;
  const hipZ = FLOOR_Z + pose.hipZ;

  // 腿
  const hipAng = s.heading + pose.twist * 0.3;
  const chp = Math.cos(hipAng);
  const shp = Math.sin(hipAng);
  for (let i = 0; i < 2; i++) {
    const foot = pu.feet[i];
    const side = i === 0 ? -RIG.hipSide : RIG.hipSide;
    const hx = hipX - side * shp;
    const hy = hipY + side * chp;
    const az = FLOOR_Z + foot.lift + 2.5;
    // 膝蓋朝前、微微外開
    const kx = ch * 1 - sh * side * 0.12;
    const ky = sh * 1 + ch * side * 0.12;
    solveJoint(hx, hy, hipZ, foot.x, foot.y, az, RIG.thigh, RIG.shin, kx, ky, 0.25);
    limb(r, parts.thigh, hx, hy, hipZ - 1, joint.x, joint.y, joint.z, s.heading);
    limb(r, parts.shin, joint.x, joint.y, joint.z, foot.x, foot.y, az, s.heading);
    r.drawStack(parts.foot, foot.x, foot.y, FLOOR_Z + foot.lift, foot.ang);
  }

  // 軀幹和頭
  r.drawStack(parts.torso, hipX, hipY, hipZ, upper, shx, shy);
  const neckX = hipX + shx * RIG.neckZ + pose.headF * ch - pose.headS * sh;
  const neckY = hipY + shy * RIG.neckZ + pose.headF * sh + pose.headS * ch;
  r.drawStack(parts.head, neckX, neckY, hipZ + RIG.neckZ + pose.headZ, s.heading + pose.twist * 0.4, shx * 0.5, shy * 0.5);

  // 手臂
  for (let i = 0; i < 2; i++) {
    const side = i === 0 ? -shoulderSide : shoulderSide;
    const sx = hipX + shx * RIG.shoulderZ - side * su;
    const sy = hipY + shy * RIG.shoulderZ + side * cu;
    const sz = hipZ + RIG.shoulderZ;
    const hf = pose.hands[i * 3];
    const hs = pose.hands[i * 3 + 1];
    const tx = s.x + hf * ch - hs * sh;
    const ty = s.y + hf * sh + hs * ch;
    const tz = FLOOR_Z + pose.hands[i * 3 + 2];
    // 手肘朝下、朝外、稍微朝後
    const out = i === 0 ? -1 : 1;
    const ex = -0.35 * ch - out * 0.7 * sh;
    const ey = -0.35 * sh + out * 0.7 * ch;
    solveJoint(sx, sy, sz, tx, ty, tz, RIG.upperArm, RIG.foreArm, ex, ey, -1);
    // 手伸不到那麼遠時，手就停在手臂伸直的位置
    const reach = Math.hypot(tx - sx, ty - sy, tz - sz);
    const max = RIG.upperArm + RIG.foreArm - 0.05;
    const k = reach > max ? max / reach : 1;
    const hx = sx + (tx - sx) * k;
    const hy = sy + (ty - sy) * k;
    const hz = sz + (tz - sz) * k;
    r.drawStack(parts.pad, sx, sy, sz - 1.5, upper);
    limb(r, parts.upper, sx, sy, sz, joint.x, joint.y, joint.z, upper);
    limb(r, parts.fore, joint.x, joint.y, joint.z, hx, hy, hz, upper);
    // 手（武器）順著前臂的方向
    const fx = hx - joint.x;
    const fy = hy - joint.y;
    const handAng = Math.hypot(fx, fy) > 1.5 ? Math.atan2(fy, fx) : upper;
    r.drawStack(parts.hand, hx, hy, hz - 2, handAng);
  }
}

function drawRobot(r: Renderer, s: Robot, m: RobotModels, phase: Match['phase'], time: number, dt: number): void {
  let pu = puppets.get(s);
  if (!pu) {
    pu = newPuppet(s);
    puppets.set(s, pu);
  }
  const [vf, vs] = trackVelocity(pu, s, dt);
  const [bodyRate, handRate] = poseRate(s);
  settle(pu, s, targetPose(s, phase, time, vf, vs), bodyRate, handRate, dt);

  const lying = s.action === 'down' || s.action === 'ko';
  if (lying && s.actionTicks >= FALL_TICKS) {
    // 倒地：落下後彈兩下
    const t = s.actionTicks - FALL_TICKS;
    const bounce = t < 26 ? Math.abs(Math.sin(t * 0.25)) * ((26 - t) / 26) * 7 : 0;
    r.drawStack(m.down, s.x, s.y, FLOOR_Z + bounce, s.heading);
    return;
  }
  // 爬起來時閃爍，表示無敵
  if (s.action === 'getup' && (s.actionTicks >> 1) & 1) return;
  drawBody(r, s.hitFlash > 0 ? m.white : m.normal, m.shoulderSide, pu, s);
}

/** 設定畫面的預覽：一台站在原地擺架式的機器人（鏡頭自己繞著它轉） */
const SHOW: Place = { x: 0, y: 0, heading: 0 };
let showPuppet: Puppet | null = null;

export function drawShowcase(r: Renderer, m: RobotModels, stand: StackModel, time: number, dt: number): void {
  r.begin();
  showPuppet ??= newPuppet(SHOW);
  const pose = stancePose();
  // 呼吸、雙手微微晃
  pose.hipZ += Math.sin(time * 2.4) * 0.3;
  pose.hands[2] += Math.sin(time * 2.4 + 0.6) * 0.5;
  pose.hands[5] += Math.sin(time * 2.4 + 1.4) * 0.5;
  settle(showPuppet, SHOW, pose, 10, 10, dt);
  r.drawStack(stand, 0, 0, FLOOR_Z - stand.layers.length, 0);
  r.shadow(0, 0, FLOOR_Z, RIG.shadowRadius);
  drawBody(r, m.normal, m.shoulderSide, showPuppet, SHOW);
}

// ---------------------------------------------------------------- 裁判
/**
 * 場內裁判。純畫面：不佔位置、不影響勝負，所以它要自己躲開兩台機器人。
 * 平常站在兩台連線的側邊盯著看；有人倒地就過去讀秒；K.O. 揮手喊停；最後走到贏家旁邊舉手。
 */
type RefMode = 'intro' | 'start' | 'watch' | 'count' | 'stop' | 'winner' | 'draw';

interface Referee extends Place {
  pu: Puppet;
  mode: RefMode;
}

const referees = new WeakMap<Match, Referee>();

function refereePose(mode: RefMode, time: number, moving: boolean): Pose {
  // 站直、手放兩邊
  const p: Pose = {
    hipZ: 11.6,
    twist: 0,
    leanF: 0.03,
    leanS: 0,
    headF: 0.3,
    headS: 0,
    headZ: 0,
    hands: [2.5, -8.5, 11.5, 2.5, 8.5, 11.5],
    stance: 0.75,
  };
  switch (mode) {
    case 'intro':
      // 一隻手伸在兩台中間，叫它們等
      setHand(p, 1, 12, 2, 18);
      break;
    case 'start':
      // 手往上一揮：開打
      setHand(p, 1, 5, 4, 30);
      p.leanF = -0.03;
      break;
    case 'watch':
      // 微蹲、手放在膝蓋前，盯著看
      p.hipZ = moving ? 11 : 10.4;
      p.leanF = 0.13;
      setHand(p, 0, 5.5, -6.5, 13);
      setHand(p, 1, 5.5, 6.5, 13);
      break;
    case 'count': {
      // 讀秒：一秒揮一下手
      const beat = Math.sin(time * Math.PI * 2);
      p.hipZ = 10.6;
      p.leanF = 0.16;
      setHand(p, 1, 9, 2.5, 19 + beat * 7);
      setHand(p, 0, 3, -7.5, 13);
      break;
    }
    case 'stop': {
      // 雙手在頭上交叉揮：比賽結束
      const w = Math.sin(time * 11) * 6;
      setHand(p, 0, 3, -4 - w, 30);
      setHand(p, 1, 3, 4 + w, 30);
      break;
    }
    case 'winner':
      // 舉起贏家那一側的手
      setHand(p, 0, 1.5, -9.5, 31);
      break;
    default:
      break;
  }
  return p;
}

function drawReferee(r: Renderer, match: Match, m: RobotModels, time: number, dt: number): void {
  const [a, b] = match.robots;
  let ref = referees.get(match);
  if (!ref) {
    const place = { x: 0, y: -26, heading: Math.PI / 2 };
    ref = { ...place, pu: newPuppet(place), mode: 'intro' };
    referees.set(match, ref);
  }
  const midX = (a.x + b.x) / 2;
  const midY = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  // 兩台連線的垂直方向；裁判留在它現在所在的那一側，才不會從兩台中間穿過去
  let px = -dy / len;
  let py = dx / len;
  if ((ref.x - midX) * px + (ref.y - midY) * py < 0) {
    px = -px;
    py = -py;
  }

  const down = match.robots.find((s) => s.action === 'down');
  const ko = match.robots.some((s) => s.action === 'ko');
  let tx = midX + px * 38;
  let ty = midY + py * 38;
  let lookX = midX;
  let lookY = midY;
  let mode: RefMode = 'watch';
  if (match.phase === 'intro') {
    mode = 'intro';
    tx = midX + px * 16;
    ty = midY + py * 16;
  } else if (match.phase === 'fight' && match.fightTicks < 45) {
    mode = 'start';
    tx = midX + px * 30;
    ty = midY + py * 30;
  } else if (match.phase === 'over') {
    const winner = match.winner !== null && match.winner >= 0 ? match.robots[match.winner] : null;
    if (ko && match.phaseTicks < 90) mode = 'stop';
    else if (winner) {
      // 站到贏家的左手邊，舉起它的手
      mode = 'winner';
      tx = winner.x - Math.sin(winner.heading) * 17;
      ty = winner.y + Math.cos(winner.heading) * 17;
      lookX = tx + Math.cos(winner.heading) * 30;
      lookY = ty + Math.sin(winner.heading) * 30;
    } else mode = 'draw';
  } else if (down) {
    mode = 'count';
    tx = down.x + px * 21;
    ty = down.y + py * 21;
    lookX = down.x;
    lookY = down.y;
  }

  // 不能走出籠子，也不能踩到機器人
  for (let i = 0; i < 12 && !insideArena(tx, ty, 13); i++) {
    tx *= 0.93;
    ty *= 0.93;
  }
  for (const s of match.robots) {
    const ex = tx - s.x;
    const ey = ty - s.y;
    const e = Math.hypot(ex, ey) || 1;
    const min = mode === 'winner' ? 15 : 22;
    if (e < min) {
      tx = s.x + (ex / e) * min;
      ty = s.y + (ey / e) * min;
    }
  }

  // 走過去（有速度上限，遠的時候小跑）
  const gx = tx - ref.x;
  const gy = ty - ref.y;
  const gap = Math.hypot(gx, gy);
  const step = Math.min(gap, Math.min(gap * 5, 62) * dt);
  if (gap > 0.01) {
    ref.x += (gx / gap) * step;
    ref.y += (gy / gap) * step;
  }
  const want = Math.atan2(lookY - ref.y, lookX - ref.x);
  const turn = Math.atan2(Math.sin(want - ref.heading), Math.cos(want - ref.heading));
  ref.heading += turn * Math.min(1, dt * 8);
  ref.mode = mode;

  trackVelocity(ref.pu, ref, dt);
  settle(ref.pu, ref, refereePose(mode, time, gap > 3), 11, 15, dt);
  drawBody(r, m.normal, m.shoulderSide, ref.pu, ref);
}

// ---------------------------------------------------------------- 場地
const FLASH = 0xffffffff;

export function drawScene(r: Renderer, match: Match, models: SceneModels, fx: Fx, crowd: Crowd, time: number, dt: number): void {
  r.begin();
  const A = models.arena;

  r.drawStack(A.floor, 0, 0, 0, 0);
  for (const s of match.robots) {
    const lying = (s.action === 'down' || s.action === 'ko') && s.actionTicks >= FALL_TICKS;
    r.shadow(s.x, s.y, FLOOR_Z, RIG.shadowRadius * (lying ? 1.5 : 1));
  }
  const ref = referees.get(match);
  if (ref) r.shadow(ref.x, ref.y, FLOOR_Z, RIG.shadowRadius * 0.9);

  const standRadius = APRON + 9;
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    const x = Math.cos(a) * ARENA_APOTHEM;
    const y = Math.sin(a) * ARENA_APOTHEM;
    // 面向鏡頭的那幾片換成稀疏網，避免擋住擂台
    r.drawStack(r.viewY(x, y) > 8 ? A.fenceNear : A.fenceFar, x, y, FLOOR_Z, a);

    const pa = a + Math.PI / 8;
    const post = k === 3 || k === 4 ? A.postRed : k === 0 || k === 7 ? A.postBlue : A.post;
    r.drawStack(post, Math.cos(pa) * POST_RADIUS, Math.sin(pa) * POST_RADIUS, FLOOR_Z, 0);

    // 觀眾席：靠鏡頭這一側的不畫（轉播機位本來就在觀眾席上面，畫了會擋住擂台）
    const sx = Math.cos(a) * standRadius;
    const sy = Math.sin(a) * standRadius;
    if (r.viewY(sx, sy) > 40) continue;
    // 越激動，站起來歡呼的區塊越多；每一區的節拍錯開，看起來像波浪
    const up = Math.sin(crowd.beat + k * 2.1) > 1 - crowd.level * 2;
    r.drawStack(up ? A.standCheer : A.stand, sx, sy, up ? 1 : 0, a);
    // 閃光燈
    if (Math.random() < crowd.level * crowd.level * 0.8) {
      const along = (Math.random() - 0.5) * STAND_LENGTH;
      const out = Math.random() * STAND_DEPTH;
      r.drawPoint(
        Math.cos(a) * (standRadius + out) - Math.sin(a) * along,
        Math.sin(a) * (standRadius + out) + Math.cos(a) * along,
        out * 0.6 + 6,
        FLASH,
        2,
      );
    }
  }
  // 轉播台在紅藍兩角之間的那一側、圍網外面
  r.drawStack(A.desk, 0, ARENA_APOTHEM + 1, FLOOR_Z, Math.PI / 2);

  match.robots.forEach((s, i) => drawRobot(r, s, models.robots[i], match.phase, time, dt));
  drawReferee(r, match, models.referee, time, dt);
  fx.draw(r);
  fx.post(r);
}
