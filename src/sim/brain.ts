/**
 * 大腦：拿著卡組編譯出來的規則（cards.ts），決定機器人每個 tick 要做什麼。
 *  - 每隔 program.reaction 個 tick 才重新判斷一次該執行哪條規則（反應延遲）。
 *  - 每次改做另一條規則都要擲一次準確率；沒中就會「聽錯」一小段時間。
 * 輸出是 Intent，身體（match.ts）照著做。
 */
import { fatan2, fcos, fsin, PI, TAU, wrapAngle } from '../core/fmath';
import type { Rng } from '../core/rng';
import { ARENA_RADIUS } from './arena';
import { TUNE } from './tuning';
import type { Program } from './cards';
import { ACTION_TEXT, MISHEAR, type ActionKind, type Cond } from './rules';
import { TACTICS } from './tactics';
import { isWaiting, lean, newNotes, NEUTRAL, reactMult, type FightNotes, type Temper } from './temper';
import { START, type Usage } from './model';
import type { AttackKind, Intent, Robot } from './types';

export interface Brain {
  program: Program;
  /** 正在執行的規則編號，-1 = 沒有任何規則可用 */
  active: number;
  nextThink: number;
  /** 這一輪決定用哪種拳 */
  punch: AttackKind;
  /** 這一輪要不要主動戳一下（太極這類等待型打法用，避免兩邊都不出手） */
  poke: boolean;
  strafeDir: 1 | -1;
  comboStep: number;
  /** 這一輪抽到的隨機方向 */
  aim: number;
  /** 聽錯時改做的動作 */
  fumble: ActionKind | null;
  /** 聽錯到哪個 tick 為止（用比賽時間算，不是大腦思考的次數） */
  fumbleUntil: number;
  /** 每條規則：休息到哪個 tick、上次擲準確率是哪個 tick */
  restUntil: number[];
  rolledAt: number[];
  /** 性格：只影響流派怎麼補細節 */
  temper: Temper;
  /** 這場的打法統計（打完用來讓性格漂移）和每個動作的使用次數（訓練模型用） */
  notes: FightNotes;
  usage: Usage;
  /** 每張卡發動了幾次（賽後掉卡用：打贏會拿到對手最常用的卡） */
  cardUses: Record<string, number>;
}

/** 比賽時間 */
export interface Clock {
  tick: number;
  elapsed: number;
  left: number;
}

const EDGE_DIST = ARENA_RADIUS - 22;
/** 躲的時候貼著圍網站在這個半徑上 */
const HIDE_RADIUS = ARENA_RADIUS - 14;
/** 聽錯一次持續多久 */
const FUMBLE_TICKS = 45;
/** 同一張卡至少隔這麼久才會再擲一次準確率 */
const REROLL_TICKS = 180;

export function createBrain(program: Program, temper: Temper = NEUTRAL): Brain {
  return {
    program,
    active: -1,
    nextThink: 0,
    punch: 'jab',
    poke: false,
    strafeDir: 1,
    comboStep: 0,
    aim: 0,
    fumble: null,
    fumbleUntil: 0,
    restUntil: program.rules.map(() => 0),
    rolledAt: program.rules.map(() => -REROLL_TICKS),
    temper: { ...temper },
    notes: newNotes(),
    usage: { used: {}, success: {} },
    cardUses: {},
  };
}

/**
 * 「露出破綻」：被打到硬直、重拳揮完在收招、或任何一拳揮空。
 * 打中或被擋下來的刺拳收招太快，不算破綻。
 */
function isOpen(foe: Robot): boolean {
  return foe.action === 'stagger' || (foe.action === 'recover' && (foe.attack === 'heavy' || foe.whiffed));
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
          return isOpen(foe);
      }
      return false;
    case 'selfHit':
      return self.sinceHit < 45;
    case 'pressured':
      return self.hitStreak >= 3 && self.sinceHit < 40;
    case 'landedBig':
      return self.sinceLandedBig < 40;
    case 'edge': {
      const r = c.who === 'self' ? self : foe;
      return Math.sqrt(r.x * r.x + r.y * r.y) > EDGE_DIST;
    }
    case 'time':
      return clock.elapsed < c.value;
    case 'timeLeft':
      return clock.left < c.value;
  }
}

/**
 * 規則已經照優先度排好（招牌 → 流派自己的反射 → 反射卡 → 流派的預設打法）。
 * 有條件的先看，第一條成立的就做；都不成立才輪到沒有條件的，多條就每 4 秒輪流。
 */
function pickRule(brain: Brain, self: Robot, foe: Robot, clock: Clock, dist: number): number {
  const { rules, bans } = brain.program;
  const plain: number[] = [];
  for (let i = 0; i < rules.length; i++) {
    const r = rules[i];
    if (bans.includes(r.action) || clock.tick < brain.restUntil[i]) continue;
    if (r.conds.length === 0) plain.push(i);
    else if (r.conds.every((c) => holds(c, self, foe, clock, dist))) return i;
  }
  if (plain.length === 0) return -1;
  return plain[Math.floor(clock.elapsed / 4) % plain.length];
}

export function think(self: Robot, foe: Robot, brain: Brain, clock: Clock, rng: Rng): Intent {
  const dx = foe.x - self.x;
  const dy = foe.y - self.y;
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;
  const nx = dx / dist;
  const ny = dy / dist;
  const face = fatan2(dy, dx);

  if (--brain.nextThink <= 0) {
    let wait = brain.program.reaction;
    const before = brain.active;
    brain.active = pickRule(brain, self, foe, clock, dist);
    // 每次思考固定抽六次亂數，重播才會一致
    const roll = rng.next();
    const open = isOpen(foe);
    // 大膽的性格愛出重拳
    // 沒有霸體的機器人亂揮重拳只會被刺拳打斷，所以平常幾乎只出刺拳，等破綻才補重拳
    // 有霸體的（街頭亂鬥）反過來：重拳才是它的主力，對手一舉手防守就更要用重拳砸
    const baseHeavy = self.spec.heavyArmor ? TUNE.armoredHeavy : 0.06;
    const heavyChance = Math.max(0.02, Math.min(0.8, baseHeavy + 0.5 * lean(brain.temper, 'nerve')));
    const smash = self.spec.guardCrush && foe.action === 'guard' && roll < 0.85;
    brain.punch = (open && roll < 0.7) || smash || roll < heavyChance ? 'heavy' : 'jab';
    if (rng.next() < 0.12) brain.strafeDir = brain.strafeDir === 1 ? -1 : 1;
    brain.aim = rng.next() * TAU - PI;
    brain.poke = rng.next() < 0.35 + 0.4 * lean(brain.temper, 'grip');
    const acc = rng.next();
    // 思考間隔加一點抖動（±15%），不然固定的間隔會和對手的出拳節奏鎖在一起
    const jitter = 0.85 + 0.3 * rng.next();
    // 換成另一張卡的規則 = 一次新的決定，擲準確率；沒中就聽錯一下子。
    // 同一張卡做久了也會偶爾重擲。
    const i = brain.active;
    if (i >= 0 && clock.tick >= brain.fumbleUntil) {
      const rules = brain.program.rules;
      const switched = before < 0 || rules[before].card !== rules[i].card;
      const since = clock.tick - brain.rolledAt[i];
      // 流派是練成本能的東西：切回流派不算新的決定，只有做久了才偶爾重擲。
      // 不然卡插越多、切換越頻繁，就越常聽錯，多插卡反而變弱。
      const fresh = switched && !rules[i].style;
      if ((fresh && since > REROLL_TICKS) || since > REROLL_TICKS * 2) {
        for (let k = 0; k < rules.length; k++) if (rules[k].card === rules[i].card) brain.rolledAt[k] = clock.tick;
        const action = rules[i].action;
        const { prof, habit, accScale } = brain.program;
        brain.usage.used[action] = (brain.usage.used[action] ?? 0) + 1;
        brain.cardUses[rules[i].card] = (brain.cardUses[rules[i].card] ?? 0) + 1;
        // 自訓模型：看這個動作的熟練度，聽錯時會做它最習慣的動作
        const accuracy = prof ? (prof[action] ?? START) * accScale : brain.program.accuracy;
        const wrong = habit && habit !== action ? habit : MISHEAR[action];
        if (wrong && acc >= accuracy) {
          brain.fumble = wrong;
          brain.fumbleUntil = clock.tick + FUMBLE_TICKS;
        }
      }
    }
    // 性格對反應時間的影響：積極的搶著進攻、慢半拍才肯守
    if (brain.active >= 0) wait *= reactMult(brain.temper, brain.program.rules[brain.active].action);
    // 作戰計畫「技巧」反應比較快
    wait *= TACTICS[self.tactic].react;
    brain.nextThink = Math.max(2, Math.round(wait * jitter));
  }

  const rule = brain.active >= 0 ? brain.program.rules[brain.active] : null;
  const fumbling = clock.tick < brain.fumbleUntil && brain.fumble !== null;
  const kind: ActionKind = fumbling ? brain.fumble! : rule ? rule.action : 'wait';
  const dash = rule && !fumbling ? rule.dash : false;
  const I: Intent = {
    moveX: 0,
    moveY: 0,
    face,
    attack: null,
    guard: false,
    dash: false,
    label: ACTION_TEXT[kind],
    rule: brain.active,
    fumble: fumbling,
  };

  // 打法統計
  brain.notes.ticks++;
  if (dist < 30) brain.notes.close++;
  if (kind !== 'wait' && !isWaiting(kind)) brain.notes.forward++;
  // 貼身的性格站得近
  const range = 1 - 0.2 * lean(brain.temper, 'grip');

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
    // 被貼得太近時以退開為主，不要只顧著橫移
    const radial = Math.max(-1.6, Math.min(0.8, (dist - radius) * 0.1));
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
    // 留一點餘裕才出手：對手正在後退時，剛好搆到的拳會揮空
    if (dist > self.spec[attack].reach - 3) {
      toward();
      if (dash && dist > 48 && self.dashCd === 0) I.dash = true;
      return false;
    }
    if (Math.abs(wrapAngle(face - self.heading)) < 0.35) {
      I.attack = attack;
      brain.notes.swings++;
      if (attack === 'heavy') brain.notes.heavies++;
      // 反射是一瞬間：出手之後這條規則休息一下，換別的規則接手
      if (rule && !fumbling && rule.rest > 0) {
        brain.restUntil[brain.active] = clock.tick + rule.rest;
        brain.nextThink = 0;
      }
      return true;
    }
    return false;
  };
  /** 圍網邊離對手最遠的那一點（圓形場地沒有角落，就是對手的正對面） */
  const farCorner = (): [number, number] => {
    const d = Math.sqrt(foe.x * foe.x + foe.y * foe.y);
    // 對手站在正中央：往自己現在這一側退
    if (d < 1) {
      const sd = Math.sqrt(self.x * self.x + self.y * self.y);
      return sd < 1 ? [HIDE_RADIUS, 0] : [(self.x / sd) * HIDE_RADIUS, (self.y / sd) * HIDE_RADIUS];
    }
    return [(-foe.x / d) * HIDE_RADIUS, (-foe.y / d) * HIDE_RADIUS];
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
      orbit(36 * range);
      break;
    case 'kite':
      orbit(56 * range);
      break;
    case 'pokeKite':
      // 繞兩秒多，進去戳一下，再出來
      if ((clock.tick + self.id * 70) % 200 < 130 - 35 * lean(brain.temper, 'grip')) orbit(46 * range);
      else strike('jab');
      break;
    case 'slip':
      if (self.dashCd === 0) {
        I.moveX = tx - nx * 0.4;
        I.moveY = ty - ny * 0.4;
        I.dash = true;
      } else I.guard = true;
      break;
    case 'guard':
      I.guard = true;
      break;
    case 'counter': {
      const open = isOpen(foe);
      if (open) strike('heavy');
      else if (dist > 30) {
        toward();
        if (dist > 50 && self.dashCd === 0) I.dash = true;
      }
      else if (brain.poke && foe.action !== 'windup') strike('jab');
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
      // 平常用走的退開；真的被貼到臉上才開推進器
      if (dist < 44) {
        away();
        if (dist < 30 && self.dashCd === 0) I.dash = true;
      }
      break;
    case 'center':
      goTo(0, 0);
      break;
    case 'wait':
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
