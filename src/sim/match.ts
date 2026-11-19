/**
 * 一場對戰的邏輯。不可以 import 任何畫面、DOM、音效相關的東西。
 * 固定 60Hz 步進 + 種子亂數 + core/fmath → 同樣的種子和設定一定打出同一場。
 */
import { Rng } from '../core/rng';
import { clamp, fatan2, fcos, fsin, PI, wrapAngle } from '../core/fmath';
import { ARENA_APOTHEM, START_X } from './arena';
import { createBrain, think, type Brain } from './brain';
import { applyMods, compile, type BrainId } from './cards';
import { buildSpec } from './gear';
import type { ModelSnapshot } from './model';
import { cleanTemper, type Temper } from './temper';
import type { Intent, Loadout, Robot, RobotSpec, SimEvent } from './types';

export const TICK_HZ = 60;
export const MATCH_TICKS = 60 * TICK_HZ;
export const INTRO_TICKS = 150;
const OUTRO_TICKS = 240;
const DOWN_TICKS = 110;
const GETUP_TICKS = 36;
const POISE_REGEN = 0.1;
const KNOCKBACK_FRICTION = 0.86;
const GUARD_ARC = 1.1;
const BLOCK_POISE = 0.6;
/** 衝刺結束後還要多久才能出拳 */
const DASH_RECOVERY = 14;
const PARRY_STUN = 17;

/** 一台機器人的全部設定。整場對戰由「種子 + 兩邊的設定」完全決定。 */
export interface RobotSetup {
  name: string;
  gear: Loadout;
  brain: BrainId;
  deck: string[];
  /** 自訓模型開打時的快照（brain 是 'trained' 才用得到） */
  model?: ModelSnapshot;
  /** 性格；沒有就是中間 */
  temper?: Temper;
}

export interface Match {
  seed: number;
  tick: number;
  phase: 'intro' | 'fight' | 'over';
  phaseTicks: number;
  fightTicks: number;
  rng: Rng;
  robots: [Robot, Robot];
  brains: [Brain, Brain];
  /** 這個 tick 發生的事，下一個 tick 會清掉 */
  events: SimEvent[];
  /** 0 / 1 = 贏家，-1 = 平手，null = 還沒結束 */
  winner: number | null;
  done: boolean;
}

function createRobot(id: number, spec: RobotSpec, x: number, heading: number): Robot {
  return {
    id,
    spec,
    x,
    y: 0,
    heading,
    kx: 0,
    ky: 0,
    hp: spec.maxHp,
    poise: spec.maxPoise,
    action: 'idle',
    actionTicks: 0,
    attack: 'jab',
    arm: 0,
    strikeNow: false,
    whiffed: false,
    stunTicks: 0,
    dashTicks: 0,
    dashCd: 0,
    dashX: 0,
    dashY: 0,
    moving: false,
    walkPhase: 0,
    hitFlash: 0,
    sinceHit: 9999,
    hitStreak: 0,
    blockStun: 0,
    sinceLandedBig: 9999,
    fumbling: false,
    label: '待機',
    ruleIndex: -1,
  };
}

export function createMatch(seed: number, setups: [RobotSetup, RobotSetup]): Match {
  const programs = setups.map((s) => compile(s.deck, s.brain, s.model ?? null));
  // 卡牌的數值影響在這裡套到機器人身上
  const spec = (i: number): RobotSpec => applyMods(buildSpec(setups[i].name, setups[i].gear), programs[i]);
  return {
    seed,
    tick: 0,
    phase: 'intro',
    phaseTicks: 0,
    fightTicks: 0,
    rng: new Rng(seed),
    robots: [createRobot(0, spec(0), -START_X, 0), createRobot(1, spec(1), START_X, PI)],
    brains: [createBrain(programs[0], cleanTemper(setups[0].temper)), createBrain(programs[1], cleanTemper(setups[1].temper))],
    events: [],
    winner: null,
    done: false,
  };
}

function setAction(r: Robot, action: Robot['action']): void {
  r.action = action;
  r.actionTicks = 0;
}

function updateRobot(m: Match, r: Robot, intent: Intent | null): void {
  r.actionTicks++;
  r.moving = false;
  r.strikeNow = false;
  if (r.dashCd > 0) r.dashCd--;
  if (r.hitFlash > 0) r.hitFlash--;
  r.sinceHit++;
  if (r.sinceHit > 150) r.hitStreak = 0;
  if (r.blockStun > 0) r.blockStun--;
  r.sinceLandedBig++;
  if (r.action !== 'down' && r.action !== 'ko') r.poise = Math.min(r.spec.maxPoise, r.poise + POISE_REGEN);

  switch (r.action) {
    case 'windup': {
      const a = r.spec[r.attack];
      if (r.actionTicks >= a.windup) {
        r.strikeNow = true;
        r.whiffed = false;
        r.x += fcos(r.heading) * a.lunge;
        r.y += fsin(r.heading) * a.lunge;
        setAction(r, 'recover');
      }
      break;
    }
    case 'recover':
      if (r.actionTicks >= r.spec[r.attack].recover) setAction(r, 'idle');
      break;
    case 'stagger':
      if (r.actionTicks >= r.stunTicks) setAction(r, 'idle');
      break;
    case 'down':
      if (r.actionTicks >= DOWN_TICKS) {
        r.poise = r.spec.maxPoise;
        setAction(r, 'getup');
        m.events.push({ type: 'getup', robot: r.id });
      }
      break;
    case 'getup':
      if (r.actionTicks >= GETUP_TICKS) setAction(r, 'idle');
      break;
    case 'idle':
    case 'guard': {
      if (!intent) {
        // 格擋硬直中：維持防禦姿勢，什麼都不能做
        if (r.action === 'guard' && r.blockStun === 0) setAction(r, 'idle');
        break;
      }
      r.label = intent.label;
      r.ruleIndex = intent.rule;
      r.fumbling = intent.fumble;
      const diff = wrapAngle(intent.face - r.heading);
      r.heading = wrapAngle(r.heading + clamp(diff, -r.spec.turnSpeed, r.spec.turnSpeed));

      // 衝刺有代價：衝完要站穩才能出拳，不然「邊衝邊打」沒有任何風險
      const dashBusy = r.dashCd > r.spec.dashCooldown - (r.spec.dashTicks + DASH_RECOVERY);
      if (intent.attack && !dashBusy) {
        r.attack = intent.attack;
        r.arm = r.arm === 0 ? 1 : 0;
        r.dashTicks = 0;
        setAction(r, 'windup');
        m.events.push({ type: 'swing', robot: r.id, kind: r.attack });
        break;
      }
      const want = intent.guard ? 'guard' : 'idle';
      if (r.action !== want) setAction(r, want);

      let mx = intent.moveX;
      let my = intent.moveY;
      const mag = Math.sqrt(mx * mx + my * my);
      if (mag > 1) {
        mx /= mag;
        my /= mag;
      }
      if (intent.dash && r.dashCd === 0 && mag > 0.01) {
        r.dashTicks = r.spec.dashTicks;
        r.dashCd = r.spec.dashCooldown;
        r.dashX = intent.moveX / mag;
        r.dashY = intent.moveY / mag;
        m.events.push({ type: 'dash', robot: r.id });
      }
      if (r.dashTicks === 0 && mag > 0.05) {
        // 倒退和防禦時走得比較慢
        const forward = mx * fcos(r.heading) + my * fsin(r.heading);
        const speed = r.spec.walkSpeed * (intent.guard ? 0.4 : forward < 0 && !r.spec.footwork ? 0.75 : 1);
        r.x += mx * speed;
        r.y += my * speed;
        r.moving = true;
        r.walkPhase += 0.16 * Math.min(1, mag);
      }
      break;
    }
    case 'ko':
    case 'win':
      break;
  }

  if (r.dashTicks > 0) {
    if (r.action === 'idle' || r.action === 'guard') {
      r.x += r.dashX * r.spec.dashSpeed;
      r.y += r.dashY * r.spec.dashSpeed;
      r.dashTicks--;
    } else {
      r.dashTicks = 0;
    }
  }
}

/** 記一次「做成功了」：算在這台機器人此刻正在執行的動作上 */
function credit(m: Match, r: Robot): void {
  const brain = m.brains[r.id];
  if (r.fumbling || brain.active < 0) return;
  const action = brain.program.rules[brain.active].action;
  brain.usage.success[action] = (brain.usage.success[action] ?? 0) + 1;
}

interface PendingHit {
  attacker: Robot;
  target: Robot;
}

function resolveHits(m: Match): void {
  // 先收集再套用，兩邊同時出拳才會互打
  const hits: PendingHit[] = [];
  for (const attacker of m.robots) {
    if (!attacker.strikeNow) continue;
    const target = m.robots[1 - attacker.id];
    const a = attacker.spec[attacker.attack];
    const dx = target.x - attacker.x;
    const dy = target.y - attacker.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const vulnerable = target.action !== 'down' && target.action !== 'getup' && target.action !== 'ko';
    const inArc = Math.abs(wrapAngle(fatan2(dy, dx) - attacker.heading)) <= a.arc;
    if (vulnerable && dist <= a.reach && inArc) hits.push({ attacker, target });
    else {
      m.events.push({ type: 'whiff', robot: attacker.id, kind: attacker.attack });
      attacker.whiffed = true;
      // 閃躲流練的就是這個：對手一揮空，不用等反應時間，馬上抓到破綻
      if (target.spec.footwork) m.brains[target.id].nextThink = 0;
      // 對手揮空 = 我這邊正在做的動作成功了（躲掉了）
      if (vulnerable) credit(m, target);
    }
  }

  for (const { attacker, target } of hits) {
    const a = attacker.spec[attacker.attack];
    const dx = target.x - attacker.x;
    const dy = target.y - attacker.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const nx = dx / dist;
    const ny = dy / dist;
    const facingAttacker = Math.abs(wrapAngle(fatan2(-dy, -dx) - target.heading)) < GUARD_ARC;
    const blocked = target.action === 'guard' && facingAttacker;
    // 霸體（街頭亂鬥流派才有）：重拳蓄力時，刺拳打得到但打不斷
    const armored =
      target.spec.heavyArmor && target.action === 'windup' && target.attack === 'heavy' && attacker.attack === 'jab';
    // 打斷對手的前搖 = 反擊，傷害更高
    const counter = target.action === 'windup' && !armored;
    const damage = a.damage * target.spec.damageTaken * (blocked ? 0.2 : 1) * (counter || armored ? 1.3 : 1);
    const kb = a.knockback * (blocked ? 0.4 : 1) * target.spec.knockbackTaken;
    if (!blocked && attacker.attack === 'heavy') attacker.sinceLandedBig = 0;

    target.hp = Math.max(0, target.hp - damage);
    // 擋住的拳照樣削平衡值：一直防禦會被打到破防倒地
    target.poise -= a.poise * (blocked ? BLOCK_POISE : 1) * (counter ? 1.4 : 1) * (armored ? 0.5 : 1);
    // 格擋硬直：擋下來之後有一小段時間只能繼續擋，不能馬上反擊
    if (blocked) target.blockStun = Math.round(a.stun * 0.75);
    // 化勁（太極流派才有）：被擋下來的刺拳會被帶開，出拳的人踉蹌露出破綻。重拳太沉，化不掉。
    if (blocked && target.spec.parry && attacker.attack === 'jab' && attacker.action === 'recover') {
      attacker.stunTicks = PARRY_STUN;
      setAction(attacker, 'stagger');
      // 化勁是練出來的反射：不用等反應時間，馬上可以接下一步
      target.blockStun = 0;
      m.brains[target.id].nextThink = 0;
    }
    target.kx += nx * kb;
    target.ky += ny * kb;
    target.hitFlash = 4;
    // 打中算進攻方成功，擋住算防守方成功（訓練模型學得比較多）
    credit(m, blocked ? target : attacker);
    // 擋下來的不算「被打中」
    if (!blocked) {
      target.sinceHit = 0;
      target.hitStreak++;
    }
    m.events.push({
      type: 'hit',
      attacker: attacker.id,
      target: target.id,
      kind: attacker.attack,
      x: target.x - nx * target.spec.radius,
      y: target.y - ny * target.spec.radius,
      blocked,
      counter,
      damage,
    });

    if (target.hp <= 0) {
      target.kx += nx * kb;
      target.ky += ny * kb;
      target.dashTicks = 0;
      setAction(target, 'ko');
      m.events.push({ type: 'ko', robot: target.id });
    } else if (target.poise <= 0) {
      target.poise = 0;
      target.dashTicks = 0;
      setAction(target, 'down');
      m.events.push({ type: 'down', robot: target.id });
    } else if (!blocked && !armored) {
      target.stunTicks = a.stun;
      target.dashTicks = 0;
      setAction(target, 'stagger');
    }
  }
}

const S = 0.7071067811865476;
const CAGE_NORMALS: readonly (readonly [number, number])[] = [
  [1, 0],
  [S, S],
  [0, 1],
  [-S, S],
  [-1, 0],
  [-S, -S],
  [0, -1],
  [S, -S],
];

function physics(m: Match, r: Robot): void {
  r.x += r.kx;
  r.y += r.ky;
  r.kx *= KNOCKBACK_FRICTION;
  r.ky *= KNOCKBACK_FRICTION;
  if (Math.abs(r.kx) < 0.01) r.kx = 0;
  if (Math.abs(r.ky) < 0.01) r.ky = 0;

  // 八角籠：八個半平面，撞上去會反彈
  const limit = ARENA_APOTHEM - r.spec.radius;
  for (const [nx, ny] of CAGE_NORMALS) {
    const over = r.x * nx + r.y * ny - limit;
    if (over <= 0) continue;
    r.x -= nx * over;
    r.y -= ny * over;
    const into = r.kx * nx + r.ky * ny;
    if (into > 0.6) {
      r.kx -= nx * into * 1.4;
      r.ky -= ny * into * 1.4;
      m.events.push({ type: 'cage', robot: r.id, x: r.x + nx * r.spec.radius, y: r.y + ny * r.spec.radius });
    }
  }
}

function separate(a: Robot, b: Robot): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const min = a.spec.radius + b.spec.radius;
  if (dist >= min) return;
  const nx = dist > 0.001 ? dx / dist : 1;
  const ny = dist > 0.001 ? dy / dist : 0;
  const push = (min - dist) / 2;
  a.x -= nx * push;
  a.y -= ny * push;
  b.x += nx * push;
  b.y += ny * push;
}

function finish(m: Match, winner: number): void {
  m.phase = 'over';
  m.phaseTicks = 0;
  m.winner = winner;
  m.events.push({ type: 'end', winner });
  for (const r of m.robots) {
    if (r.action === 'ko' || r.action === 'down') continue;
    r.dashTicks = 0;
    setAction(r, r.id === winner ? 'win' : 'idle');
  }
}

export function stepMatch(m: Match): void {
  m.events.length = 0;
  if (m.done) return;
  m.tick++;
  m.phaseTicks++;

  if (m.phase === 'intro') {
    if (m.phaseTicks === 1) m.events.push({ type: 'count', n: 3 });
    if (m.phaseTicks === 46) m.events.push({ type: 'count', n: 2 });
    if (m.phaseTicks === 91) m.events.push({ type: 'count', n: 1 });
    if (m.phaseTicks >= INTRO_TICKS) {
      m.phase = 'fight';
      m.phaseTicks = 0;
      m.events.push({ type: 'start' });
    }
  }

  const [a, b] = m.robots;
  const fighting = m.phase === 'fight';
  const canThink = (r: Robot): boolean => fighting && r.blockStun === 0 && (r.action === 'idle' || r.action === 'guard');
  const clock = { tick: m.fightTicks, elapsed: m.fightTicks / TICK_HZ, left: (MATCH_TICKS - m.fightTicks) / TICK_HZ };
  const ia = canThink(a) ? think(a, b, m.brains[0], clock, m.rng) : null;
  const ib = canThink(b) ? think(b, a, m.brains[1], clock, m.rng) : null;
  updateRobot(m, a, ia);
  updateRobot(m, b, ib);
  resolveHits(m);
  physics(m, a);
  physics(m, b);
  separate(a, b);

  if (fighting) {
    m.fightTicks++;
    const aOut = a.action === 'ko';
    const bOut = b.action === 'ko';
    if (aOut || bOut) finish(m, aOut && bOut ? -1 : aOut ? 1 : 0);
    else if (m.fightTicks >= MATCH_TICKS) {
      const ra = a.hp / a.spec.maxHp;
      const rb = b.hp / b.spec.maxHp;
      finish(m, ra === rb ? -1 : ra > rb ? 0 : 1);
    }
  } else if (m.phase === 'over' && m.phaseTicks >= OUTRO_TICKS) {
    m.done = true;
  }
}

/** 把整場狀態壓成一個數字，用來驗證重播是否一致 */
export function matchHash(m: Match): number {
  let h = m.tick | 0;
  for (const r of m.robots) {
    for (const v of [r.x, r.y, r.heading, r.hp, r.poise]) h = (Math.imul(h, 31) + Math.round(v * 1000)) | 0;
  }
  return (h ^ m.rng.state) >>> 0;
}
