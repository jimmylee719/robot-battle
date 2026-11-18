/**
 * 大腦：拿著指令理解器產生的規則清單，決定機器人每個 tick 要做什麼。
 * 每隔 tier.reaction 個 tick 才重新判斷一次「現在該執行哪條規則」，
 * 這就是 AI 等級的反應延遲。輸出是 Intent，身體（match.ts）照著做。
 */
import { fatan2, fcos, fsin, PI, TAU, wrapAngle } from '../core/fmath';
import type { Rng } from '../core/rng';
import { ARENA_APOTHEM } from './arena';
import { ACTION_TEXT, type ActionKind, type Cond, type Program, type Tier } from './interpreter';
import type { AttackKind, Intent, Robot } from './types';

export interface Brain {
  program: Program;
  /** 正在執行的規則編號，-1 = 沒有任何規則符合 */
  active: number;
  nextThink: number;
  /** 這一輪決定用哪種拳 */
  punch: AttackKind;
  strafeDir: 1 | -1;
  comboStep: number;
  /** 這一輪抽到的隨機方向 */
  aim: number;
}

/** 以秒為單位的比賽時間 */
export interface Clock {
  elapsed: number;
  left: number;
}

/**
 * 沒有任何規則符合時做什麼。機器人只會做你寫的事，所以三種等級都不會主動進攻；
 * 差別只在等級高的至少知道要保護自己。
 */
const FALLBACK: Record<Tier, ActionKind> = { lite: 'wait', pro: 'circle', ultra: 'guard' };

const EDGE_DIST = ARENA_APOTHEM - 22;
const CORNER_RADIUS = (ARENA_APOTHEM - 14) / 0.9238795325112867;

export function createBrain(program: Program): Brain {
  return { program, active: -1, nextThink: 0, punch: 'jab', strafeDir: 1, comboStep: 0, aim: 0 };
}

function holds(c: Cond, self: Robot, foe: Robot, clock: Clock, dist: number): boolean {
  switch (c.kind) {
    case 'hp': {
      const r = c.who === 'self' ? self : foe;
      const pct = (r.hp / r.spec.maxHp) * 100;
      return c.op === '<' ? pct < c.value : pct > c.value;
    }
    case 'dist':
      return c.op === '<' ? dist < c.value : dist > c.value;
    case 'foeState':
      switch (c.state) {
        case 'attack':
          return foe.action === 'windup';
        case 'heavy':
          return foe.action === 'windup' && foe.attack === 'heavy';
        case 'down':
          return foe.action === 'down' || foe.action === 'getup';
        case 'guard':
          return foe.action === 'guard';
        case 'open':
          return foe.action === 'recover' || foe.action === 'stagger';
      }
      return false;
    case 'selfHit':
      return self.sinceHit < 45;
    case 'edge': {
      const r = c.who === 'self' ? self : foe;
      return Math.sqrt(r.x * r.x + r.y * r.y) > EDGE_DIST;
    }
    case 'time':
      return clock.elapsed < c.value;
    case 'timeLeft':
      return clock.left < c.value;
    case 'dashReady':
      return self.dashCd === 0;
  }
}

/** 有條件的規則優先（照寫的順序）；都不成立才輪到沒有條件的規則 */
function pickRule(brain: Brain, self: Robot, foe: Robot, clock: Clock, dist: number): number {
  const rules = brain.program.rules;
  const plain: number[] = [];
  for (let i = 0; i < rules.length; i++) {
    const r = rules[i];
    if (r.conds.length === 0) plain.push(i);
    else if (r.conds.every((c) => holds(c, self, foe, clock, dist))) return i;
  }
  if (plain.length === 0) return -1;
  // 「先 A 然後 B」：每條做 6 秒，最後一條做到底。否則每 5 秒輪流。
  if (brain.program.sequential) return plain[Math.min(plain.length - 1, Math.floor(clock.elapsed / 6))];
  return plain[Math.floor(clock.elapsed / 5) % plain.length];
}

export function think(self: Robot, foe: Robot, brain: Brain, clock: Clock, rng: Rng): Intent {
  const dx = foe.x - self.x;
  const dy = foe.y - self.y;
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;
  const nx = dx / dist;
  const ny = dy / dist;
  const face = fatan2(dy, dx);

  if (--brain.nextThink <= 0) {
    brain.nextThink = brain.program.tier.reaction;
    brain.active = pickRule(brain, self, foe, clock, dist);
    // 每次思考固定抽三次亂數，重播才會一致
    const roll = rng.next();
    const open = foe.action === 'recover' || foe.action === 'stagger';
    brain.punch = (open && roll < 0.7) || roll < 0.25 ? 'heavy' : 'jab';
    if (rng.next() < 0.12) brain.strafeDir = brain.strafeDir === 1 ? -1 : 1;
    brain.aim = rng.next() * TAU - PI;
  }

  const rule = brain.active >= 0 ? brain.program.rules[brain.active] : null;
  const kind: ActionKind = rule ? rule.action : FALLBACK[brain.program.tier.id];
  const dash = rule ? rule.dash : false;
  const I: Intent = {
    moveX: 0,
    moveY: 0,
    face,
    attack: null,
    guard: false,
    dash: false,
    label: ACTION_TEXT[kind],
    rule: brain.active,
  };

  const tx = -ny * brain.strafeDir;
  const ty = nx * brain.strafeDir;
  const fromCenter = Math.sqrt(self.x * self.x + self.y * self.y);

  const toward = (): void => {
    I.moveX = nx;
    I.moveY = ny;
  };
  const away = (): void => {
    I.moveX = -nx;
    I.moveY = -ny;
    // 快被逼到籠邊就改往中間繞
    if (fromCenter > 46) {
      I.moveX += tx - (self.x / fromCenter) * 1.2;
      I.moveY += ty - (self.y / fromCenter) * 1.2;
    }
  };
  const orbit = (radius: number): void => {
    const radial = Math.max(-0.8, Math.min(0.8, (dist - radius) * 0.06));
    I.moveX = tx + nx * radial;
    I.moveY = ty + ny * radial;
  };
  /** 走向某一點，回傳是否已經到了 */
  const goTo = (x: number, y: number): boolean => {
    const ex = x - self.x;
    const ey = y - self.y;
    const d = Math.sqrt(ex * ex + ey * ey);
    if (d < 2.5) return true;
    I.moveX = ex / d;
    I.moveY = ey / d;
    return false;
  };
  /** 打得到就出拳，打不到就走過去 */
  const strike = (attack: AttackKind): boolean => {
    if (dist > self.spec[attack].reach - 1) {
      toward();
      if (dash && dist > 48 && self.dashCd === 0) I.dash = true;
      return false;
    }
    if (Math.abs(wrapAngle(face - self.heading)) < 0.35) {
      I.attack = attack;
      return true;
    }
    return false;
  };
  /** 離對手最遠的那個角落 */
  const farCorner = (): [number, number] => {
    let best = 0;
    let bestD = -1;
    let bx = 0;
    let by = 0;
    for (let k = 0; k < 8; k++) {
      const a = PI / 8 + (k * PI) / 4;
      const cx = fcos(a) * CORNER_RADIUS;
      const cy = fsin(a) * CORNER_RADIUS;
      const d = (cx - foe.x) * (cx - foe.x) + (cy - foe.y) * (cy - foe.y);
      if (d > bestD) {
        bestD = d;
        best = k;
        bx = cx;
        by = cy;
      }
    }
    void best;
    return [bx, by];
  };

  switch (kind) {
    case 'rush':
      strike(brain.punch);
      break;
    case 'jab':
      strike('jab');
      break;
    case 'heavy':
      strike('heavy');
      break;
    case 'combo':
      if (strike(brain.comboStep % 3 === 2 ? 'heavy' : 'jab')) brain.comboStep++;
      break;
    case 'approach':
      if (dist > 23) {
        toward();
        if (dash && dist > 48 && self.dashCd === 0) I.dash = true;
      }
      break;
    case 'keepaway':
      if (dist < 54) {
        away();
        if (dash && dist < 30 && self.dashCd === 0) I.dash = true;
      }
      break;
    case 'circle':
      orbit(36);
      break;
    case 'kite':
      orbit(56);
      break;
    case 'guard':
      I.guard = true;
      break;
    case 'counter': {
      const open = foe.action === 'recover' || foe.action === 'stagger';
      if (open) strike('heavy');
      else if (dist > 30) toward();
      else I.guard = true;
      break;
    }
    case 'dashIn':
      if (dist > 26) {
        toward();
        if (self.dashCd === 0) I.dash = true;
      }
      break;
    case 'dashOut':
      if (dist < 44) {
        away();
        if (self.dashCd === 0) I.dash = true;
      }
      break;
    case 'corner': {
      // 站到對手和擂台中央之間，用刺拳把他往外推
      const fd = Math.sqrt(foe.x * foe.x + foe.y * foe.y) || 1;
      const px = foe.x - (foe.x / fd) * 20;
      const py = foe.y - (foe.y / fd) * 20;
      if (dist <= self.spec.jab.reach - 1) strike('jab');
      else goTo(px, py);
      break;
    }
    case 'center':
      goTo(0, 0);
      break;
    case 'wait':
    case 'waitForever':
      break;
    case 'taunt':
    case 'spin':
      I.face = self.heading + 1;
      break;
    case 'hideCorner': {
      const [cx, cy] = farCorner();
      // 到了就面壁
      if (goTo(cx, cy)) I.face = fatan2(cy, cx);
      break;
    }
    case 'selfCorner': {
      const [cx, cy] = farCorner();
      goTo(cx, cy);
      break;
    }
    case 'shadowbox':
      I.face = self.heading;
      I.attack = 'jab';
      break;
    case 'heavySpam':
      I.face = self.heading;
      I.attack = 'heavy';
      break;
    case 'bump':
      toward();
      break;
    case 'guardBack':
      I.guard = true;
      I.face = face + PI;
      break;
    case 'dashRandom':
      I.moveX = fcos(brain.aim);
      I.moveY = fsin(brain.aim);
      I.face = brain.aim;
      if (self.dashCd === 0) I.dash = true;
      break;
    case 'dashToward':
      if (self.dashCd === 0) {
        toward();
        I.dash = true;
      }
      break;
    case 'statue':
      goTo(0, 0);
      I.face = 0;
      break;
  }
  return I;
}
