/**
 * 把戰鬥狀態（sim）畫出來。只讀 sim，不改 sim。
 *
 * 機器人是一副骨架：戰鬥邏輯只給「現在在做什麼、做到第幾個 tick」，
 * 這裡把它變成一個目標姿勢，再讓實際姿勢平滑地追上去，所以動作之間不會跳。
 * 腳是踩在地上的：身體移動超過一小段，腳才抬起來跨一步。手腳用兩節骨頭的 IK 接到肩和髖。
 * 這些全部是畫面用的狀態，和勝負無關。
 */
import type { Renderer } from '../render/renderer';
import { hexToAbgr, type StackModel } from '../render/stack';
import type { Match } from '../sim/match';
import type { Robot } from '../sim/types';
import { CARDS } from '../sim/cards';
import { REF_MASS, weightInfo } from '../sim/gear';
import { ARENA_RADIUS, insideArena } from '../sim/arena';
import { APRON, FENCE_COUNT, FLOOR_Z, POST_COUNT, POST_RADIUS, STAND_COUNT, STAND_DEPTH, STAND_LENGTH, type ArenaModels } from '../models/arena';
import type { Crowd } from './crowd';
import { PITCH_COUNT, PITCH_STEP, ROBOT_RIG as RIG, type PitchedPart, type RobotModels, type RobotParts } from '../models/robot';
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
  /** 重心（髖）相對於站的位置往前、往側邊移多少：出拳時壓到前腳，蓄力時坐回後腳 */
  hipF: number;
  hipS: number;
  /** 腳掌轉動：> 0 是後腳以腳尖為軸轉進來、腳跟離地（後手拳的發力），< 0 是前腳（勾拳） */
  pivot: number;
  /** 踢腿：後腳離開地面、往 (kickF, kickS, kickZ) 踢過去的程度 0..1 */
  kick: number;
  kickF: number;
  kickS: number;
  kickZ: number;
}

/**
 * 實際打出去的招式。戰鬥邏輯只分「刺拳」和「重拳」兩種（決定傷害和時間），
 * 畫面在這兩種裡面再挑一個真的格鬥技：刺拳可能是打頭或打肚子，重拳可能是勾拳、上勾拳、過肩拳、踢腿。
 * 用出手那一刻的 tick 決定，所以重播時挑到的一樣。
 */
type Move =
  | 'jab' | 'bodyJab' | 'cross' | 'bodyCross' | 'hook' | 'bodyHook' | 'uppercut' | 'overhand' | 'rearUpper' | 'kick' | 'teep'
  // 武術流派的招式
  | 'sideKick' | 'spinKick' | 'lowKick' | 'knee' | 'elbow' | 'throw' | 'takedown' | 'palm' | 'headbutt';

/** 打到哪裡：頭被打會往後甩，肚子被打會彎腰，腿被踢會腳軟 */
type Zone = 'head' | 'body';

const BODY_MOVES: ReadonlySet<Move> = new Set(['bodyJab', 'bodyCross', 'bodyHook', 'teep', 'kick', 'sideKick', 'lowKick', 'knee', 'throw', 'takedown', 'palm']);
/** 摔技：被摔的那台會被整個掀起來、背著地 */
const THROW_MOVES: ReadonlySet<Move> = new Set(['throw', 'takedown']);

function hash01(n: number): number {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * 每個流派會用的招式：[輕擊, 重擊]。輕擊有兩組的照出拳的手分（前手、後手）。
 * 沒列的流派（拳擊、閃躲流、街頭亂鬥、沒有流派）用原本的拳擊招式。
 */
const STYLE_MOVES: Record<string, [Move[], Move[]]> = {
  boxing: [['jab', 'jab', 'bodyJab', 'cross', 'bodyCross'], ['hook', 'bodyHook', 'uppercut', 'overhand', 'rearUpper']],
  taichi: [['palm', 'jab'], ['palm', 'throw']],
  karate: [['cross', 'jab', 'teep'], ['kick', 'sideKick', 'cross']],
  taekwondo: [['teep', 'sideKick'], ['kick', 'spinKick', 'kick']],
  muaythai: [['jab', 'teep', 'cross'], ['kick', 'knee', 'elbow', 'kick']],
  kickboxing: [['jab', 'cross', 'bodyJab'], ['kick', 'lowKick', 'hook']],
  wingchun: [['jab', 'cross'], ['palm', 'uppercut']],
  judo: [['jab', 'cross'], ['throw']],
  wrestling: [['jab', 'cross'], ['takedown']],
  bjj: [['teep', 'jab'], ['takedown', 'throw']],
  aikido: [['palm'], ['throw']],
  sumo: [['palm'], ['palm', 'takedown']],
  capoeira: [['teep', 'sideKick'], ['spinKick', 'kick']],
  jkd: [['jab', 'sideKick', 'jab'], ['hook', 'sideKick', 'lowKick']],
  kravmaga: [['jab', 'cross', 'bodyCross'], ['knee', 'elbow', 'hook']],
  sambo: [['jab', 'cross'], ['throw', 'takedown']],
  savate: [['teep', 'sideKick', 'jab'], ['kick', 'sideKick']],
  lethwei: [['jab', 'cross'], ['headbutt', 'elbow', 'kick', 'knee']],
  kyokushin: [['cross', 'bodyCross', 'jab'], ['lowKick', 'kick', 'lowKick']],
  sanda: [['sideKick', 'jab', 'cross'], ['throw', 'kick']],
};

/** 這台的流派（畫面挑招式用） */
function styleOf(match: Match, id: number): string {
  return match.brains[id]?.program.deck.find((c) => CARDS[c]?.kind === 'style') ?? '';
}

function chooseMove(s: Robot, tick: number, style = ''): Move {
  const h = hash01(s.id * 7919 + tick * 31 + (s.attack === 'heavy' ? 17 : 0));
  const pool = STYLE_MOVES[style];
  if (pool) {
    const list = pool[s.attack === 'heavy' ? 1 : 0];
    // 詠春的連環寸拳：左右手輪流
    if (style === 'wingchun' && s.attack === 'jab') return s.arm === 0 ? 'jab' : 'cross';
    return list[Math.floor(h * list.length) % list.length];
  }
  const w = s.spec.loadout.weapon;
  if (s.attack === 'jab') return s.arm === 0 ? (h < 0.72 ? 'jab' : 'bodyJab') : h < 0.7 ? 'cross' : 'bodyCross';
  if (s.arm === 0) return w === 'spear' ? (h < 0.65 ? 'hook' : 'uppercut') : h < 0.45 ? 'hook' : h < 0.72 ? 'bodyHook' : 'uppercut';
  if (w === 'hammer') return h < 0.6 ? 'overhand' : h < 0.85 ? 'kick' : 'rearUpper';
  return h < 0.28 ? 'overhand' : h < 0.48 ? 'rearUpper' : h < 0.85 ? 'kick' : 'teep';
}

/** 每一台的倒地過程（純畫面的物理） */
interface Fall {
  /** timber：被打昏、直挺挺往後倒；crumple：腳軟跪下再往前趴；sit：一屁股坐倒；kneel：跪地撐著 */
  mode: 'timber' | 'crumple' | 'sit' | 'kneel' | 'sprawl';
  /** 倒下時身體面向哪裡（側面被打會轉半圈） */
  yaw: number;
  yawTo: number;
  /** 軀幹前傾角（弧度，+ 往前趴、- 往後躺）和角速度 */
  th: number;
  om: number;
  /** 髖的高度（離地）、垂直速度；髖往身體前方偏多少 */
  hz: number;
  vz: number;
  slide: number;
  /** 兩隻腳站的地方（倒下時腳不會飛走） */
  fx: number;
  fy: number;
  t: number;
  /** 已經撞到地面幾次（第一次撞地揚起灰塵） */
  hits: number;
  /** 被打昏的時候手會僵直舉起來（擊昏反射），過一下才鬆掉 */
  fence: boolean;
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
  /** 多久沒跨步了（秒）。站定之後的第一步要由「移動方向那一側」的腳先出 */
  sinceStep: number;
  /** 最近一次被打，身體被帶往哪個方向（以自己的面向為準，長度 1） */
  hitF: number;
  hitS: number;
  seen: boolean;
  /** 畫的時候用的姿勢：pose 再加上受擊的彈簧晃動 */
  view: Pose;
  /** 現在這一拳（或上一拳）是哪一招，和它開始的動作 */
  move: Move;
  lastAction: Robot['action'];
  /** 最近一次被打到哪裡 */
  zone: Zone;
  /** 受擊晃動：軀幹前後、左右，頭前後、左右（位移和速度） */
  jig: Float64Array;
  lastSinceHit: number;
  lastBlock: number;
  fall: Fall | null;
  /** 跳起來的高度、畫的位置偏移（地板追擊跳到對手身上時用；平滑追上目標） */
  air: number;
  ox: number;
  oy: number;
  /** 各部位累積的損傷：頭、身體、手、腳（0 起跳，越打越多；畫面照這個歪頭、駝背、手垂、跛腳、冒煙） */
  dmg: Float64Array;
}

const puppets = new WeakMap<Robot, Puppet>();

/**
 * 這一幀落在兩個邏輯 tick 之間的哪裡（0..1）。出拳的軌跡用「tick + 這個小數」取樣，
 * 慢動作時一個 tick 會畫好幾幀，拳頭才會一格一格順順地走，不會一次跳到位。純畫面。
 */
let SUB = 0;
export function setSubTick(f: number): void {
  SUB = Math.max(0, Math.min(0.999, f));
}

/** 地板追擊的時間（和 sim/match.ts 的 STOMP_TICKS、LEAP_TICKS 一樣） */
const POUND_STOMP = 20;
const POUND_LEAP = 28;

/** 觀戰選項：第一人稱時不畫自己那一台的身體（只畫手臂），不然會擋住鏡頭 */
export const viewOpts = { hide: -1 };

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
    hipF: 0,
    hipS: 0,
    pivot: 0,
    kick: 0,
    kickF: 0,
    kickS: 0,
    kickZ: 0,
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

/** 這一招打到底的姿勢。w = 打出去的進度 0..1 */
function strikePose(p: Pose, move: Move, w: number): void {
  switch (move) {
    case 'jab':
      // 刺拳：前腳踩進去，前手直直送出去，肩膀護住下巴，頭偏到拳的外側
      p.twist = 0.75;
      p.leanF = 0.14;
      p.hipF = 1.4;
      p.headS = 0.9;
      p.headZ = -0.3;
      setHand(p, 0, 18, -1.5, 20.5);
      setHand(p, 1, 5, 3, 20.8);
      break;
    case 'bodyJab':
      // 打肚子的刺拳：先蹲低（換高度），身體跟著拳往前探
      p.twist = 0.7;
      p.leanF = 0.28;
      p.hipZ = 9;
      p.hipF = 1.8;
      p.headS = 1.1;
      p.headZ = -1;
      setHand(p, 0, 17, -1, 15);
      setHand(p, 1, 5, 3, 19.5);
      break;
    case 'cross':
      // 後手直拳：轉腰，後肩轉到前面
      p.twist = -0.7;
      p.leanF = 0.2;
      p.hipZ = 10.2;
      p.hipF = 2;
      p.hipS = -0.6;
      p.headS = -0.9;
      p.headZ = -0.3;
      p.pivot = 1;
      setHand(p, 1, 17.5, 0.5, 20.5);
      setHand(p, 0, 5.5, -3, 20.8);
      break;
    case 'bodyCross':
      p.twist = -0.75;
      p.leanF = 0.3;
      p.hipZ = 8.8;
      p.hipF = 2.2;
      p.hipS = -0.8;
      p.headS = -1.2;
      p.headZ = -1;
      p.pivot = 1;
      setHand(p, 1, 16.5, 0.5, 14.5);
      setHand(p, 0, 5.5, -3, 19.5);
      break;
    case 'hook':
    case 'bodyHook': {
      // 前手勾拳：手從外側畫一個弧掃進來；打肚子的那種身體壓低、側彎
      const low = move === 'bodyHook';
      const a = mix(1.75, -0.3, w);
      p.twist = mix(-0.2, 1.05, w);
      p.leanF = low ? 0.22 : 0.12;
      p.leanS = low ? -0.16 * w : -0.08 * (1 - w) * -1;
      p.hipZ = low ? 8.9 : 10;
      // 勾拳：重心從前腳甩到後腳，前腳掌跟著轉進來
      p.hipF = mix(0.8, -0.4, w);
      p.hipS = mix(-1.2, 1, w);
      p.pivot = -w;
      p.headZ = low ? -1.2 : -0.4;
      setHand(p, 0, 13.5 * Math.cos(a) + 2, -13.5 * Math.sin(a), low ? 15 : 20);
      setHand(p, 1, 4.5, 3, 20.8);
      break;
    }
    case 'uppercut':
      // 前手上勾拳：先沉下去，再用腿把拳從下往上頂
      p.twist = mix(0.1, 0.75, w);
      p.leanF = mix(0.24, -0.04, w);
      p.leanS = mix(-0.1, 0.04, w);
      p.hipZ = mix(9.2, 11.2, w);
      p.hipF = mix(0.4, 1.2, w);
      p.pivot = -0.6 * w;
      p.headS = 0.8;
      setHand(p, 0, mix(6, 12.5, w), mix(-3, -0.5, w), mix(13, 25, w));
      setHand(p, 1, 5, 3, 20.5);
      break;
    case 'rearUpper':
      p.twist = mix(0.6, -0.65, w);
      p.leanF = mix(0.24, -0.04, w);
      p.leanS = mix(0.1, -0.04, w);
      p.hipZ = mix(9.2, 11.2, w);
      p.hipF = mix(0.2, 1.4, w);
      p.pivot = w;
      p.headS = -0.8;
      setHand(p, 1, mix(4.5, 12.5, w), mix(3, 0.5, w), mix(13, 25, w));
      setHand(p, 0, 6, -3, 20.5);
      break;
    case 'overhand':
      // 後手過肩重拳：從後上方砸下來，重心壓上去，頭往外側沉下去躲反擊
      p.twist = mix(0.85, -0.75, w);
      p.leanF = mix(-0.05, 0.26, w);
      p.hipZ = mix(10.4, 9.4, w);
      p.hipF = mix(-1.4, 2.6, w);
      p.hipS = -0.8 * w;
      p.headS = -1.6 * w;
      p.headZ = -1 * w;
      p.pivot = w;
      setHand(p, 1, mix(-3, 17.5, w), mix(7, 0.5, w), 21 + 4.5 * Math.sin(Math.PI * w));
      setHand(p, 0, 5, -4, 20);
      break;
    case 'kick': {
      // 後腿掃踢：支撐腳轉開、髖翻過去，腿從側面掃進來；身體往反方向倒，後手往後甩保持平衡
      const a = mix(1.5, 0.12, w);
      p.kick = 1;
      p.kickF = 3 + 13 * Math.cos(a);
      p.kickS = 13 * Math.sin(a);
      p.kickZ = mix(7, 15.5, w);
      p.twist = mix(0.3, -1.1, w);
      p.leanF = -0.16;
      p.leanS = -0.24;
      p.hipZ = 11.6;
      p.hipF = 0.6;
      p.hipS = -1;
      p.pivot = -1;
      p.headS = -1.2;
      setHand(p, 0, 6, -2, 21);
      setHand(p, 1, mix(4, -4, w), mix(4, 9.5, w), mix(19, 14, w));
      break;
    }
    case 'teep':
      // 前踢（推踢）：膝蓋先提起來，再用腳底把對手推出去，上身往後仰
      p.kick = 1;
      p.kickF = mix(4, 16, w);
      p.kickS = 1.5;
      p.kickZ = mix(10, 12.5, w);
      p.twist = 0.15;
      p.leanF = -0.3;
      p.hipZ = 11.4;
      p.hipF = -0.8;
      setHand(p, 0, 7, -3, 21);
      setHand(p, 1, 4, 4, 20.5);
      break;
    case 'sideKick':
      // 側踢：身體轉成側面，提膝後用腳跟直直蹬出去
      p.kick = 1;
      p.kickF = mix(2, 18, w);
      p.kickS = mix(1, 0, w);
      p.kickZ = mix(10, 13, w);
      p.twist = -1.2;
      p.leanF = -0.3;
      p.leanS = 0.25;
      p.hipZ = 11.4;
      p.hipF = -0.6;
      setHand(p, 0, 6, -3, 21);
      setHand(p, 1, 2, 5, 18);
      break;
    case 'spinKick': {
      // 後旋踢：整個上身轉一圈，腿從背後甩過來打頭
      const a = mix(2.2, 0.1, w);
      p.kick = 1;
      p.kickF = 3 + 14 * Math.cos(a);
      p.kickS = 14 * Math.sin(a);
      p.kickZ = mix(9, 17, w);
      p.twist = mix(1.4, -2.6, w);
      p.leanF = -0.25;
      p.leanS = -0.3;
      p.hipZ = 11.8;
      p.headS = -1.5;
      setHand(p, 0, 2, -9, 18);
      setHand(p, 1, -2, 8, 17);
      break;
    }
    case 'lowKick': {
      // 低掃：用脛骨掃對手的大腿
      const a = mix(1.5, 0.15, w);
      p.kick = 1;
      p.kickF = 3 + 12 * Math.cos(a);
      p.kickS = 12 * Math.sin(a);
      p.kickZ = mix(4, 5.5, w);
      p.twist = mix(0.3, -1, w);
      p.leanF = -0.05;
      p.leanS = -0.3;
      p.hipZ = 11;
      p.hipS = -0.8;
      p.pivot = -1;
      setHand(p, 0, 7, -2.5, 21);
      setHand(p, 1, mix(4, -2, w), mix(4, 9, w), mix(19, 15, w));
      break;
    }
    case 'knee':
      // 膝撞：雙手抱住對手的頭往下拉，膝蓋往上頂
      p.kick = 1;
      p.kickF = mix(1, 7.5, w);
      p.kickS = 2;
      p.kickZ = mix(5, 12, w);
      p.twist = 0.2;
      p.leanF = -0.2;
      p.hipZ = 11.6;
      p.hipF = 0.8;
      setHand(p, 0, mix(11, 8, w), -3, mix(23, 19, w));
      setHand(p, 1, mix(11, 8, w), 3, mix(23, 19, w));
      break;
    case 'elbow':
      // 後手肘擊：手肘帶頭，從側面橫掃過來
      p.twist = mix(0.7, -1, w);
      p.leanF = 0.18;
      p.hipZ = 10.2;
      p.hipF = 1.2;
      p.hipS = -0.5;
      p.headS = -0.8;
      p.pivot = w;
      setHand(p, 1, mix(4, 9, w), mix(6, -3, w), 24);
      setHand(p, 0, 7, -3, 22);
      break;
    case 'throw':
      // 過肩摔：抓住了，轉身把屁股塞進去，往前一甩
      p.twist = mix(0, -2.4, w);
      p.hipZ = 10 - 1.6 * Math.sin(Math.PI * w);
      p.leanF = mix(0.15, 0.55, w);
      p.hipF = mix(1.2, 2.4, w);
      p.headS = 1;
      setHand(p, 0, mix(13, 0, w), mix(-3, 7, w), 21 + 5 * Math.sin(Math.PI * w) - 6 * w);
      setHand(p, 1, mix(12, 2, w), mix(3, 9, w), mix(20, 12, w));
      break;
    case 'takedown':
      // 抱腿摔：壓低衝進去，雙手環抱對手的腿
      p.hipF = mix(0, 4, w);
      p.hipZ = mix(7.8, 7, w);
      p.leanF = 0.6;
      p.twist = 0.1;
      p.headF = 2.5;
      p.headZ = -1.5;
      p.stance = 1.3;
      setHand(p, 0, mix(9, 15, w), -4, mix(12, 7, w));
      setHand(p, 1, mix(9, 15, w), 4, mix(12, 7, w));
      break;
    case 'palm':
      // 雙掌推：腰往前送，兩隻手掌一起推出去
      p.twist = 0.1;
      p.leanF = 0.2;
      p.hipZ = 10.2;
      p.hipF = mix(-0.8, 2.2, w);
      setHand(p, 0, mix(4, 16, w), -3, 19);
      setHand(p, 1, mix(4, 16, w), 3, 19);
      break;
    case 'headbutt':
      // 頭槌：抓住對手，整個上身往前砸
      p.leanF = mix(-0.1, 0.45, w);
      p.headF = mix(-0.8, 3.5, w);
      p.headZ = mix(0.5, -1.2, w);
      p.hipF = 1.4 * w;
      setHand(p, 0, mix(11, 8, w), -3.5, mix(23, 20, w));
      setHand(p, 1, mix(11, 8, w), 3.5, mix(23, 20, w));
      break;
  }
}

/** 這一招的預備動作。q = 預備的進度 0..1 */
function windupPose(p: Pose, move: Move, q: number): void {
  switch (move) {
    case 'jab':
    case 'cross':
      // 刺拳前的小蓄力：肩膀往後收一點
      p.twist = move === 'jab' ? 0.2 : 0.6;
      setHand(p, move === 'jab' ? 0 : 1, move === 'jab' ? 6 : 2.5, move === 'jab' ? -3.5 : 3.5, 19.5);
      p.hipZ = 10.5;
      break;
    case 'bodyJab':
    case 'bodyCross':
      // 打肚子前先換高度：膝蓋一彎整個人沉下去
      p.hipZ = mix(10.8, 9.4, q);
      p.leanF = mix(0.06, 0.18, q);
      p.twist = move === 'bodyJab' ? 0.25 : 0.6;
      break;
    case 'hook':
    case 'bodyHook':
      // 勾拳：前肩往後拉、手張到外側
      p.twist = mix(0.35, -0.2, q);
      p.hipZ = mix(10.8, move === 'hook' ? 9.9 : 9.2, q);
      p.leanS = -0.08 * q;
      p.hipF = 0.8 * q;
      p.hipS = -1.2 * q;
      setHand(p, 0, mix(8.5, -0.5, q), mix(-2.5, -13, q), mix(19.5, move === 'hook' ? 19 : 16, q));
      break;
    case 'uppercut':
      p.hipZ = mix(10.8, 9.2, q);
      p.leanF = mix(0.06, 0.24, q);
      p.leanS = -0.1 * q;
      p.twist = mix(0.35, 0.1, q);
      setHand(p, 0, mix(8.5, 6, q), mix(-2.5, -3, q), mix(19.5, 13.5, q));
      break;
    case 'rearUpper':
      p.hipZ = mix(10.8, 9.2, q);
      p.leanF = mix(0.06, 0.24, q);
      p.leanS = 0.1 * q;
      p.twist = mix(0.35, 0.6, q);
      setHand(p, 1, mix(4.5, 4.5, q), mix(3.5, 3, q), mix(19.5, 13.5, q));
      break;
    case 'overhand':
      // 過肩重拳：後手拉到後上方，身體往後坐
      p.twist = mix(0.35, 0.85, q);
      p.hipZ = mix(10.8, 10.2, q);
      p.leanF = mix(0.06, -0.06, q);
      p.hipF = -1.4 * q;
      p.hipS = 0.5 * q;
      setHand(p, 1, mix(4.5, -3, q), mix(3.5, 7, q), mix(19.5, 22, q));
      setHand(p, 0, 7.5, -3, 20);
      break;
    case 'kick':
      // 提膝：後腿收起來、髖開始轉
      p.kick = 0.7 * q;
      p.kickF = mix(-4, 0, q);
      p.kickS = mix(4.5, 7, q);
      p.kickZ = mix(0, 7, q);
      p.twist = mix(0.35, 0.5, q);
      p.leanF = mix(0.06, -0.08, q);
      p.hipZ = mix(10.8, 11.4, q);
      p.hipF = 0.5 * q;
      break;
    case 'teep':
      p.kick = 0.8 * q;
      p.kickF = mix(-4, 3, q);
      p.kickS = mix(4.5, 2, q);
      p.kickZ = mix(0, 9, q);
      p.leanF = mix(0.06, -0.12, q);
      p.hipZ = mix(10.8, 11.3, q);
      p.hipF = -0.5 * q;
      break;
    case 'sideKick':
      // 提膝、轉成側面
      p.kick = 0.8 * q;
      p.kickF = mix(-4, 2, q);
      p.kickS = mix(4.5, 1, q);
      p.kickZ = mix(0, 10, q);
      p.twist = mix(0.35, -0.6, q);
      p.leanF = mix(0.06, -0.15, q);
      p.leanS = 0.15 * q;
      p.hipZ = mix(10.8, 11.2, q);
      break;
    case 'spinKick':
      // 先往反方向擰，背對對手
      p.twist = mix(0.35, 1.4, q);
      p.hipZ = mix(10.8, 11.2, q);
      p.kick = 0.3 * q;
      p.kickZ = 3 * q;
      p.headS = 0.8 * q;
      setHand(p, 0, 6, -4, 20);
      setHand(p, 1, 3, 5, 20);
      break;
    case 'lowKick':
      p.kick = 0.6 * q;
      p.kickF = mix(-4, 0, q);
      p.kickS = mix(4.5, 7, q);
      p.kickZ = mix(0, 4, q);
      p.twist = mix(0.35, 0.5, q);
      p.hipZ = mix(10.8, 11, q);
      break;
    case 'knee':
    case 'headbutt':
      // 先抓住對手的頭（泰拳的纏抱）
      setHand(p, 0, mix(8.5, 11, q), mix(-2.5, -3.5, q), mix(19.5, 23, q));
      setHand(p, 1, mix(4.5, 11, q), mix(3.5, 3.5, q), mix(19.5, 23, q));
      p.leanF = mix(0.06, move === 'headbutt' ? -0.1 : 0, q);
      p.headF = move === 'headbutt' ? mix(0.5, -0.8, q) : 0.5;
      p.kick = move === 'knee' ? 0.3 * q : 0;
      p.kickZ = move === 'knee' ? 5 * q : 0;
      p.hipF = 0.6 * q;
      break;
    case 'elbow':
      p.twist = mix(0.35, 0.7, q);
      p.hipZ = mix(10.8, 10.4, q);
      setHand(p, 1, mix(4.5, 3, q), mix(3.5, 6, q), mix(19.5, 22, q));
      setHand(p, 0, 7, -3, 22);
      break;
    case 'throw':
      // 伸手抓住對手的領口和袖子
      setHand(p, 0, mix(8.5, 13, q), mix(-2.5, -3, q), mix(19.5, 21, q));
      setHand(p, 1, mix(4.5, 12, q), mix(3.5, 3, q), mix(19.5, 20, q));
      p.hipF = 1.2 * q;
      p.leanF = mix(0.06, 0.15, q);
      p.hipZ = mix(10.8, 10, q);
      break;
    case 'takedown':
      // 降重心：膝蓋一彎整個人沉下去
      p.hipZ = mix(10.8, 7.8, q);
      p.leanF = mix(0.06, 0.45, q);
      p.headF = mix(0.5, 1.5, q);
      setHand(p, 0, mix(8.5, 9, q), mix(-2.5, -4, q), mix(19.5, 12, q));
      setHand(p, 1, mix(4.5, 9, q), mix(3.5, 4, q), mix(19.5, 12, q));
      break;
    case 'palm':
      setHand(p, 0, mix(8.5, 4, q), -3, mix(19.5, 18, q));
      setHand(p, 1, mix(4.5, 4, q), 3, mix(19.5, 18, q));
      p.hipZ = mix(10.8, 10.2, q);
      p.hipF = -0.8 * q;
      break;
  }
}

// ---------------------------------------------------------------- 出招的完整軌跡
/**
 * 一招從頭到尾的時間軸（單位 tick，從預備動作開始算）：
 *   蓄力 → 出手（拳頭沿著弧線加速飛出去，剛好在打中那個 tick 到位）→ 打穿（多送一點、身體跟著轉）→ 收回（沿另一條路收回下巴）。
 * 戰鬥邏輯只決定「第幾個 tick 打中」，軌跡怎麼走完全是畫面的事。
 */
const KICKS: ReadonlySet<Move> = new Set(['kick', 'teep', 'sideKick', 'spinKick', 'lowKick', 'knee']);
function isKick(move: Move): boolean {
  return KICKS.has(move);
}

/** 出手要花幾個 tick（在打中之前）。重的招式甩得比較久，看得到整個弧線 */
function extendTicks(s: Robot, move: Move): number {
  const w = s.spec[s.attack].windup;
  const e =
    s.attack === 'jab' ? (isKick(move) ? 4.5 : 3.6) : move === 'overhand' || move === 'throw' ? 8 : move === 'spinKick' ? 10 : isKick(move) ? 9 : 6.5;
  return Math.min(e, w * 0.55);
}

/** 打中之後停在「打穿」的姿勢多久 */
function holdTicks(s: Robot, move: Move): number {
  return s.attack === 'heavy' ? (THROW_MOVES.has(move) ? 9 : isKick(move) ? 7 : 5) : 2.5;
}

/** 從預備動作開始算的時間（tick，含小數）。打中的那一刻 = 預備的長度 */
function attackClock(s: Robot): number {
  const w = s.spec[s.attack].windup;
  return s.action === 'windup' ? Math.min(w - 0.001, s.actionTicks + SUB) : w + s.actionTicks + SUB;
}

/** 二次貝茲曲線（拳頭的弧線） */
function bez(a: number, c: number, b: number, t: number): number {
  const u = 1 - t;
  return u * u * a + 2 * u * t * c + t * t * b;
}

/** 這招的拳頭（或腳）是不是本來就畫弧線（勾拳、上勾、過肩、掃踢）；直拳另外加一條曲線 */
const ARC_MOVES: ReadonlySet<Move> = new Set(['hook', 'bodyHook', 'uppercut', 'rearUpper', 'overhand', 'kick', 'spinKick', 'lowKick', 'elbow', 'throw']);
/** 姿勢本身就跟著進度 w 變化的招式（腳、摔、推）：出手時整套照 w 走 */
const PROG_MOVES: ReadonlySet<Move> = new Set(['teep', 'sideKick', 'knee', 'takedown', 'palm', 'headbutt']);

/** 直拳出拳路徑的控制點偏移 [f, s, z]：拳從下巴出去，先略低再往上旋，打到時拳面翻平 */
function straightCurve(move: Move): [number, number, number] {
  switch (move) {
    case 'jab':
      return [0, -1.2, -1.6];
    case 'cross':
      return [-1, 1.6, -1.8];
    case 'bodyJab':
      return [1, -1.5, -2.5];
    case 'bodyCross':
      return [0, 2, -3];
    default:
      return [0, 0, 0];
  }
}

const BODY_KEYS = ['hipZ', 'twist', 'leanF', 'leanS', 'headF', 'headS', 'headZ', 'stance', 'hipF', 'hipS', 'pivot', 'kick', 'kickF', 'kickS', 'kickZ'] as const;

function blendBody(p: Pose, a: Pose, b: Pose, t: number): void {
  for (const k of BODY_KEYS) p[k] = mix(a[k], b[k], t);
}

function attackPose(p: Pose, s: Robot, move: Move, t: number): void {
  const W = s.spec[s.attack].windup;
  const R = s.spec[s.attack].recover;
  const E = extendTicks(s, move);
  const H = holdTicks(s, move);
  const heavy = s.attack === 'heavy';
  const guard = stancePose();
  const load = stancePose();
  windupPose(load, move, 1);
  const arm = move === 'jab' || move === 'bodyJab' || move === 'hook' || move === 'bodyHook' || move === 'uppercut' ? 0 : 1;

  if (t < W - E) {
    // 蓄力：重心坐回後腳、肩膀拉開。最後一小段放慢（蓄滿了停一下），看得到「要來了」
    const q = smooth(t / Math.max(1, W - E));
    windupPose(p, move, q);
    // 蓄滿時身體微微抖一下（重招才有）
    if (heavy && q > 0.85) p.hipZ -= 0.25 * Math.sin(t * 2.4);
    return;
  }
  if (t < W) {
    // 出手：拳頭加速飛出去（越後面越快），身體比手先轉（力量從腳和腰來）
    const u = (t - (W - E)) / E;
    const a = u * u * (1.8 - 0.8 * u);
    const strike = stancePose();
    strikePose(strike, move, ARC_MOVES.has(move) || PROG_MOVES.has(move) ? a : 1);
    blendBody(p, load, strike, smooth(Math.min(1, u * 1.35)));
    if (ARC_MOVES.has(move) || PROG_MOVES.has(move)) {
      // 弧線招式：strikePose 本身就是一條弧，進度用加速過的 a
      for (let i = 0; i < 6; i++) p.hands[i] = mix(load.hands[i], strike.hands[i], Math.min(1, u * 4));
      for (let i = 0; i < 3; i++) p.hands[arm * 3 + i] = strike.hands[arm * 3 + i];
    } else {
      // 直拳：沿著貝茲曲線送出去
      const c = straightCurve(move);
      for (let i = 0; i < 6; i++) p.hands[i] = mix(load.hands[i], strike.hands[i], smooth(u));
      for (let i = 0; i < 3; i++) {
        const a0 = load.hands[arm * 3 + i];
        const b0 = strike.hands[arm * 3 + i];
        p.hands[arm * 3 + i] = bez(a0, (a0 + b0) / 2 + c[i], b0, a);
      }
    }
    return;
  }
  const strike = stancePose();
  strikePose(strike, move, 1);
  const tau = t - W;
  if (tau < H) {
    // 打穿：拳頭多送一點點、腰再多轉一點，像真的打進去
    const o = Math.sin(Math.PI * Math.min(1, tau / H));
    Object.assign(p, strike, { hands: [...strike.hands] });
    const push = heavy ? 1.8 : 1.1;
    const h = arm * 3;
    const df = strike.hands[h] - guard.hands[h];
    const ds = strike.hands[h + 1] - guard.hands[h + 1];
    const dl = Math.hypot(df, ds) || 1;
    p.hands[h] += (df / dl) * push * o;
    p.hands[h + 1] += (ds / dl) * push * o;
    p.twist += Math.sign(strike.twist - guard.twist) * (heavy ? 0.14 : 0.06) * o;
    p.hipF += (heavy ? 0.5 : 0.3) * o;
    if (isKick(move)) p.kickF += 1.2 * o;
    return;
  }
  // 收回：拳頭沿著比較低、比較靠內的路線收回下巴（收得比出得快），身體慢一拍才回到架式
  const back = smooth((tau - H) / Math.max(1, R - H));
  const snap = smooth(Math.min(1, back * (heavy ? 1.5 : 2.3)));
  blendBody(p, strike, guard, back);
  // 踢完腳收回來：先收膝蓋（高度先降、腳往回收），再踩回地上
  if (isKick(move)) {
    p.kickF = mix(strike.kickF, -1, smooth(back * 1.2));
    p.kickS = mix(strike.kickS, 5, back);
    p.kickZ = bez(strike.kickZ, strike.kickZ * 0.85, 5, smooth(back * 1.5));
  }
  for (let i = 0; i < 2; i++) {
    const h = i * 3;
    const lift = i === arm ? -2.2 : 0;
    const inward = i === arm ? (i === 0 ? 1.5 : -1.5) : 0;
    p.hands[h] = bez(strike.hands[h], (strike.hands[h] + guard.hands[h]) / 2 - 1, guard.hands[h], snap);
    p.hands[h + 1] = bez(strike.hands[h + 1], (strike.hands[h + 1] + guard.hands[h + 1]) / 2 + inward, guard.hands[h + 1], snap);
    p.hands[h + 2] = bez(strike.hands[h + 2], (strike.hands[h + 2] + guard.hands[h + 2]) / 2 + lift, guard.hands[h + 2], snap);
  }
}

/** 出招的哪一段：蓄力時姿勢慢慢追，出手和打穿時幾乎完全照軌跡走 */
function attackRate(s: Robot, move: Move): [number, number] {
  const t = attackClock(s);
  const W = s.spec[s.attack].windup;
  const E = extendTicks(s, move);
  if (t < Math.min(2, W - E)) return [22, 28];
  if (t < W - E) return [30, 38];
  if (t < W + holdTicks(s, move)) return [90, 140];
  return [32, 46];
}

/** 依戰鬥狀態算出「現在應該擺成什麼樣子」 */
function targetPose(s: Robot, phase: Match['phase'], time: number, vf: number, vs: number, hitF = -1, hitS = 0, move: Move = 'jab', zone: Zone = 'head'): Pose {
  const p = stancePose();
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
      // 越累節奏越慢、彈得越小、手越掉、身體越往前垮
      const tired = Math.max(0, Math.min(1, 1 - s.energy / s.spec.maxEnergy));
      const hurt = s.hp / s.spec.maxHp < 0.3 ? 1 : 0;
      const live = 1 - 0.65 * tired;
      const hop = (phase === 'intro' ? 1.1 : 0.55) * live;
      p.hipZ += Math.sin(beat) * hop;
      // 重心在前後腳之間換來換去（節奏是彈跳的一半），頭不停離開中線
      p.hipF = Math.sin(beat * 0.5) * 0.9 * live;
      p.hipS = Math.sin(time * 1.7 + s.id * 1.3) * 0.7 * live;
      p.headS = Math.sin(time * 2.6 + s.id) * 0.9 + Math.sin(time * 4.3 + s.id * 2) * 0.4 * live;
      p.headZ = -Math.abs(Math.sin(time * 1.3 + s.id)) * 0.5;
      p.hands[2] += Math.sin(beat + 1.2) * 0.5 - tired * 2.2;
      p.hands[5] += Math.sin(beat + 2.4) * 0.5 - tired * 1.6;
      p.leanF += tired * 0.07 + hurt * 0.05;
      p.headZ -= hurt * 0.6;
      if (s.gassed) {
        // 沒電：大口喘氣，手快舉不起來
        p.hipZ = 10.2 + Math.sin(time * 5) * 0.5;
        p.leanF = 0.2 + Math.sin(time * 5) * 0.03;
        p.hands[2] = 16;
        p.hands[5] = 15.5;
      } else if (phase === 'fight' && s.dashTicks <= 0) {
        // 試探：前手不時點出去一下再收回來（假動作）
        const slot = time * 0.9 + s.id * 0.37;
        const n = Math.floor(slot);
        const roll = ((Math.sin(n * 12.9898 + s.id * 78.233) * 43758.5453) % 1 + 1) % 1;
        const ph = (slot - n) / 0.22;
        if (roll < 0.4 && ph < 1) {
          const out = Math.sin(Math.PI * ph);
          p.hands[0] += out * 4.5;
          p.hands[2] += out * 0.8;
          p.twist += out * 0.15;
        }
      }
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
    case 'windup':
    case 'recover': {
      const t = attackClock(s);
      attackPose(p, s, move, t);
      break;
    }
    case 'guard': {
      // 高位防禦：雙手夾緊護頭、下巴收、重心放低
      const jolt = s.blockStun > 0 ? ((s.blockStun >> 1) & 1 ? 1 : -1) : 0;
      p.hipZ = 9.8;
      p.twist = 0.18;
      p.leanF = 0.13 + (s.blockStun > 0 ? 0.1 * hitF : 0);
      p.leanS = jolt * 0.03 + (s.blockStun > 0 ? 0.1 * hitS : 0);
      p.hipF = s.blockStun > 0 ? 0.9 * hitF : 0.3;
      p.hipS = s.blockStun > 0 ? 0.9 * hitS : 0;
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
      if (zone === 'body') {
        // 肚子被打：彎腰縮起來、手護住肚子、膝蓋一軟
        p.leanF = 0.06 + 0.42 * k;
        p.leanS = (0.2 * hitS + wob * 0.06) * k;
        p.twist = 0.35 + hitS * 0.4 * k;
        p.hipZ = mix(10.8, 8.8, k);
        p.hipF = 1.4 * hitF * k;
        p.hipS = 1.1 * hitS * k;
        p.headF = 0.5 + 1.6 * k;
        p.headZ = -1.4 * k;
        p.stance = 1.25;
        setHand(p, 0, mix(8.5, 6, k), mix(-2.5, -3.5, k), mix(19.5, 14, k));
        setHand(p, 1, mix(4.5, 6, k), mix(3.5, 3, k), mix(19.5, 13.5, k));
        break;
      }
      // 拳從哪邊來，頭和上半身就往另一邊甩，腰跟著被扭過去
      p.leanF = 0.06 + 0.36 * hitF * k;
      p.leanS = (0.34 * hitS + wob * 0.1) * k;
      p.twist = 0.35 + (wob * 0.25 + hitS * 0.6) * k;
      p.hipZ = mix(10.8, 10, k);
      p.hipF = 1.2 * hitF * k;
      p.hipS = 1.2 * hitS * k;
      p.headF = 0.5 + 2.7 * hitF * k;
      p.headS = 2.6 * hitS * k;
      p.headZ = -0.6 * k;
      p.stance = 1.2;
      setHand(p, 0, mix(8.5, 5, k), mix(-2.5, -7.5, k), mix(19.5, 15, k));
      setHand(p, 1, mix(4.5, 2, k), mix(3.5, 8, k), mix(19.5, 14, k));
      break;
    }
    case 'down':
    case 'ko':
    case 'tko':
      // 倒地另外用 drawFallen 畫；這裡只是讓站姿停在膝蓋彎下去的樣子，爬起來時接得上
      p.hipZ = 5;
      p.leanF = 0.5;
      p.twist = 0;
      setHand(p, 0, 9, -6, 3);
      setHand(p, 1, 5, 7, 6);
      break;
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
    case 'pound': {
      const at = s.leap ? POUND_LEAP : POUND_STOMP;
      const t = s.actionTicks;
      if (s.leap) {
        if (t < at) {
          // 跳起來：縮腿、雙手舉過頭準備砸下去
          const k = t / at;
          p.hipZ = mix(9, 8, k);
          p.leanF = 0.25;
          p.headF = 1.4;
          setHand(p, 0, 4, -4, 27);
          setHand(p, 1, 4, 4, 27);
          p.stance = 0.8;
        } else {
          // 騎在對手身上：跪坐、上身壓低，左右手輪流往下砸
          const ph = (t - at) * 0.35;
          const l = Math.max(0, Math.sin(ph));
          const rr = Math.max(0, Math.sin(ph + Math.PI));
          p.hipZ = 5.2;
          p.leanF = 0.62;
          p.headF = 2.2;
          p.headZ = -1.5;
          p.stance = 1.4;
          setHand(p, 0, mix(9, 13, l), -2.5, mix(19, 3, l));
          setHand(p, 1, mix(9, 13, rr), 2.5, mix(19, 3, rr));
        }
      } else {
        // 踩：後腳膝蓋高高抬起，打中那一下用力往地上踩
        const k = Math.min(1, t / at);
        const down = t >= at ? 1 : 0;
        p.hipZ = 11.2 - down * 1.2;
        p.leanF = 0.15 + down * 0.12;
        p.headF = 1.6;
        p.headZ = -0.8;
        p.kick = 1;
        p.kickF = mix(4, 10, k);
        p.kickS = 1;
        p.kickZ = down ? 0.3 : mix(2, 11, k);
        setHand(p, 0, 7, -6, 17);
        setHand(p, 1, 3, 7, 15);
      }
      break;
    }
    case 'held': {
      // 被裁判架住：身體往前衝、雙手亂抓，腳被往後拖
      const w = Math.sin(time * 16 + s.id);
      p.hipZ = 9.6;
      p.leanF = 0.42;
      p.leanS = w * 0.08;
      p.headF = 2;
      p.headS = w * 0.8;
      p.stance = 1.3;
      setHand(p, 0, 13 + w * 2, -4, 20 + w * 2);
      setHand(p, 1, 13 - w * 2, 4, 20 - w * 2);
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
function poseRate(s: Robot, move: Move): [number, number] {
  switch (s.action) {
    case 'pound':
      return [18, 34];
    case 'held':
      return [14, 22];
    case 'recover':
    case 'windup':
      return attackRate(s, move);
    case 'stagger':
      return s.actionTicks < 5 ? [50, 50] : [12, 12];
    case 'guard':
      return [26, 30];
    case 'down':
    case 'ko':
    case 'tko':
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
  return {
    pose: stancePose(),
    view: stancePose(),
    feet: [foot(0), foot(1)],
    lastX: s.x,
    lastY: s.y,
    vx: 0,
    vy: 0,
    lastStep: 1,
    sinceStep: 9,
    hitF: -1,
    hitS: 0,
    seen: false,
    move: 'jab',
    lastAction: 'idle',
    zone: 'head',
    jig: new Float64Array(8),
    lastSinceHit: 9999,
    lastBlock: 0,
    fall: null,
    air: 0,
    ox: 0,
    oy: 0,
    dmg: new Float64Array(4),
  };
}

/** 腳：站穩的腳不動；離該站的位置太遠才抬起來跨一步，兩腳輪流 */
function updateFeet(pu: Puppet, s: Place, stance: number, pivot: number, dt: number, kick = 0): void {
  const c = Math.cos(s.heading);
  const n = Math.sin(s.heading);
  const speed = Math.hypot(pu.vx, pu.vy);
  // 走得越快，步子邁得越快、越往前踩
  const dur = speed > 90 ? 0.07 : speed > 30 ? 0.1 : 0.14;
  const lead = Math.min(0.12, dur * 0.8);
  const errs = [0, 0];
  const homes = [0, 0, 0, 0];
  // 格鬥步法：往哪邊走，那一側的腳先出，另一隻再跟上，兩腳不交叉
  const vf = pu.vx * c + pu.vy * n;
  const vs = -pu.vx * n + pu.vy * c;
  const first = Math.abs(vf) >= Math.abs(vs) ? (vf >= 0 ? 0 : 1) : vs < 0 ? 0 : 1;
  pu.sinceStep += dt;
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
    // 踢腿的那隻腳在空中，等踢完再說；支撐腳也不要在這時候跨步
    if (kick > 0.12) {
      if (i === 1) continue;
      foot.t = -1;
    }
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
      // 站定之後的第一步：等該先出的那隻腳
      const waitFirst = pu.sinceStep > 0.28 && speed > 6 && i !== first && errs[1 - i] > 2;
      const myTurn = other.t < 0 && !waitFirst && (errs[i] >= errs[1 - i] || pu.lastStep !== i);
      if (want && (myTurn || errs[i] > 11)) {
        pu.sinceStep = 0;
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
      // 小碎步貼著地滑，大步才抬高
      foot.lift = Math.sin(Math.PI * Math.min(1, foot.t)) * Math.min(2.6, 1.1 + errs[i] * 0.14);
      const da = Math.atan2(Math.sin(s.heading + FOOT_SPLAY[i] - foot.ang), Math.cos(s.heading + FOOT_SPLAY[i] - foot.ang));
      foot.ang += da * Math.min(1, dt * 18);
      if (foot.t >= 1) {
        foot.t = -1;
        foot.lift = 0;
      }
    } else {
      // 踩在地上的腳以腳尖為軸轉：後手拳轉後腳、勾拳轉前腳，腳跟離地
      const turn = i === 1 ? Math.max(0, pivot) : Math.max(0, -pivot);
      const want = s.heading + FOOT_SPLAY[i] * (1 - turn) + (i === 0 ? 0.55 * turn : 0);
      const da = Math.atan2(Math.sin(want - foot.ang), Math.cos(want - foot.ang));
      if (turn > 0.05 || Math.abs(da) < 0.7) foot.ang += da * Math.min(1, dt * 22);
      foot.lift = turn * 0.9;
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
  // 四肢變細之後節距要密一點（1.2 格一節），斜著的手腳才不會斷成一顆一顆
  const n = Math.max(1, Math.ceil(len / 1.2));
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
    pose.hipF += (target.hipF - pose.hipF) * kb;
    pose.hipS += (target.hipS - pose.hipS) * kb;
    pose.pivot += (target.pivot - pose.pivot) * kh;
    pose.kick += (target.kick - pose.kick) * kh;
    pose.kickF += (target.kickF - pose.kickF) * kh;
    pose.kickS += (target.kickS - pose.kickS) * kh;
    pose.kickZ += (target.kickZ - pose.kickZ) * kh;
    for (let i = 0; i < 6; i++) pose.hands[i] += (target.hands[i] - pose.hands[i]) * kh;
  }
  updateFeet(pu, s, pose.stance, pose.pivot, dt, pose.kick);
  // 畫的姿勢 = 目標追上來的姿勢 + 受擊彈簧（被打的那一下頭和身體會甩過去、晃一下再回來）
  const v = pu.view;
  Object.assign(v, pose);
  v.hands = pose.hands;
  const j = pu.jig;
  v.leanF += j[0];
  v.leanS += j[1];
  v.headF += j[2];
  v.headS += j[3];
}

/**
 * 受擊的彈簧：位移被拉回 0，阻尼不夠所以會晃一兩下。越重的骨架晃得越慢、越小。
 * jig 的排列：[軀幹前後, 軀幹左右, 頭前後, 頭左右, 以及四個速度]
 */
function stepJig(j: Float64Array, mass: number, dt: number): void {
  const k = 170 / mass;
  const c = 2 * 0.32 * Math.sqrt(k);
  // 分幾小步積分，慢動作或掉幀都穩
  const n = Math.max(1, Math.ceil(dt / 0.008));
  const h = dt / n;
  for (let step = 0; step < n; step++)
    for (let i = 0; i < 4; i++) {
      j[i + 4] += (-k * j[i] - c * j[i + 4]) * h;
      j[i] += j[i + 4] * h;
    }
}

function kickJig(j: Float64Array, f: number, s: number, power: number, mass: number): void {
  const p = power / Math.sqrt(mass);
  j[4] += f * p * 1.6;
  j[5] += s * p * 1.6;
  j[6] += f * p * 26;
  j[7] += s * p * 26;
}

/** 照骨架現在的姿勢把整個身體畫出來 */
function drawBody(r: Renderer, parts: RobotParts, shoulderSide: number, pu: Puppet, s: Place, armsOnly = false): void {
  const pose = pu.view;
  const air = pu.air;
  const ch = Math.cos(s.heading);
  const sh = Math.sin(s.heading);
  const upper = s.heading + pose.twist;
  const cu = Math.cos(upper);
  const su = Math.sin(upper);
  // 傾斜（世界座標，每層）
  const shx = pose.leanF * ch - pose.leanS * sh;
  const shy = pose.leanF * sh + pose.leanS * ch;
  // 髖稍微跟著重心走：前傾時屁股往後一點，才不會像整根柱子倒下去
  const hipX = s.x - shx * 3 + pose.hipF * ch - pose.hipS * sh;
  const hipY = s.y - shy * 3 + pose.hipF * sh + pose.hipS * ch;
  const hipZ = FLOOR_Z + pose.hipZ + RIG.legExtra + air;

  // 腿
  const hipAng = s.heading + pose.twist * 0.3;
  const chp = Math.cos(hipAng);
  const shp = Math.sin(hipAng);
  for (let i = 0; i < 2 && !armsOnly; i++) {
    const foot = pu.feet[i];
    const side = i === 0 ? -RIG.hipSide : RIG.hipSide;
    const hx = hipX - side * shp;
    const hy = hipY + side * chp;
    let fx = foot.x;
    let fy = foot.y;
    let fz = FLOOR_Z + foot.lift + air;
    let fa = foot.ang;
    // 膝蓋朝前、微微外開
    let kx = ch * 1 - sh * side * 0.12;
    let ky = sh * 1 + ch * side * 0.12;
    let kz = 0.25;
    if (i === 1 && pose.kick > 0.01) {
      // 踢腿：後腳離開地面往目標踢，膝蓋朝上、朝外翻
      const k = pose.kick;
      const tx = s.x + pose.kickF * ch - pose.kickS * sh;
      const ty = s.y + pose.kickF * sh + pose.kickS * ch;
      fx = mix(fx, tx, k);
      fy = mix(fy, ty, k);
      fz = mix(fz, FLOOR_Z + air + pose.kickZ, k);
      fa = Math.atan2(ty - hy, tx - hx);
      kx = ch * 0.4 - sh * 0.9;
      ky = sh * 0.4 + ch * 0.9;
      kz = 1;
    }
    const az = fz + 2.5;
    solveJoint(hx, hy, hipZ, fx, fy, az, RIG.thigh, RIG.shin, kx, ky, kz);
    limb(r, parts.thigh, hx, hy, hipZ - 1, joint.x, joint.y, joint.z, s.heading);
    limb(r, parts.shin, joint.x, joint.y, joint.z, fx, fy, az, s.heading);
    r.drawStack(parts.foot, fx, fy, fz, fa);
  }

  // 軀幹和頭（第一人稱時不畫自己的，只留手臂）
  if (!armsOnly) {
    r.drawStack(parts.torso, hipX, hipY, hipZ, upper, shx, shy);
    const neckX = hipX + shx * RIG.neckZ + pose.headF * ch - pose.headS * sh;
    const neckY = hipY + shy * RIG.neckZ + pose.headF * sh + pose.headS * ch;
    r.drawStack(parts.head, neckX, neckY, hipZ + RIG.neckZ + pose.headZ, s.heading + pose.twist * 0.4, shx * 0.5, shy * 0.5);
  }

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
    const tz = FLOOR_Z + air + pose.hands[i * 3 + 2];
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
    if (!armsOnly) r.drawStack(parts.pad, sx, sy, sz - 1.5, upper);
    limb(r, parts.upper, sx, sy, sz, joint.x, joint.y, joint.z, upper);
    limb(r, parts.fore, joint.x, joint.y, joint.z, hx, hy, hz, upper);
    // 手（武器）順著前臂的方向
    const fx = hx - joint.x;
    const fy = hy - joint.y;
    const handAng = Math.hypot(fx, fy) > 1.5 ? Math.atan2(fy, fx) : upper;
    r.drawStack(parts.hand, hx, hy, hz - 2, handAng);
  }
}

/** 骨架的重量：越重的骨架被打時晃得越慢、越小 */
function massOf(s: Robot): number {
  // 總重（含裝甲）相對於基準 74 公斤：越重晃得越慢、越小
  const m = weightInfo(s.spec.loadout).mass;
  return Math.max(0.9, Math.min(1.9, Math.sqrt(m / REF_MASS)));
}

/**
 * s 是戰鬥邏輯裡的那台，v 是「畫在哪裡」的那台（位置加上了步法的距離，見 spacing）。
 * 狀態一律讀 s，位置一律用 v。
 */
function drawRobot(r: Renderer, s: Robot, v: Robot, m: RobotModels, match: Match, time: number, dt: number, fx: Fx): void {
  let pu = puppets.get(s);
  if (!pu) {
    pu = newPuppet(v);
    puppets.set(s, pu);
  }
  const [vf, vs] = trackVelocity(pu, v, dt);
  // 新的一招：照出手那一刻的 tick 挑一個真的格鬥技
  if (s.action === 'windup' && pu.lastAction !== 'windup') pu.move = chooseMove(s, match.tick - s.actionTicks, styleOf(match, s.id));
  pu.lastAction = s.action;
  const [bodyRate, handRate] = poseRate(s, pu.move);
  // 剛被打到（或擋到）的那一刻，記下身體被打往哪個方向，挨打的姿勢照這個方向倒
  if (s.sinceHit <= 1 || s.blockStun > 0) {
    const kf = s.kx * Math.cos(s.heading) + s.ky * Math.sin(s.heading);
    // 拳不會每次都從正面來：連續挨打時左右交替偏一點，頭才會被打得左右甩
    const ks = -s.kx * Math.sin(s.heading) + s.ky * Math.cos(s.heading) + (s.hitStreak & 1 ? 0.5 : -0.5) * Math.abs(kf);
    const km = Math.hypot(kf, ks);
    if (km > 0.15) {
      pu.hitF = kf / km;
      pu.hitS = ks / km;
    }
  }
  // 新挨的一下：看對手用的是哪一招（打頭還是打肚子），再給身體一下彈簧的衝擊
  const fresh = s.sinceHit < pu.lastSinceHit;
  const blockedNow = s.blockStun > pu.lastBlock;
  if (fresh || blockedNow) {
    const foe = puppets.get(match.robots[1 - s.id]);
    const body = foe ? BODY_MOVES.has(foe.move) : false;
    if (fresh) pu.zone = body ? 'body' : 'head';
    // 部位損傷：擋下來的打在手上；低掃打在腳上；其他看打頭還是打肚子
    const hurt = Math.hypot(s.kx, s.ky);
    if (blockedNow && !fresh) pu.dmg[2] += hurt * 0.5;
    else if (fresh) pu.dmg[foe?.move === 'lowKick' ? 3 : body ? 1 : 0] += hurt + (s.action === 'down' ? 1.2 : 0);
    const power = Math.hypot(s.kx, s.ky) * (blockedNow && !fresh ? 0.35 : 1);
    // 打頭：頭甩得多；打肚子：身體折得多、頭比較少
    kickJig(pu.jig, pu.hitF * (body ? 1.6 : 1), pu.hitS * (body ? 0.6 : 1), power * (body ? 0.7 : 1), massOf(s));
    if (body) pu.jig[4] += 0.9;
    // 有效的重擊：裁判和觀眾嚇一跳（純畫面）
    if (fresh && power > 1.6) shock(match, time, Math.min(1, power / 3));
  }
  pu.lastSinceHit = s.sinceHit;
  pu.lastBlock = s.blockStun;
  stepJig(pu.jig, massOf(s), dt);
  // 地板追擊：跳到對手身上（畫面位置往對手倒下的軀幹靠）；其他時候偏移慢慢回到 0
  let wantX = 0;
  let wantY = 0;
  let wantAir = 0;
  if (s.action === 'pound' && s.leap) {
    const foe = match.robots[1 - s.id];
    const fp = puppets.get(foe);
    const t = s.actionTicks + SUB;
    if (fp?.fall) {
      const st = Math.sin(fp.fall.th);
      // 對手軀幹中間（倒下的方向多出去一點）
      const bx = foe.x + Math.cos(fp.fall.yaw) * st * 6;
      const by = foe.y + Math.sin(fp.fall.yaw) * st * 6;
      const k = smooth(Math.min(1, t / POUND_LEAP));
      wantX = (bx - v.x) * k;
      wantY = (by - v.y) * k;
    }
    wantAir = t < POUND_LEAP ? Math.sin(Math.PI * (t / POUND_LEAP)) * 13 : 2.5;
  }
  // 開打前：像 UFC 一樣走到場中間碰拳，再退回去（純畫面，邏輯上兩台一直站在角落）
  const foeNow = match.robots[1 - s.id];
  let touch = 0;
  if (match.phase === 'intro') {
    const t = match.phaseTicks + SUB;
    const env = t < 18 ? 0 : t < 62 ? smooth((t - 18) / 44) : t < 104 ? 1 : smooth(1 - (t - 104) / 36);
    touch = t > 64 && t < 100 ? smooth(Math.min(1, (t - 64) / 8)) * smooth(Math.min(1, (100 - t) / 8)) : 0;
    const ex = foeNow.x - s.x;
    const ey = foeNow.y - s.y;
    const el = Math.hypot(ex, ey) || 1;
    const go = Math.max(0, el / 2 - 11) * env;
    wantX = (ex / el) * go;
    wantY = (ey / el) * go;
  }
  // 贏了：跑到最近的圍網邊、爬上去振臂（純畫面），之後跳下來讓裁判舉手
  let climbing = false;
  if (match.phase === 'over' && s.action === 'win' && match.phaseTicks > 12 && match.phaseTicks < 150) {
    const r0 = Math.hypot(s.x, s.y) || 1;
    const fx0 = (s.x / r0) * (ARENA_RADIUS - 9);
    const fy0 = (s.y / r0) * (ARENA_RADIUS - 9);
    const k = smooth(Math.min(1, (match.phaseTicks - 12) / 40)) * smooth(Math.min(1, (150 - match.phaseTicks) / 20));
    wantX = (fx0 - v.x) * k;
    wantY = (fy0 - v.y) * k;
    climbing = k > 0.9;
  }
  const ko = 1 - Math.exp(-dt * (s.action === 'pound' ? 30 : match.phase === 'intro' ? 20 : 8));
  pu.ox += (wantX - pu.ox) * ko;
  pu.oy += (wantY - pu.oy) * ko;
  const airWant = s.action === 'pound' && s.leap ? wantAir : climbing ? 6 + Math.abs(Math.sin(time * 5)) * 1.2 : 0;
  pu.air = s.action === 'pound' && s.leap ? wantAir : pu.air + (airWant - pu.air) * Math.min(1, dt * (climbing ? 5 : 12));
  if (Math.abs(pu.ox) + Math.abs(pu.oy) > 0.05 || climbing) {
    const moved = Object.create(v) as Robot;
    moved.x = v.x + pu.ox;
    moved.y = v.y + pu.oy;
    // 爬網的時候面向觀眾（背對擂台中間）
    if (climbing) moved.heading = Math.atan2(moved.y, moved.x);
    v = moved;
  }
  const tp = targetPose(s, match.phase, time, vf, vs, pu.hitF, pu.hitS, pu.move, pu.zone);
  if (touch > 0) {
    // 碰拳：前手伸到兩台中間
    setHand(tp, 0, mix(tp.hands[0], 12.5, touch), mix(tp.hands[1], -0.5, touch), mix(tp.hands[2], 18.5, touch));
    tp.leanF += 0.1 * touch;
  }
  if (climbing) {
    // 一手抓網、一手往觀眾比，身體往後仰
    setHand(tp, 0, 5, -6, 24 + Math.sin(time * 9) * 1.5);
    setHand(tp, 1, 2, 9, 30 + Math.sin(time * 7) * 2);
    tp.leanF = -0.12;
    tp.hipZ = 10.5;
  }
  settle(pu, v, tp, bodyRate, handRate, dt);
  slip(pu, s, foeNow, match);
  if (s.action !== 'down' && s.action !== 'ko' && s.action !== 'tko') wounds(pu, v, s, time, dt, fx);

  const lying = s.action === 'down' || s.action === 'ko' || s.action === 'tko';
  if (lying && !pu.fall) {
    const foe = puppets.get(match.robots[1 - s.id]);
    pu.fall = startFall(v, pu, !!foe && THROW_MOVES.has(foe.move) && foe.lastAction !== 'idle');
    shock(match, time, 1);
  }
  // 跪在地上又被追擊打中：整個被打趴下去
  if (fresh && pu.fall && s.action === 'down' && pu.fall.mode === 'kneel') pu.fall.mode = 'crumple';
  if (pu.fall && (lying || s.action === 'getup')) {
    // 爬起來的前半段還在地上：從躺著撐到單膝跪地，後半段交給站姿
    if (s.action === 'getup' && s.actionTicks > GETUP_HANDOFF) {
      pu.fall = null;
      placeFeet(pu, v);
    } else {
      stepFall(pu.fall, v, m, dt, fx);
      // 爬起來時閃爍，表示無敵
      if (s.action === 'getup' && (s.actionTicks >> 1) & 1) return;
      if (viewOpts.hide !== s.id) drawFallen(r, m, pu.fall, v);
      return;
    }
  } else pu.fall = null;
  // 爬起來時閃爍，表示無敵
  if (s.action === 'getup' && (s.actionTicks >> 1) & 1) return;
  drawBody(r, s.hitFlash > 0 ? m.white : m.normal, m.shoulderSide, pu, v, viewOpts.hide === s.id);
}

/**
 * 閃躲（純畫面）：對手的拳揮空了，就讓自己看起來是「閃掉的」——
 * 刺拳往旁邊偏頭（slip），重拳彎腰從底下鑽過去（roll／duck）。
 */
function slip(pu: Puppet, s: Robot, foe: Robot, match: Match): void {
  if (!foe.whiffed || foe.action !== 'recover' || s.action === 'down' || s.action === 'ko') return;
  const t = foe.actionTicks + SUB;
  const len = foe.attack === 'heavy' ? 16 : 11;
  if (t > len) return;
  const d = Math.hypot(foe.x - s.x, foe.y - s.y);
  if (d > foe.spec[foe.attack].reach + 14) return;
  const e = Math.sin(Math.PI * Math.min(1, t / len));
  const side = (match.tick - foe.actionTicks) & 1 ? 1 : -1;
  const w = pu.view;
  if (foe.attack === 'heavy') {
    w.hipZ -= 2.2 * e;
    w.leanF += 0.3 * e;
    w.leanS += side * 0.12 * e;
    w.headF += 1.2 * e;
    w.headZ -= 1 * e;
  } else {
    w.leanS += side * 0.24 * e;
    w.headS += side * 2.4 * e;
    w.hipS += side * 0.8 * e;
    w.hipZ -= 0.5 * e;
  }
}

/**
 * 部位損傷（純畫面）：打頭打多了頭歪一邊、冒煙；肚子挨多了駝背；手擋多了護不高；腳被踢多了一跛一跛。
 * 只改畫的姿勢（pu.view），不回寫目標姿勢，所以不會越疊越多。
 */
function wounds(pu: Puppet, v: Robot, s: Robot, time: number, dt: number, fx: Fx): void {
  const lv = (i: number): number => Math.min(1, pu.dmg[i] / 9);
  const lh = lv(0);
  const lb = lv(1);
  const la = lv(2);
  const ll = lv(3);
  if (lh + lb + la + ll < 0.05) return;
  const w = pu.view;
  const side = s.id === 0 ? 1 : -1;
  // 頭：歪向一邊、偶爾抖一下（像接觸不良）
  const glitch = lh > 0.5 && Math.sin(time * 23 + s.id * 5) > 0.93 ? 0.8 : 0;
  w.headS += side * 0.9 * lh + glitch;
  w.headZ -= 0.6 * lh;
  // 身體：駝背、沉下去
  w.leanF += 0.1 * lb;
  w.hipZ -= 0.5 * lb;
  // 手：護不高，受傷的那隻手垂下來晃
  if (la > 0.02) {
    w.hands = [...w.hands] as Pose["hands"];
    w.hands[2] -= 3.5 * la;
    w.hands[5] -= 2 * la + Math.sin(time * 5 + s.id) * 0.6 * la;
  }
  // 腳：跛，走一步沉一下、身體往傷腳那邊歪
  const walk = Math.abs(Math.sin(time * 6 + s.id));
  w.hipZ -= 0.9 * ll * walk;
  w.leanS += 0.07 * ll;
  // 冒煙、噴火花：傷越重越常冒
  const z = FLOOR_Z + pu.air;
  if (lh > 0.3 && Math.random() < dt * 3 * lh) fx.smoke(v.x, v.y, z + RIG.neckZ + RIG.hipZ + 3, 1);
  if (lh > 0.6 && Math.random() < dt * 1.5 * lh) fx.sparks(v.x, v.y, z + RIG.neckZ + RIG.hipZ + 2, 2, 0.35);
  if (lb > 0.35 && Math.random() < dt * 2.5 * lb) fx.smoke(v.x, v.y, z + RIG.chestZ, 1);
  if (ll > 0.4 && Math.random() < dt * 2 * ll) fx.sparks(v.x, v.y, z + 6, 1, 0.3);
}

// ---------------------------------------------------------------- 驚嚇（裁判、觀眾的反應）
/** 最近一次「有效重擊／擊倒」發生的時間和多大力（裁判、觀眾照這個做誇張的反應） */
const shocks = new WeakMap<Match, { at: number; power: number }>();
function shock(match: Match, time: number, power: number): void {
  const prev = shocks.get(match);
  if (prev && time - prev.at < 0.25 && prev.power >= power) return;
  shocks.set(match, { at: time, power });
}
/** 驚嚇的程度 0..1：一下子跳到最高，之後在約一秒內退掉 */
function shockLevel(match: Match, time: number): number {
  const s = shocks.get(match);
  if (!s) return 0;
  const d = time - s.at;
  if (d < 0 || d > 1.3) return 0;
  return s.power * (d < 0.08 ? d / 0.08 : 1 - smooth((d - 0.08) / 1.22));
}

// ---------------------------------------------------------------- 步法與距離
/**
 * 格鬥的距離感（純畫面）。戰鬥邏輯的兩台只隔一個身位（兩個半徑），站著不動時看起來像黏在一起。
 * 畫的時候每台往後退一小步，保持在「拳頭搆不到」的距離外，像 UFC 選手一樣在距離邊緣進進出出；
 * 出手時踩進去，剛好在打中的那個 tick 回到邏輯的位置（拳頭和火花對得上），打完再退出來。
 * 只改畫在哪裡，不改邏輯的位置，所以勝負、重播都不受影響。
 */
interface Spacing {
  /** 每台往後退多少（負的是往前踩進去） */
  o: [number, number];
  /** 出手那一刻的退後量（從這裡平滑踩到打中的位置） */
  from: [number, number];
  attacking: [boolean, boolean];
}
const spacings = new WeakMap<Match, Spacing>();


/** 算出兩台這一幀要畫在哪裡 */
/**
 * 平滑：畫面位置在「上一個 tick」和「這一個 tick」之間內插（SUB 是這一幀落在兩個 tick 之間的哪裡）。
 * 120Hz 的手機螢幕一個 tick 會畫兩幀，不內插的話機器人每兩幀才動一次，看起來一頓一頓的。純畫面。
 */
const lastPos = new WeakMap<Robot, { tick: number; px: number; py: number; x: number; y: number; ph: number; h: number }>();
function smoothPos(match: Match, s: Robot): Robot {
  let p = lastPos.get(s);
  if (!p) {
    p = { tick: match.tick, px: s.x, py: s.y, x: s.x, y: s.y, ph: s.heading, h: s.heading };
    lastPos.set(s, p);
  }
  if (p.tick !== match.tick) {
    // 新的 tick：上一個位置變成起點（跳太遠的是回角落、重新開始，不內插）
    const far = Math.hypot(s.x - p.x, s.y - p.y) > 8;
    p.px = far ? s.x : p.x;
    p.py = far ? s.y : p.y;
    p.x = s.x;
    p.y = s.y;
    // 面向也一起內插（P21）：轉身不會一格一格跳
    p.ph = far ? s.heading : p.h;
    p.h = s.heading;
    p.tick = match.tick;
  }
  if (p.px === s.x && p.py === s.y && p.ph === s.heading) return s;
  const v = Object.create(s) as Robot;
  v.x = mix(p.px, s.x, SUB);
  v.y = mix(p.py, s.y, SUB);
  let dh = s.heading - p.ph;
  while (dh > Math.PI) dh -= Math.PI * 2;
  while (dh < -Math.PI) dh += Math.PI * 2;
  v.heading = s.heading - dh * (1 - SUB);
  return v;
}

function spacing(match: Match, time: number, dt: number): [Robot, Robot] {
  const a = smoothPos(match, match.robots[0]);
  const b = smoothPos(match, match.robots[1]);
  let sp = spacings.get(match);
  if (!sp) {
    sp = { o: [0, 0], from: [0, 0], attacking: [false, false] };
    spacings.set(match, sp);
  }
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy) || 1;
  const nx = dx / d;
  const ny = dy / d;
  const fighting = match.phase === 'fight';
  // 平常要退多少：邏輯上越近退越多（最多 9 格，大約一個前臂），已經離很遠就不用退
  // （P21 從 7.5 拉到 9：兩台之間留得出一條縫，看得到拳從哪裡打過去，不會擠成一團）
  const base = (i: number): number => {
    const s = match.robots[i];
    if (!fighting || s.action === 'down' || s.action === 'ko' || s.action === 'tko' || s.action === 'getup' || s.action === 'win') return 0;
    // 被打到踉蹌：照樣往後退開（P21 之前是收回來，連續挨打時兩台會黏在一起）
    if (s.action === 'stagger') return Math.max(0, Math.min(9, (48 - d) * 0.55)) * 0.9;
    // 進進出出的小節奏，兩台錯開
    const bounce = 1 + 0.2 * Math.sin(time * 1.9 + i * 2.4) + 0.08 * Math.sin(time * 4.7 + i);
    const tired = s.gassed ? 0.6 : 1;
    return Math.max(0, Math.min(9, (48 - d) * 0.55)) * bounce * tired;
  };
  // 只有「預備」那一段要踩進去對準打中的 tick；打中之後（收招）兩台各自退回節奏距離，
  // 不然一來一往時兩台永遠貼在邏輯距離（身體碰身體）上，畫面擠成一團（P21）
  const att = [match.robots[0].action === 'windup', match.robots[1].action === 'windup'];
  const target = [base(0), base(1)];
  // 先動沒在出手的那台（照節奏進出），出手的那台再照對手「現在」退了多少踩進去
  const order = att[0] && !att[1] ? [1, 0] : [0, 1];
  for (const i of order) {
    const s = match.robots[i];
    // 出手的那台：踩進去把兩台之間多退的距離吃掉（對手站著不動），打中時兩台剛好回到邏輯的距離
    if (att[i]) target[i] = att[1 - i] ? 0 : -sp.o[1 - i];
    if (att[i] && !sp.attacking[i]) sp.from[i] = sp.o[i];
    sp.attacking[i] = att[i];
    if (att[i] && s.action === 'windup') {
      // 照預備的進度踩進去，保證打中那個 tick 到位
      const w = s.spec[s.attack].windup;
      const q = smooth(Math.min(1, (s.actionTicks + SUB) / w) * 1.08);
      sp.o[i] = mix(sp.from[i], target[i], q);
    } else if (att[i]) sp.o[i] = target[i];
    else {
      sp.o[i] += (target[i] - sp.o[i]) * (1 - Math.exp(-dt * 7));
      // 被逼到籠邊就退不了：先把退後量收到籠子裡面，出手的那台才踩得剛好
      const sign = i === 0 ? 1 : -1;
      for (let k = 0; k < 10 && sp.o[i] > 0.05 && !insideArena(s.x - sign * nx * sp.o[i], s.y - sign * ny * sp.o[i], s.spec.radius); k++) sp.o[i] *= 0.7;
    }
  }
  const place = (s: Robot, sign: number, o: number): Robot => {
    let x = s.x - sign * nx * o;
    let y = s.y - sign * ny * o;
    // 被逼到籠邊就退不了
    for (let k = 0; k < 8 && !insideArena(x, y, s.spec.radius); k++) {
      x = (x + s.x) / 2;
      y = (y + s.y) / 2;
    }
    const v = Object.create(s) as Robot;
    v.x = x;
    v.y = y;
    return v;
  };
  return [place(a, 1, sp.o[0]), place(b, -1, sp.o[1])];
}

/** 爬起來前幾個 tick 還用倒地的畫法（從躺著撐起來），之後換回站姿 */
const GETUP_HANDOFF = 16;
/** 重力（體素 / 秒²）：髖高 11 格大約一公尺，所以 1 格約 9 公分 */
const GRAVITY = 110;
/** 跪在地上時髖的高度 */
const KNEEL_Z = 6.2;

/** 腳直接放回站好的位置（倒地爬起來之後用） */
function placeFeet(pu: Puppet, s: Place): void {
  const c = Math.cos(s.heading);
  const n = Math.sin(s.heading);
  for (let i = 0; i < 2; i++) {
    const f = FOOT_HOME[i * 2];
    const d = FOOT_HOME[i * 2 + 1];
    const foot = pu.feet[i];
    foot.x = s.x + f * c - d * n;
    foot.y = s.y + f * n + d * c;
    foot.ang = s.heading + FOOT_SPLAY[i];
    foot.t = -1;
    foot.lift = 0;
  }
}

/**
 * 決定怎麼倒：被打昏（K.O.）往後挨打的話整個人直挺挺往後倒，手僵直舉起（擊昏反射）；
 * 往前或側面挨打就是腳先軟掉跪下，再往前趴下去。被擊倒但沒昏的，往後就一屁股坐倒，往前就跪地撐著。
 * 被裁判中止（TKO）的是撐不住慢慢跪下。側面挨打的話倒下時身體會被帶著轉。
 */
function startFall(s: Robot, pu: Puppet, thrown = false): Fall {
  const back = pu.hitF < -0.25;
  const side = Math.abs(pu.hitS) > Math.abs(pu.hitF) * 1.1;
  // 被摔：整個人被掀起來、背部重重砸在地上
  // 被重擊打昏（sim 的 downKind）：直挺挺往後倒、手腳攤開成大字
  const sprawl = !thrown && s.action === 'down' && s.downKind === 'sprawl';
  const mode: Fall['mode'] = sprawl
    ? 'sprawl'
    : thrown
      ? 'timber'
      : s.action === 'ko'
        ? back
          ? 'timber'
          : 'crumple'
        : s.action === 'tko'
          ? 'kneel'
          : back
            ? 'sit'
            : 'kneel';
  const turn = thrown ? 1.2 : side ? Math.sign(pu.hitS) * (mode === 'timber' || mode === 'sit' ? -0.8 : 0.8) : 0;
  return {
    mode,
    yaw: s.heading,
    yawTo: s.heading + turn,
    th: Math.atan(pu.pose.leanF),
    om: thrown ? -4.2 : mode === 'timber' || mode === 'sprawl' ? -1.3 : mode === 'sit' ? -0.5 : 0.25,
    hz: pu.pose.hipZ + RIG.legExtra,
    vz: thrown ? 26 : 0,
    slide: 0,
    fx: 0,
    fy: 0,
    t: 0,
    hits: 0,
    fence: mode === 'timber' && !thrown,
  };
}

function pitchIndex(th: number): number {
  return Math.max(0, Math.min(PITCH_COUNT - 1, Math.round(th / PITCH_STEP) + (PITCH_COUNT - 1) / 2));
}

/** 軀幹在這個角度時，髖最低可以到多低（再低身體就陷進地板了） */
function clearance(m: RobotModels, th: number): number {
  return m.pitched.torso[pitchIndex(th)].below;
}

/** 撞到地面：灰塵、震動 */
function thud(fall: Fall, s: Robot, fx: Fx, power: number): void {
  fall.hits++;
  if (fall.hits > 3) return;
  const f = Math.cos(fall.yaw);
  const n = Math.sin(fall.yaw);
  const reach = Math.sin(fall.th) * 10;
  fx.dust(s.x + f * reach, s.y + n * reach, Math.round(10 + 18 * power));
  fx.shake(1.5 + 4 * power);
}

/** 倒地的物理：重力、繞腳或繞膝蓋轉、撞地反彈 */
function stepFall(fall: Fall, s: Robot, m: RobotModels, dt: number, fx: Fx): void {
  if (dt <= 0) return;
  fall.t += dt;
  fall.yaw += (fall.yawTo - fall.yaw) * Math.min(1, dt * 4);
  if (s.action === 'getup') {
    // 爬起來：撐到單膝跪地、身體稍微前傾
    const k = Math.min(1, dt * 7);
    fall.th += (0.45 - fall.th) * k;
    fall.hz += (5 - fall.hz) * k;
    fall.slide += (0 - fall.slide) * k;
    fall.fence = false;
    return;
  }
  const slowTko = s.action === 'tko' ? 0.45 : 1;
  const n = Math.max(1, Math.ceil(dt / 0.008));
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    switch (fall.mode) {
      case 'sprawl':
      case 'timber': {
        // 像一棵樹被砍倒：繞腳踝轉，越倒越快
        if (fall.th > -Math.PI / 2) {
          fall.om -= (GRAVITY / 14) * (Math.abs(Math.sin(fall.th)) + 0.12) * h;
          fall.th += fall.om * h;
        }
        if (fall.th <= -Math.PI / 2) {
          fall.th = -Math.PI / 2;
          if (fall.om < -1.2) {
            thud(fall, s, fx, Math.min(1, -fall.om / 6));
            fall.om = -fall.om * 0.22;
          } else fall.om = 0;
        }
        fall.hz = Math.max(clearance(m, fall.th), 11 * Math.cos(fall.th));
        break;
      }
      case 'crumple':
      case 'kneel': {
        if (fall.hz > KNEEL_Z + 0.01 && fall.hits === 0) {
          // 腳軟了：膝蓋撐不住，髖往下掉（腿還有一點力，所以比自由落體慢）
          fall.vz -= GRAVITY * 0.75 * slowTko * h;
          fall.hz += fall.vz * h;
          fall.om += 1.6 * h;
          fall.th += fall.om * h;
          if (fall.hz <= KNEEL_Z) {
            fall.hz = KNEEL_Z;
            thud(fall, s, fx, Math.min(1, -fall.vz / 40) * 0.6);
            fall.vz = 0;
          }
          break;
        }
        if (fall.mode === 'kneel') {
          // 跪著，手撐地，上身前傾（喘、或被裁判抱住）
          fall.om += ((0.8 - fall.th) * 40 - fall.om * 9) * h;
          fall.th += fall.om * h;
          break;
        }
        // 跪下之後上身往前倒，臉朝下趴下去，最後腿往後滑開、整個人攤平
        if (fall.th < 1.3) {
          fall.om += (GRAVITY / 12) * (Math.sin(Math.max(0.05, fall.th)) + 0.1) * h;
          fall.th += fall.om * h;
          if (fall.th >= 1.3) {
            thud(fall, s, fx, Math.min(1, fall.om / 5));
            fall.om = -fall.om * 0.18;
          }
        } else {
          fall.th += (Math.PI / 2 - fall.th) * Math.min(1, h * 4);
          fall.hz += (clearance(m, fall.th) - fall.hz) * Math.min(1, h * 3);
          fall.slide += (1 - fall.slide) * Math.min(1, h * 3);
          fall.om = 0;
        }
        break;
      }
      case 'sit': {
        // 一屁股坐下去：髖掉到地上，上身往後仰，腳滑到前面
        if (fall.hz > 3.4) {
          fall.vz -= GRAVITY * 0.85 * h;
          fall.hz += fall.vz * h;
          if (fall.hz <= 3.4) {
            fall.hz = 3.4;
            thud(fall, s, fx, Math.min(1, -fall.vz / 40) * 0.7);
            fall.vz = 0;
          }
        }
        fall.om += ((-0.55 - fall.th) * 35 - fall.om * 7) * h;
        fall.th += fall.om * h;
        fall.slide += (1 - fall.slide) * Math.min(1, h * 5);
        break;
      }
    }
  }
  // 擊昏反射：手僵直舉起來一下，然後鬆掉
  if (fall.fence && fall.t > 1.6) fall.fence = false;
}

function drawPitched(r: Renderer, part: PitchedPart, x: number, y: number, z: number, yaw: number): void {
  r.drawStack(part.model, x, y, z - part.below, yaw);
}

/** 畫倒在地上（或正在倒下）的機器人：每個關節的位置照倒地的物理算出來 */
function drawFallen(r: Renderer, m: RobotModels, fall: Fall, s: Robot): void {
  const parts = m.normal;
  const fxw = Math.cos(fall.yaw);
  const fyw = Math.sin(fall.yaw);
  // S：身體的右手邊
  const sxw = -fyw;
  const syw = fxw;
  const st = Math.sin(fall.th);
  const ct = Math.cos(fall.th);
  // U：軀幹往上的方向；N：胸口朝的方向
  const ux = fxw * st;
  const uy = fyw * st;
  const uz = ct;
  const nx = fxw * ct;
  const ny = fyw * ct;
  const nz = -st;

  // 髖在哪裡
  let px = s.x;
  let py = s.y;
  // 腳在哪裡
  let footF = 0;
  if (fall.mode === 'timber' || fall.mode === 'sprawl') {
    px += fxw * st * 11;
    py += fyw * st * 11;
  } else if (fall.mode === 'sit') {
    px -= fxw * 4 * fall.slide;
    py -= fyw * 4 * fall.slide;
    footF = 9 * fall.slide + 2;
  } else {
    // 跪著：小腿貼地往後；趴平之後腿往後伸直
    const kneel = Math.max(0, Math.min(1, (11 - fall.hz) / (11 - KNEEL_Z)));
    footF = -mix(6 * kneel, 12, fall.slide);
    px -= fxw * 3 * fall.slide;
    py -= fyw * 3 * fall.slide;
  }
  const pz = FLOOR_Z + Math.max(fall.hz, clearance(m, fall.th) * 0.85);

  // 腿
  for (let i = 0; i < 2; i++) {
    const side = i === 0 ? -RIG.hipSide : RIG.hipSide;
    const hx = px + sxw * side;
    const hy = py + syw * side;
    let ax: number;
    let ay: number;
    if (fall.mode === 'sprawl') {
      // 大字：兩腳大大張開
      ax = s.x + sxw * side * 3.4;
      ay = s.y + syw * side * 3.4;
    } else if (fall.mode === 'timber') {
      ax = s.x + sxw * side * 1.3;
      ay = s.y + syw * side * 1.3;
    } else {
      ax = px + fxw * footF + sxw * side * 1.4;
      ay = py + fyw * footF + syw * side * 1.4;
    }
    const az = FLOOR_Z + 2;
    // 膝蓋：跪著朝前下，坐著朝上，倒下去的時候朝前
    const pole = fall.mode === 'sit' ? [fxw * 0.4, fyw * 0.4, 1] : fall.mode === 'timber' || fall.mode === 'sprawl' ? [fxw, fyw, 0.3] : [fxw, fyw, -0.4];
    solveJoint(hx, hy, pz, ax, ay, az, RIG.thigh, RIG.shin, pole[0], pole[1], pole[2]);
    limb(r, parts.thigh, hx, hy, pz - 1, joint.x, joint.y, joint.z, fall.yaw);
    limb(r, parts.shin, joint.x, joint.y, joint.z, ax, ay, az, fall.yaw);
    r.drawStack(parts.foot, ax, ay, FLOOR_Z + 0.5, fall.yaw + (fall.mode === 'timber' || fall.mode === 'sprawl' ? 0.5 * (i === 0 ? -1 : 1) : 0));
  }

  // 軀幹（照角度挑轉好的模型）和頭（頭比身體多垂一點）
  drawPitched(r, m.pitched.torso[pitchIndex(fall.th)], px, py, pz, fall.yaw);
  const neckX = px + ux * RIG.neckZ;
  const neckY = py + uy * RIG.neckZ;
  const neckZ = pz + uz * RIG.neckZ;
  const loll = fall.mode === 'timber' || fall.mode === 'sprawl' ? -0.2 : fall.mode === 'crumple' ? 0.25 : 0.15;
  const head = m.pitched.head[pitchIndex(fall.th + loll)];
  drawPitched(r, head, neckX, neckY, Math.max(FLOOR_Z + head.below * 0.8, neckZ), fall.yaw);

  // 手臂
  for (let i = 0; i < 2; i++) {
    const out = i === 0 ? -1 : 1;
    const side = out * m.shoulderSide;
    const sx = px + ux * RIG.shoulderZ + sxw * side;
    const sy = py + uy * RIG.shoulderZ + syw * side;
    const sz = pz + uz * RIG.shoulderZ;
    let hx: number;
    let hy: number;
    let hz: number;
    if (fall.mode === 'sprawl' && Math.abs(fall.th) > 1.2) {
      // 大字：手臂往兩側攤平在地上，手指偶爾抽一下
      const twitch = Math.sin(fall.t * 9 + i * 2) > 0.92 ? 1.5 : 0;
      hx = sx + sxw * out * 11 + ux * 3;
      hy = sy + syw * out * 11 + uy * 3;
      hz = FLOOR_Z + 2 + twitch;
    } else if (fall.fence) {
      // 擊昏反射：手臂僵直地朝胸口前方舉起來
      hx = sx + ux * 5 + nx * 9;
      hy = sy + uy * 5 + ny * 9;
      hz = sz + uz * 5 + nz * 9;
    } else if (fall.mode === 'kneel' || (fall.mode === 'crumple' && fall.th > 0.6)) {
      // 手撐在前面的地上
      hx = px + fxw * 10 + sxw * out * 5;
      hy = py + fyw * 10 + syw * out * 5;
      hz = FLOOR_Z + 2.5;
      if (fall.mode === 'crumple' && fall.slide > 0.3) {
        // 趴平了：手攤在身體兩側
        hx = sx + sxw * out * 4 - ux * 3;
        hy = sy + syw * out * 4 - uy * 3;
      }
    } else if (fall.mode === 'sit' && i === 1) {
      // 坐倒：一隻手往後撐地
      hx = px - fxw * 6 + sxw * 7;
      hy = py - fyw * 6 + syw * 7;
      hz = FLOOR_Z + 2.5;
    } else {
      // 手軟掉：往下垂，碰到地就攤開
      hx = sx + sxw * out * 3;
      hy = sy + syw * out * 3;
      hz = sz - 11;
      if (hz < FLOOR_Z + 2) {
        const spread = FLOOR_Z + 2 - hz;
        hz = FLOOR_Z + 2;
        hx += sxw * out * spread * 0.7;
        hy += syw * out * spread * 0.7;
      }
    }
    const ex = sxw * out * 0.8;
    const ey = syw * out * 0.8;
    solveJoint(sx, sy, sz, hx, hy, hz, RIG.upperArm, RIG.foreArm, ex, ey, -0.6);
    const reach = Math.hypot(hx - sx, hy - sy, hz - sz);
    const max = RIG.upperArm + RIG.foreArm - 0.05;
    const k = reach > max ? max / reach : 1;
    const tx = sx + (hx - sx) * k;
    const ty = sy + (hy - sy) * k;
    const tz = sz + (hz - sz) * k;
    r.drawStack(parts.pad, sx, sy, sz - 1.5, fall.yaw);
    limb(r, parts.upper, sx, sy, sz, joint.x, joint.y, joint.z, fall.yaw);
    limb(r, parts.fore, joint.x, joint.y, joint.z, tx, ty, tz, fall.yaw);
    const fx = tx - joint.x;
    const fy = ty - joint.y;
    r.drawStack(parts.hand, tx, ty, Math.max(FLOOR_Z, tz - 2), Math.hypot(fx, fy) > 1.5 ? Math.atan2(fy, fx) : fall.yaw);
  }
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
type RefMode = 'intro' | 'start' | 'watch' | 'count' | 'stop' | 'winner' | 'draw' | 'shock' | 'restrain' | 'check';

interface Referee extends Place {
  pu: Puppet;
  mode: RefMode;
}

const referees = new WeakMap<Match, Referee>();

function refereePose(mode: RefMode, time: number, moving: boolean, wow = 0): Pose {
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
    hipF: 0,
    hipS: 0,
    pivot: 0,
    stance: 0.75,
    kick: 0,
    kickF: 0,
    kickS: 0,
    kickZ: 0,
  };
  switch (mode) {
    case 'intro':
      // 一隻手伸在兩台中間，叫它們等
      setHand(p, 1, 12, 2, 18);
      break;
    case 'start': {
      // 手從頭頂大力往下一劈：開打！整個人跟著跳一下
      const k = Math.min(1, (time % 0.75) / 0.25);
      setHand(p, 1, mix(3, 14, k), 4, mix(32, 16, k));
      setHand(p, 0, 2, -9, 16);
      p.hipZ = 11.6 + (1 - k) * 1.5;
      p.leanF = mix(-0.08, 0.2, k);
      break;
    }
    case 'watch':
      // 微蹲、手放在膝蓋前，左右小碎步、盯著看
      p.hipZ = (moving ? 11 : 10.2) + Math.abs(Math.sin(time * 6)) * 0.5;
      p.leanF = 0.16;
      p.hipS = Math.sin(time * 3) * 0.8;
      p.headS = Math.sin(time * 1.7) * 0.8;
      setHand(p, 0, 5.5, -6.5, 13);
      setHand(p, 1, 5.5, 6.5, 13);
      break;
    case 'count': {
      // 讀秒：彎腰對著倒地的那台，一秒用力揮一下手（手從頭頂劈到胸前）
      const ph = (time % 1) / 1;
      const chop = ph < 0.25 ? smooth(ph / 0.25) : 1 - smooth((ph - 0.25) / 0.75);
      // 誇張版：手從頭頂整個劈到膝蓋，身體跟著彎下去、彈起來
      p.hipZ = 10.6 - chop * 1.6;
      p.leanF = 0.2 + 0.25 * chop;
      p.headZ = -0.6;
      p.headF = 1 + chop;
      setHand(p, 1, 9 + 5 * chop, 2.5, 31 - chop * 20);
      setHand(p, 0, 4, -9, 15 + chop * 2);
      break;
    }
    case 'stop': {
      // 衝進來喊停：身體壓低擋在中間，雙手在頭上大幅交叉揮舞
      // 誇張版：跳起來、雙手在頭頂大大交叉
      const w = Math.sin(time * 14) * 11;
      p.hipZ = 10.6 + Math.abs(Math.sin(time * 7)) * 2.6;
      p.leanF = 0.12;
      p.leanS = Math.sin(time * 7) * 0.08;
      setHand(p, 0, 4, -3 - w, 33);
      setHand(p, 1, 4, 3 + w, 33);
      break;
    }
    case 'shock': {
      // 嚇一跳：整個人往後縮、彈起來，雙手抱頭（「哇！」），頭往後仰
      const k = Math.min(1, wow * 1.3);
      const shake = Math.sin(time * 38) * 0.5 * k;
      p.hipZ = 11.6 + 2.8 * k;
      p.leanF = -0.3 * k;
      p.leanS = shake * 0.1;
      p.headF = 0.3 - 1.4 * k;
      p.headZ = 0.6 * k;
      p.stance = 0.95;
      setHand(p, 0, mix(2.5, 3, k), mix(-8.5, -5.5, k), mix(11.5, 27.5, k) + shake);
      setHand(p, 1, mix(2.5, 3, k), mix(8.5, 5.5, k), mix(11.5, 27.5, k) - shake);
      break;
    }
    case 'winner':
      // 舉起贏家那一側的手，另一手往觀眾一指
      setHand(p, 0, 1.5, -9.5, 32 + Math.abs(Math.sin(time * 4)) * 1.5);
      setHand(p, 1, 9, 11, 22);
      p.leanS = 0.06;
      break;
    case 'restrain': {
      // 架住追擊的那台：壓低重心、雙手推在它胸口、往後拖
      const w = Math.sin(time * 18) * 0.6;
      p.hipZ = 9.4;
      p.leanF = 0.38;
      p.stance = 1.4;
      p.hipF = -1.5;
      p.headF = 1.2;
      setHand(p, 0, 12 + w, -3.5, 19);
      setHand(p, 1, 12 - w, 3.5, 19);
      break;
    }
    case 'check': {
      // 跪在大字型那台的頭旁邊看頭：一手撥它的臉，一手往外揮「不准過來！」
      const w = Math.sin(time * 10) * 7;
      p.hipZ = 6;
      p.leanF = 0.55;
      p.stance = 1.3;
      p.headF = 2;
      p.headZ = -1.2;
      setHand(p, 0, 11, -1, 4 + Math.sin(time * 6) * 0.8);
      setHand(p, 1, 3, 9 + w * 0.3, 22 + w);
      break;
    }
    default:
      break;
  }
  return p;
}

function drawReferee(r: Renderer, match: Match, views: [Robot, Robot], m: RobotModels, time: number, dt: number): void {
  const [a, b] = views;
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

  const down = views.find((s) => s.action === 'down');
  const ko = match.method === 'KO' || match.method === 'TKO';
  let tx = midX + px * 42;
  let ty = midY + py * 42;
  if (match.phase === 'fight') {
    // P21：比賽中裁判站在「離鏡頭遠的那一側、偏向某一台的斜後方」：不擋在兩台前面，也不正好疊在兩台後面。
    // 沿著圓弧慢慢繞過去，不從兩台中間穿過
    let fx = px;
    let fy = py;
    if (r.viewY(midX + px, midY + py) - r.viewY(midX, midY) > 0) {
      fx = -px;
      fy = -py;
    }
    const lx = dx / len;
    const ly = dy / len;
    const side = (ref.x - midX) * lx + (ref.y - midY) * ly >= 0 ? 1 : -1;
    const want = Math.atan2(fy * 0.5 + ly * side * 0.87, fx * 0.5 + lx * side * 0.87);
    const cur = Math.atan2(ref.y - midY, ref.x - midX);
    let dA = want - cur;
    while (dA > Math.PI) dA -= Math.PI * 2;
    while (dA < -Math.PI) dA += Math.PI * 2;
    const ang = cur + Math.max(-0.7, Math.min(0.7, dA));
    tx = midX + Math.cos(ang) * 50;
    ty = midY + Math.sin(ang) * 50;
  }
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
  } else if (match.phase === 'break') {
    // 局間休息：站到場中間，等兩邊回角落
    mode = 'watch';
    tx = 0;
    ty = 30;
    lookX = 0;
    lookY = 0;
  } else if (match.phase === 'over') {
    const winner = match.winner !== null && match.winner >= 0 ? match.robots[match.winner] : null;
    const out = views.find((s) => s.action === 'ko' || s.action === 'tko' || s.action === 'down');
    if (ko && match.phaseTicks < 100) {
      // 結束了：衝到倒下（或被中止）的那一台旁邊，雙手揮舞喊停
      mode = 'stop';
      if (out) {
        tx = out.x + px * 16;
        ty = out.y + py * 16;
        lookX = out.x;
        lookY = out.y;
      }
    }
    else if (winner) {
      // 站到贏家的左手邊，舉起它的手
      mode = 'winner';
      tx = winner.x - Math.sin(winner.heading) * 17;
      ty = winner.y + Math.cos(winner.heading) * 17;
      lookX = tx + Math.cos(winner.heading) * 30;
      lookY = ty + Math.sin(winner.heading) * 30;
    } else mode = 'draw';
  } else if (views.some((s) => s.action === 'held')) {
    // 有人想追擊躺平的：衝過去擋在中間、把它架開
    const held = views.find((s) => s.action === 'held')!;
    const foe = views[1 - held.id];
    const ex = held.x - foe.x;
    const ey = held.y - foe.y;
    const el = Math.hypot(ex, ey) || 1;
    mode = 'restrain';
    tx = held.x - (ex / el) * 12;
    ty = held.y - (ey / el) * 12;
    lookX = held.x;
    lookY = held.y;
  } else if (down && down.downKind === 'sprawl' && shockLevel(match, time) < 0.55) {
    // 大字型：跪到它頭旁邊看傷勢
    const fp = puppets.get(match.robots[down.id]);
    const yaw = fp?.fall?.yaw ?? down.heading;
    const hx = down.x - Math.cos(yaw) * 20;
    const hy = down.y - Math.sin(yaw) * 20;
    mode = 'check';
    tx = hx + px * 8;
    ty = hy + py * 8;
    lookX = hx;
    lookY = hy;
  } else if (down && shockLevel(match, time) < 0.55) {
    mode = 'count';
    tx = down.x + px * 21;
    ty = down.y + py * 21;
    lookX = down.x;
    lookY = down.y;
  }

  // 有效重擊或擊倒的那一下：嚇一跳往後縮、雙手抱頭（之後才走過去讀秒）
  const wow = shockLevel(match, time);
  if (match.phase === 'fight' && wow > 0.2 && (mode === 'watch' || mode === 'count')) mode = 'shock';

  // 不能走出籠子，也不能踩到機器人
  for (let i = 0; i < 12 && !insideArena(tx, ty, 13); i++) {
    tx *= 0.93;
    ty *= 0.93;
  }
  for (const s of views) {
    const ex = tx - s.x;
    const ey = ty - s.y;
    const e = Math.hypot(ex, ey) || 1;
    const min = mode === 'winner' ? 15 : mode === 'restrain' ? (s.action === 'held' ? 12 : 22) : mode === 'check' ? 10 : 22;
    if (e < min) {
      tx = s.x + (ex / e) * min;
      ty = s.y + (ey / e) * min;
    }
  }

  // 走過去（有速度上限，遠的時候小跑）
  const gx = tx - ref.x;
  const gy = ty - ref.y;
  const gap = Math.hypot(gx, gy);
  // 擋人的時候用衝的
  const step = Math.min(gap, Math.min(gap * 6, mode === 'restrain' || mode === 'stop' ? 110 : 70) * dt);
  if (gap > 0.01) {
    ref.x += (gx / gap) * step;
    ref.y += (gy / gap) * step;
  }
  const want = Math.atan2(lookY - ref.y, lookX - ref.x);
  const turn = Math.atan2(Math.sin(want - ref.heading), Math.cos(want - ref.heading));
  ref.heading += turn * Math.min(1, dt * 8);
  ref.mode = mode;

  trackVelocity(ref.pu, ref, dt);
  const fast = mode === 'shock' || mode === 'restrain';
  settle(ref.pu, ref, refereePose(mode, time, gap > 3, wow), fast ? 30 : 13, fast ? 34 : 18, dt);
  drawBody(r, m.normal, m.shoulderSide, ref.pu, ref);
}

// ---------------------------------------------------------------- 場地
const FLASH = 0xffffffff;
const OUTLINE = hexToAbgr('#07080d');

export function drawScene(r: Renderer, match: Match, models: SceneModels, fx: Fx, crowd: Crowd, time: number, dt: number): void {
  r.begin();
  const A = models.arena;

  r.drawStack(A.floor, 0, 0, 0, 0);
  const views = spacing(match, time, dt);
  for (const s of views) {
    const pu = puppets.get(match.robots[s.id]);
    const fall = pu?.fall;
    // 影子跟著畫面上的偏移走（碰拳、跳到對手身上、爬網）；跳起來時影子縮小
    if (!fall) r.shadow(s.x + (pu?.ox ?? 0), s.y + (pu?.oy ?? 0), FLOOR_Z, RIG.shadowRadius * Math.max(0.55, 1 - (pu?.air ?? 0) * 0.04));
    else {
      // 倒在地上：影子跟著身體拉長到倒下的那一邊
      const reach = Math.sin(fall.th) * 7;
      const k = Math.abs(Math.sin(fall.th));
      r.shadow(s.x + Math.cos(fall.yaw) * reach, s.y + Math.sin(fall.yaw) * reach, FLOOR_Z, RIG.shadowRadius * (1 + 0.5 * k));
    }
  }
  const ref = referees.get(match);
  if (ref) r.shadow(ref.x, ref.y, FLOOR_Z, RIG.shadowRadius * 0.9);

  // 圍網：一圈直的網片
  for (let k = 0; k < FENCE_COUNT; k++) {
    const a = (k * 2 * Math.PI) / FENCE_COUNT;
    const x = Math.cos(a) * ARENA_RADIUS;
    const y = Math.sin(a) * ARENA_RADIUS;
    // 面向鏡頭的那幾片換成稀疏網，避免擋住擂台
    r.drawStack(r.viewY(x, y) > 8 ? A.fenceNear : A.fenceFar, x, y, FLOOR_Z, a);
  }
  // 柱子：紅方那一側兩根紅的，藍方那一側兩根藍的
  for (let k = 0; k < POST_COUNT; k++) {
    const pa = ((k + 0.5) * 2 * Math.PI) / POST_COUNT;
    const post = k === 3 || k === 4 ? A.postRed : k === 0 || k === POST_COUNT - 1 ? A.postBlue : A.post;
    r.drawStack(post, Math.cos(pa) * POST_RADIUS, Math.sin(pa) * POST_RADIUS, FLOOR_Z, 0);
  }
  const standRadius = APRON + 9;
  for (let k = 0; k < STAND_COUNT; k++) {
    const a = (k * 2 * Math.PI) / STAND_COUNT;
    // 觀眾席：靠鏡頭這一側的不畫（轉播機位本來就在觀眾席上面，畫了會擋住擂台）
    const sx = Math.cos(a) * standRadius;
    const sy = Math.sin(a) * standRadius;
    if (r.viewY(sx, sy) > 40) continue;
    // 越激動，站起來歡呼的區塊越多；每一區的節拍錯開，看起來像波浪
    const up = Math.sin(crowd.beat + k * 2.1) > 1 - crowd.level * 2;
    // 被嚇到（重擊、擊倒）：整區一起跳起來、雙手抱頭，跳的高度看有多驚人
    const wow = Math.max(crowd.gasp, shockLevel(match, time) * 0.8);
    if (wow > 0.18) {
      const hop = Math.abs(Math.sin(crowd.beat * 1.7 + k * 1.3)) * 2.6 * wow;
      r.drawStack(A.standGasp, sx, sy, 1 + Math.round(hop), a);
    } else r.drawStack(up ? A.standCheer : A.stand, sx, sy, up ? 1 : 0, a);
    // 閃光燈（嚇一跳的時候閃成一片）
    if (Math.random() < crowd.level * crowd.level * 0.6 + wow * 0.9) {
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
  r.drawStack(A.desk, 0, ARENA_RADIUS + 1, FLOOR_Z, Math.PI / 2);

  match.robots.forEach((s, i) => {
    r.tag = i + 1;
    drawRobot(r, s, views[i], models.robots[i], match, time, dt, fx);
  });
  r.tag = 3;
  drawReferee(r, match, views, models.referee, time, dt);
  r.tag = 0;
  // 機器人和裁判描一圈深色邊，在亂糟糟的擂台上也一眼看得出輪廓
  r.outline(OUTLINE);
  fx.draw(r);
  fx.post(r);
}

/** 開發用：邏輯距離和畫面距離（每台退了多少） */
export function spaceInfo(m: Match): { sim: number; o: number[]; act: string[] } {
  const [a, b] = m.robots;
  return { sim: Math.round(Math.hypot(a.x - b.x, a.y - b.y) * 10) / 10, o: (spacings.get(m)?.o ?? [0, 0]).map((v) => Math.round(v * 10) / 10), act: [a.action, b.action] };
}

/** 開發用：看某一台現在在打哪一招、怎麼倒（主控台 __dbg() 會帶出來） */
export function puppetInfo(s: Robot): { move: string; fall: string | null; th: number } {
  const pu = puppets.get(s);
  return { move: pu?.move ?? '-', fall: pu?.fall?.mode ?? null, th: pu?.fall ? Math.round(pu.fall.th * 100) / 100 : 0 };
}
