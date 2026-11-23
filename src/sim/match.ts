/**
 * 一場對戰的邏輯。不可以 import 任何畫面、DOM、音效相關的東西。
 * 固定 60Hz 步進 + 種子亂數 + core/fmath → 同樣的種子和設定一定打出同一場。
 */
import { Rng } from '../core/rng';
import { clamp, fatan2, fcos, fsin, PI, wrapAngle } from '../core/fmath';
import { ARENA_RADIUS, START_X } from './arena';
import { createBrain, think, type Brain } from './brain';
import { applyMods, compile, type BrainId } from './cards';
import { buildSpec } from './gear';
import type { ModelSnapshot } from './model';
import type { Look } from './look';
import { cleanTemper, type Temper } from './temper';
import { beats, cleanPlan, tacticTemper, TACTICS, type Plan, type Tactic } from './tactics';
import { TUNE } from './tuning';
import type { FinishMethod, Intent, Loadout, Robot, RobotSpec, SimEvent } from './types';
import { decide, newStats, scoreRound, type Decision, type RoundStats } from './judges';

export const TICK_HZ = 60;
/** 照 UFC：打三回合，回合之間休息。總打鬥時間還是 60 秒。 */
export const ROUNDS = 3;
export const ROUND_TICKS = 20 * TICK_HZ;
export const MATCH_TICKS = ROUNDS * ROUND_TICKS;
/** 局間休息：回角落、回一點電 */
export const BREAK_TICKS = 150;
export const INTRO_TICKS = 150;
const OUTRO_TICKS = 240;
const DOWN_TICKS = 110;
const GETUP_TICKS = 36;
const POISE_REGEN = 0.1;
const KNOCKBACK_FRICTION = 0.86;
const GUARD_ARC = 1.1;
/** 衝刺結束後還要多久才能出拳 */
const DASH_RECOVERY = 14;

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
  /** 外觀。純裝飾，戰鬥邏輯不讀它；沒有就用角落的預設配色 */
  look?: Look;
  /** 作戰計畫：三個回合各用什麼戰術；沒有就全部隨機應變 */
  plan?: Plan;
}

export interface Match {
  seed: number;
  tick: number;
  phase: 'intro' | 'fight' | 'break' | 'over';
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
  /** 第幾回合（1 起算）、這回合打了幾個 tick */
  round: number;
  roundTicks: number;
  /** 每回合兩邊的數據（裁判看這個打分） */
  stats: [RoundStats, RoundStats][];
  /** 計分卡：[回合][裁判] = [紅, 藍] */
  cards: [number, number][][];
  /** 怎麼結束的；打完三回合才有 decision */
  method: FinishMethod | null;
  decision: Decision | null;
  /** 裁判專用的亂數（和打鬥用的分開） */
  judgeRng: Rng;
  /** 兩邊的作戰計畫，和沒推過的原本性格 */
  plans: [Plan, Plan];
  tempers: [Temper, Temper];
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
    energy: spec.maxEnergy,
    gassed: false,
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
    unanswered: 0,
    knockdowns: 0,
    tactic: 'auto',
  };
}

export function createMatch(seed: number, setups: [RobotSetup, RobotSetup]): Match {
  const programs = setups.map((s) => compile(s.deck, s.brain, s.model ?? null));
  // 卡牌的數值影響在這裡套到機器人身上
  const spec = (i: number): RobotSpec => applyMods(buildSpec(setups[i].name, setups[i].gear), programs[i]);
  const m: Match = {
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
    round: 1,
    roundTicks: 0,
    stats: [[newStats(), newStats()]],
    cards: [],
    method: null,
    decision: null,
    judgeRng: new Rng((seed ^ 0x5bd1e995) >>> 0),
    plans: [cleanPlan(setups[0].plan), cleanPlan(setups[1].plan)],
    tempers: [cleanTemper(setups[0].temper), cleanTemper(setups[1].temper)],
  };
  applyTactics(m);
  return m;
}

/** 這一回合照作戰計畫換戰術：性格往戰術推，其他倍率在出拳、挨打時套 */
function applyTactics(m: Match): void {
  for (const r of m.robots) {
    const t = m.plans[r.id][m.round - 1] ?? 'auto';
    r.tactic = t;
    m.brains[r.id].temper = tacticTemper(m.tempers[r.id], t);
  }
}

/**
 * 局間休息時改下一回合的戰術（單人模式的角落指示）。只能改還沒開始的回合，
 * 所以把改過的計畫存進重播，重跑出來一樣。成功回傳 true。
 */
export function setTactic(m: Match, side: number, round: number, t: Tactic): boolean {
  if (round <= m.round || round > ROUNDS) return false;
  m.plans[side][round - 1] = t;
  return true;
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
  if (r.action !== 'down' && r.action !== 'ko') {
    r.poise = Math.min(r.spec.maxPoise, r.poise + POISE_REGEN);
    // 沒電時不出手，回得比較快
    r.energy = Math.min(r.spec.maxEnergy, r.energy + TUNE.energyRegen * (r.gassed ? 1.5 : 1) * TACTICS[r.tactic].regen);
    if (r.gassed && r.energy >= TUNE.gassedUntil) r.gassed = false;
  }

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
      // 能量不夠出這一拳：沒電了，只能舉手防守，等電回來
      const need = intent.attack ? r.spec[intent.attack].energy * r.spec.energyUse * TACTICS[r.tactic].energy : 0;
      if (intent.attack && !r.gassed && r.energy < need) {
        r.gassed = true;
        m.events.push({ type: 'gassed', robot: r.id });
      }
      if (intent.attack && !dashBusy && !r.gassed) {
        if (m.phase === 'fight') m.stats[m.stats.length - 1][r.id].thrown++;
        r.energy -= need;
        r.attack = intent.attack;
        r.arm = r.arm === 0 ? 1 : 0;
        r.dashTicks = 0;
        setAction(r, 'windup');
        m.events.push({ type: 'swing', robot: r.id, kind: r.attack });
        break;
      }
      const guarding = intent.guard || (r.gassed && intent.attack !== null);
      const want = guarding ? 'guard' : 'idle';
      if (r.action !== want) setAction(r, want);

      let mx = intent.moveX;
      let my = intent.moveY;
      const mag = Math.sqrt(mx * mx + my * my);
      if (mag > 1) {
        mx /= mag;
        my /= mag;
      }
      const dashNeed = r.spec.dashEnergy * r.spec.energyUse * TACTICS[r.tactic].energy;
      if (intent.dash && r.dashCd === 0 && mag > 0.01 && !r.gassed && r.energy >= dashNeed) {
        r.energy -= dashNeed;
        r.dashTicks = r.spec.dashTicks;
        r.dashCd = r.spec.dashCooldown;
        r.dashX = intent.moveX / mag;
        r.dashY = intent.moveY / mag;
        m.events.push({ type: 'dash', robot: r.id });
      }
      if (r.dashTicks === 0 && mag > 0.05) {
        // 倒退和防禦時走得比較慢
        const forward = mx * fcos(r.heading) + my * fsin(r.heading);
        const speed = r.spec.walkSpeed * (guarding ? 0.4 : forward < 0 && !r.spec.footwork ? 0.75 : 1) * (r.gassed ? 0.75 : 1);
        r.x += mx * speed;
        r.y += my * speed;
        r.moving = true;
        r.walkPhase += 0.16 * Math.min(1, mag);
      }
      break;
    }
    case 'ko':
    case 'tko':
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
    const vulnerable = target.action !== 'down' && target.action !== 'getup' && target.action !== 'ko' && target.action !== 'tko';
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
    // 這一下造成的硬直長短（種子亂數，重播一致）
    const jit = 1 - TUNE.stunJitter + 2 * TUNE.stunJitter * m.rng.next();
    const facingAttacker = Math.abs(wrapAngle(fatan2(-dy, -dx) - target.heading)) < GUARD_ARC;
    const blocked = target.action === 'guard' && facingAttacker;
    // 霸體（街頭亂鬥流派才有）：重拳蓄力時挨打照樣痛，但打不斷它（除非平衡值被打光）
    const armored = target.spec.heavyArmor && target.action === 'windup' && target.attack === 'heavy';
    // 打斷對手的前搖 = 反擊，傷害更高
    const counter = target.action === 'windup' && !armored;
    // 砸穿防禦（街頭亂鬥流派才有）：重拳被擋下來，還是有一半的力道穿過去
    const crush = blocked && attacker.spec.guardCrush && attacker.attack === 'heavy';
    // 作戰計畫：戰術本身的倍率，加上克制對手戰術的加成
    const ta = TACTICS[attacker.tactic];
    const edge = beats(attacker.tactic, target.tactic) ? TUNE.counterBonus : 1;
    const damage = a.damage * target.spec.damageTaken * (blocked ? (crush ? TUNE.crushDamage : 0.2) : 1) * (counter || armored ? 1.3 : 1) * ta.damage * edge;
    const kb = a.knockback * (blocked ? 0.4 : 1) * target.spec.knockbackTaken;
    if (!blocked && attacker.attack === 'heavy') attacker.sinceLandedBig = 0;

    target.hp = Math.max(0, target.hp - damage);
    // 裁判看的數據：傷害、乾淨打中；挨打沒還手的次數
    const st = m.stats[m.stats.length - 1];
    st[attacker.id].damage += damage;
    if (!blocked) {
      st[attacker.id].landed++;
      attacker.unanswered = 0;
      target.unanswered++;
    }
    // 擋住的拳照樣削平衡值：一直防禦會被打到破防倒地
    target.poise -=
      a.poise *
      (blocked ? (crush ? TUNE.crushPoise : TUNE.blockPoise) * TACTICS[target.tactic].blockPoise * ta.breakPoise : 1) *
      (counter ? 1.4 : 1) *
      (armored ? TUNE.armorPoise : 1) *
      edge;
    // 格擋硬直：擋下來之後有一小段時間只能繼續擋，不能馬上反擊
    if (blocked) target.blockStun = Math.round(a.stun * 0.75 * jit);
    // 化勁（太極流派才有）：被擋下來的刺拳會被帶開，出拳的人踉蹌露出破綻。重拳太沉，化不掉；長矛打得太遠，手搭不到，也化不掉。
    if (blocked && target.spec.parry && attacker.attack === 'jab' && attacker.action === 'recover' && a.reach <= TUNE.parryReach) {
      attacker.stunTicks = Math.round(TUNE.parryStun * jit);
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
      m.method = 'KO';
      m.events.push({ type: 'ko', robot: target.id });
    } else if (target.poise <= 0) {
      target.poise = 0;
      target.dashTicks = 0;
      target.knockdowns++;
      st[attacker.id].knockdowns++;
      setAction(target, 'down');
      m.events.push({ type: 'down', robot: target.id });
      // 倒下去的時候已經快不行了，或這回合倒太多次：裁判直接揮手結束
      if (target.hp < target.spec.maxHp * TUNE.tkoDownHp) stop(m, target, 'hurt');
      else if (target.knockdowns >= TUNE.tkoKnockdowns) stop(m, target, 'knockdowns');
    } else if (!blocked && target.unanswered >= TUNE.tkoStreak && target.hp < target.spec.maxHp * TUNE.tkoHp) {
      // 一直挨打、沒在還手、血也不多了：裁判衝進來中止比賽
      target.dashTicks = 0;
      setAction(target, 'tko');
      stop(m, target, 'strikes');
    } else if ((!blocked || crush) && !armored) {
      // 被砸穿防禦也會硬直：手被震開了
      target.blockStun = 0;
      target.stunTicks = Math.round(a.stun * (crush ? TUNE.crushStun : 1) * jit);
      target.dashTicks = 0;
      setAction(target, 'stagger');
    }
  }
}

/** 裁判中止比賽（TKO）。倒在地上的就留在地上，站著的換成「不能打了」的樣子 */
function stop(m: Match, r: Robot, why: 'strikes' | 'knockdowns' | 'hurt'): void {
  if (m.method) return;
  m.method = 'TKO';
  m.events.push({ type: 'tko', robot: r.id, why });
}

function physics(m: Match, r: Robot): void {
  r.x += r.kx;
  r.y += r.ky;
  r.kx *= KNOCKBACK_FRICTION;
  r.ky *= KNOCKBACK_FRICTION;
  if (Math.abs(r.kx) < 0.01) r.kx = 0;
  if (Math.abs(r.ky) < 0.01) r.ky = 0;

  // 圓形鐵籠：超出半徑就推回來，撞得夠用力會反彈
  const limit = ARENA_RADIUS - r.spec.radius;
  const d2 = r.x * r.x + r.y * r.y;
  if (d2 > limit * limit) {
    const d = Math.sqrt(d2);
    const nx = r.x / d;
    const ny = r.y / d;
    r.x = nx * limit;
    r.y = ny * limit;
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

function finish(m: Match, winner: number, method: FinishMethod): void {
  m.phase = 'over';
  m.phaseTicks = 0;
  m.winner = winner;
  m.method = method;
  m.events.push({ type: 'end', winner, method });
  for (const r of m.robots) {
    if (r.action === 'ko' || r.action === 'down' || r.action === 'tko') continue;
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
      m.events.push({ type: 'start' }, { type: 'round', n: 1 }, { type: 'tactic', round: 1, tactics: [a0(m), a1(m)] });
    }
  }

  const [a, b] = m.robots;
  const fighting = m.phase === 'fight';
  const canThink = (r: Robot): boolean => fighting && r.blockStun === 0 && (r.action === 'idle' || r.action === 'guard');
  const clock = { tick: m.fightTicks, elapsed: m.fightTicks / TICK_HZ, left: (MATCH_TICKS - m.fightTicks) / TICK_HZ };
  const ia = canThink(a) ? think(a, b, m.brains[0], clock, m.rng) : m.phase === 'break' ? toCorner(a) : null;
  const ib = canThink(b) ? think(b, a, m.brains[1], clock, m.rng) : m.phase === 'break' ? toCorner(b) : null;
  if (fighting) {
    // 壓迫：正在往對手靠近的那一邊（裁判 C 特別看這個）
    const st = m.stats[m.stats.length - 1];
    for (const [r, foe] of [[a, b], [b, a]] as const) {
      const before = Math.hypot(foe.x - r.x, foe.y - r.y);
      if (r.moving || r.dashTicks > 0) {
        const fx = fcos(r.heading);
        const fy = fsin(r.heading);
        if (((foe.x - r.x) * fx + (foe.y - r.y) * fy) / (before || 1) > 0.7 && before < 90) st[r.id].pressure++;
      }
    }
  }
  updateRobot(m, a, ia);
  updateRobot(m, b, ib);
  resolveHits(m);
  physics(m, a);
  physics(m, b);
  separate(a, b);

  if (fighting) {
    m.fightTicks++;
    m.roundTicks++;
    const aOut = a.action === 'ko' || (m.method === 'TKO' && isStopped(a));
    const bOut = b.action === 'ko' || (m.method === 'TKO' && isStopped(b));
    if (aOut || bOut) finish(m, aOut && bOut ? -1 : aOut ? 1 : 0, aOut && bOut ? 'DRAW' : m.method ?? 'KO');
    else if (m.roundTicks >= ROUND_TICKS) endRound(m);
  } else if (m.phase === 'break') {
    if (m.phaseTicks >= BREAK_TICKS) startRound(m);
  } else if (m.phase === 'over' && m.phaseTicks >= OUTRO_TICKS) {
    m.done = true;
  }
}

/** 被裁判中止的那一台：TKO 時站著不能打（tko），或倒在地上（down） */
function isStopped(r: Robot): boolean {
  return r.action === 'tko' || r.action === 'down';
}

/** 局間休息：自己走回角落，面向擂台中間 */
function toCorner(r: Robot): Intent {
  const cx = r.id === 0 ? -START_X : START_X;
  const dx = cx - r.x;
  const dy = -r.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  const walk = d > 3;
  return {
    moveX: walk ? dx / d : 0,
    moveY: walk ? dy / d : 0,
    face: walk ? fatan2(dy, dx) : r.id === 0 ? 0 : PI,
    attack: null,
    guard: false,
    dash: false,
    label: '回角落休息',
    rule: -1,
    fumble: false,
  };
}

/** 鐘響：裁判打分；還有下一回合就休息，沒有就判定 */
function endRound(m: Match): void {
  const [a, b] = m.robots;
  m.cards.push(scoreRound(m.stats[m.stats.length - 1], [a.spec.maxHp, b.spec.maxHp], m.judgeRng));
  m.events.push({ type: 'bell', n: m.round });
  if (m.round >= ROUNDS) {
    m.decision = decide(m.cards);
    finish(m, m.decision.winner, m.decision.winner === -1 ? 'DRAW' : 'DEC');
    return;
  }
  m.phase = 'break';
  m.phaseTicks = 0;
  for (const r of m.robots) {
    // 鐘響就停手：出到一半的拳收回來，衝刺停下來
    if (r.action === 'windup' || r.action === 'recover' || r.action === 'guard') setAction(r, 'idle');
    r.dashTicks = 0;
    r.energy = Math.min(r.spec.maxEnergy, r.energy + (r.spec.maxEnergy - r.energy) * TUNE.breakEnergy);
    if (r.energy >= TUNE.gassedUntil) r.gassed = false;
  }
}

/** 下一回合開始：兩邊回到起始位置 */
function startRound(m: Match): void {
  m.round++;
  m.roundTicks = 0;
  m.phase = 'fight';
  m.phaseTicks = 0;
  m.stats.push([newStats(), newStats()]);
  for (const r of m.robots) {
    r.x = r.id === 0 ? -START_X : START_X;
    r.y = 0;
    r.heading = r.id === 0 ? 0 : PI;
    r.kx = 0;
    r.ky = 0;
    r.poise = r.spec.maxPoise;
    r.knockdowns = 0;
    r.unanswered = 0;
    r.stunTicks = 0;
    r.blockStun = 0;
    if (r.action !== 'idle') setAction(r, 'idle');
  }
  applyTactics(m);
  m.events.push({ type: 'round', n: m.round }, { type: 'tactic', round: m.round, tactics: [a0(m), a1(m)] });
}

const a0 = (m: Match): Tactic => m.robots[0].tactic;
const a1 = (m: Match): Tactic => m.robots[1].tactic;

/** 把整場狀態壓成一個數字，用來驗證重播是否一致 */
export function matchHash(m: Match): number {
  let h = m.tick | 0;
  for (const r of m.robots) {
    for (const v of [r.x, r.y, r.heading, r.hp, r.poise, r.energy]) h = (Math.imul(h, 31) + Math.round(v * 1000)) | 0;
  }
  return (h ^ m.rng.state) >>> 0;
}
