/**
 * AI 教練（純邏輯，不串任何外部 AI）。兩件事：
 *  1. 陪練模擬：把幾套配法拿去和對手無畫面打幾場，回報勝率，挑出最好的幾套讓玩家選。
 *     戰鬥邏輯是純函式，所以「先模擬再決定」就是真的把比賽跑過一遍，不是估的。
 *  2. 賽後講評：從這一場的事件數出幾個數字，給一兩句具體的建議。
 */
import { Rng } from '../core/rng';
import { BRAINS, CARDS, legalDeck, type BrainId } from './cards';
import { ARMORS, fitDeck, PLATE_STEP, plateOf, THRUSTERS, totalCost, WEAPONS, withinBudget } from './gear';
import { createMatch, stepMatch, type Match, type RobotSetup } from './match';
import type { Loadout, SimEvent } from './types';

/** 每套配法模擬幾場 */
export const TRIAL_FIGHTS = 8;

export interface Trial {
  setup: RobotSetup;
  wins: number;
  fights: number;
  /** 平均每場打完多出來的血量比例（-1..1），勝場一樣多時用它分高下 */
  margin: number;
  cost: number;
  /** 和現在這台差在哪裡（給玩家看的） */
  diff: string[];
}

function pick<T>(rng: Rng, list: readonly T[]): T {
  return list[rng.int(list.length)];
}

function key(s: RobotSetup): string {
  return `${s.gear.weapon}|${s.gear.armor}|${plateOf(s.gear)}|${s.gear.thruster}|${s.brain}|${[...s.deck].sort().join(',')}`;
}

/** 把一套配法整理成合法的：卡組照大腦的卡槽數裁掉、超出額度就從後面拿掉 */
function tidy(me: RobotSetup, gear: Loadout, brain: BrainId, deck: string[]): RobotSetup | null {
  const model = brain === 'trained' ? (me.model ?? null) : null;
  if (!withinBudget(gear, brain, [], model)) return null;
  const fitted = fitDeck(gear, brain, legalDeck(deck, brain), model);
  // 沒有流派的機器人只會走過去戳一下，不值得試
  if (!fitted.some((c) => CARDS[c].kind === 'style')) return null;
  return { ...me, gear, brain, deck: fitted };
}

/** 從手上有的卡隨機湊一套：一張流派，再盡量把卡槽和額度用完 */
function randomBuild(me: RobotSetup, owned: readonly string[], rng: Rng, brains: readonly BrainId[]): RobotSetup | null {
  const gear: Loadout = {
    weapon: pick(rng, Object.keys(WEAPONS) as Loadout['weapon'][]),
    armor: pick(rng, Object.keys(ARMORS) as Loadout['armor'][]),
    thruster: pick(rng, Object.keys(THRUSTERS) as Loadout['thruster'][]),
  };
  const brain = pick(rng, brains);
  const styles = owned.filter((c) => CARDS[c]?.kind === 'style');
  if (styles.length === 0) return null;
  const rest = owned.filter((c) => CARDS[c] && CARDS[c].kind !== 'style');
  const deck = [pick(rng, styles)];
  const want = 1 + rng.int(BRAINS[brain].slots);
  let guard = 0;
  while (deck.length < want && rest.length > 0 && guard++ < 30) {
    const id = pick(rng, rest);
    if (!deck.includes(id)) deck.push(id);
  }
  return tidy(me, gear, brain, deck);
}

/** 只改現在這台的一個地方：玩家比較看得懂「為什麼變強」 */
function tweak(me: RobotSetup, owned: readonly string[], rng: Rng, brains: readonly BrainId[]): RobotSetup | null {
  const gear = { ...me.gear };
  let brain = me.brain;
  let deck = [...me.deck];
  const spare = owned.filter((c) => CARDS[c] && !deck.includes(c));
  switch (rng.int(7)) {
    case 0:
      gear.weapon = pick(rng, Object.keys(WEAPONS) as Loadout['weapon'][]);
      break;
    case 1:
      gear.armor = pick(rng, Object.keys(ARMORS) as Loadout['armor'][]);
      gear.plate = ARMORS[gear.armor].plate;
      break;
    case 6: {
      // 裝甲加厚或減薄 5～10 mm（越厚越耐打，但越重越慢）
      const step = (rng.int(2) + 1) * PLATE_STEP * (rng.int(2) ? 1 : -1);
      gear.plate = Math.max(0, Math.min(ARMORS[gear.armor].maxPlate, plateOf(gear) + step));
      break;
    }
    case 2:
      brain = pick(rng, brains);
      break;
    case 3: {
      // 換流派
      const styles = spare.filter((c) => CARDS[c].kind === 'style');
      if (styles.length === 0) return null;
      deck = [pick(rng, styles), ...deck.filter((c) => CARDS[c].kind !== 'style')];
      break;
    }
    case 4: {
      // 加一張（或換掉最後一張）
      const others = spare.filter((c) => CARDS[c].kind !== 'style');
      if (others.length === 0) return null;
      if (deck.length >= BRAINS[brain].slots) deck.pop();
      deck.push(pick(rng, others));
      break;
    }
    default:
      // 拿掉一張不是流派的卡：反應會快一點，也省額度
      deck = deck.filter((c, i) => CARDS[c].kind === 'style' || i !== deck.length - 1);
      break;
  }
  return tidy(me, gear, brain, deck);
}

/** 要拿去試的配法：現在這台排第一個，後面一半是小改、一半是重新湊的。同樣的種子一定得到同一批。 */
export function candidates(me: RobotSetup, owned: readonly string[], seed: number, count: number): RobotSetup[] {
  const rng = new Rng(seed);
  const brains = (Object.keys(BRAINS) as BrainId[]).filter((b) => b !== 'trained' || me.brain === 'trained');
  const out: RobotSetup[] = [me];
  const seen = new Set([key(me)]);
  let guard = 0;
  while (out.length < count && guard++ < count * 20) {
    const c = guard % 2 ? tweak(me, owned, rng, brains) : randomBuild(me, owned, rng, brains);
    if (!c || seen.has(key(c))) continue;
    seen.add(key(c));
    out.push(c);
  }
  return out;
}

function diffOf(me: RobotSetup, s: RobotSetup): string[] {
  const out: string[] = [];
  if (s.gear.weapon !== me.gear.weapon) out.push(`武器 ${WEAPONS[me.gear.weapon].name} → ${WEAPONS[s.gear.weapon].name}`);
  if (s.gear.armor !== me.gear.armor) out.push(`骨架 ${ARMORS[me.gear.armor].name} → ${ARMORS[s.gear.armor].name}`);
  if (plateOf(s.gear) !== plateOf(me.gear)) out.push(`裝甲 ${plateOf(me.gear)} → ${plateOf(s.gear)} mm`);
  if (s.gear.thruster !== me.gear.thruster) out.push(`推進器 ${THRUSTERS[me.gear.thruster].name} → ${THRUSTERS[s.gear.thruster].name}`);
  if (s.brain !== me.brain) out.push(`大腦 ${BRAINS[me.brain].name} → ${BRAINS[s.brain].name}`);
  const added = s.deck.filter((c) => !me.deck.includes(c)).map((c) => CARDS[c].name);
  const removed = me.deck.filter((c) => !s.deck.includes(c)).map((c) => CARDS[c].name);
  if (added.length) out.push('插上 ' + added.join('、'));
  if (removed.length) out.push('拿掉 ' + removed.join('、'));
  return out;
}

/** 拿一套配法和對手無畫面打幾場。me 是玩家現在這台（用來列出差在哪裡）。 */
export function trial(me: RobotSetup, setup: RobotSetup, foe: RobotSetup, seed: number, fights = TRIAL_FIGHTS): Trial {
  let wins = 0;
  let margin = 0;
  for (let i = 0; i < fights; i++) {
    const m = createMatch((seed + i * 7919) >>> 0, [setup, foe]);
    let guard = 0;
    while (m.phase !== 'over' && guard++ < 20000) stepMatch(m);
    if (m.winner === 0) wins++;
    margin += m.robots[0].hp / m.robots[0].spec.maxHp - m.robots[1].hp / m.robots[1].spec.maxHp;
  }
  return {
    setup,
    wins,
    fights,
    margin: margin / fights,
    cost: totalCost(setup.gear, setup.brain, setup.deck, setup.brain === 'trained' ? (setup.model ?? null) : null),
    diff: diffOf(me, setup),
  };
}

/** 勝場多的排前面；一樣多就看平均贏多少血 */
export function better(a: Trial, b: Trial): number {
  return b.wins - a.wins || b.margin - a.margin;
}

// ---------------------------------------------------------------- 賽後講評

/** 一場比賽裡，玩家這一邊（side）的幾個數字。只讀事件，不影響勝負。 */
export interface FightLog {
  landed: number;
  /** 打中的重拳、反擊、打出的傷害（贊助商合約看這些） */
  heavyLanded: number;
  counters: number;
  dealt: number;
  /** 我的拳被對手擋下來幾下 */
  stopped: number;
  whiffs: number;
  taken: number;
  heavyTaken: number;
  gassed: number;
  downs: number;
  /** 打了幾個 tick、其中幾個 tick 大腦在聽錯 */
  ticks: number;
  fumbleTicks: number;
}

export function newLog(): FightLog {
  return { landed: 0, heavyLanded: 0, counters: 0, dealt: 0, stopped: 0, whiffs: 0, taken: 0, heavyTaken: 0, gassed: 0, downs: 0, ticks: 0, fumbleTicks: 0 };
}

/** 每個 tick 之後叫一次 */
export function logTick(log: FightLog, m: Match, side: number): void {
  if (m.phase === 'fight') {
    log.ticks++;
    if (m.robots[side].fumbling) log.fumbleTicks++;
  }
  for (const e of m.events as SimEvent[]) {
    if (e.type === 'hit') {
      if (e.attacker === side) {
        if (e.blocked) log.stopped++;
        else {
          log.landed++;
          if (e.kind === 'heavy') log.heavyLanded++;
          if (e.counter) log.counters++;
          log.dealt += e.damage;
        }
      } else if (!e.blocked) {
        log.taken++;
        if (e.kind === 'heavy') log.heavyTaken++;
      }
    } else if (e.type === 'whiff' && e.robot === side) log.whiffs++;
    else if (e.type === 'gassed' && e.robot === side) log.gassed++;
    else if (e.type === 'down' && e.robot === side) log.downs++;
  }
}

/** 教練看完這一場的建議，最多兩句，最嚴重的排前面 */
export function advice(log: FightLog, m: Match, me: RobotSetup, owned: readonly string[]): string[] {
  const out: string[] = [];
  const ko = m.method === 'KO' || m.method === 'TKO';
  const fumble = log.ticks > 0 ? log.fumbleTicks / log.ticks : 0;
  if (log.gassed >= 2) out.push(`沒電了 ${log.gassed} 次，沒電時只能抱頭挨打。拿掉一張卡、換省電一點的流派，或做「耐心訓練」。`);
  if (log.heavyTaken >= 3) {
    out.push(
      owned.includes('read_heavy') && !me.deck.includes('read_heavy')
        ? `吃了 ${log.heavyTaken} 記重拳。你手上有「${CARDS.read_heavy.name}」，插上去會好很多。`
        : `吃了 ${log.heavyTaken} 記重拳。換厚一點的骨架，或做「基本功」練防守。`,
    );
  }
  if (fumble > 0.15) out.push(`大腦有 ${Math.round(fumble * 100)}% 的時間在聽錯指令。卡越多越容易聽錯：拿掉一張，或換好一點的大腦。`);
  if (log.whiffs >= 6 && log.whiffs > log.landed * 1.5) out.push(`揮空 ${log.whiffs} 次、只打中 ${log.landed} 次：距離抓不準。換長一點的武器，或做「步法訓練」。`);
  if (log.stopped >= 6 && log.stopped > log.landed) out.push(`有 ${log.stopped} 拳被擋下來，只打進去 ${log.landed} 拳。對手很會防：換重一點的武器，或做「重砲訓練」多出重拳。`);
  if (m.winner === 1 && !ko && out.length === 0)
    out.push('三回合打完，裁判判你輸。裁判看打中的次數、傷害和誰在往前壓：做「壓迫訓練」打得積極一點，或讓我跑一次陪練模擬找更好的配法。');
  if (m.winner === 1 && out.length === 0) out.push('這個對手剋你現在的配法。讓我跑一次陪練模擬，找一套打得贏它的。');
  if (m.winner === 0 && out.length === 0)
    out.push(
      log.landed >= log.taken * 1.5
        ? `打得很乾淨：打中 ${log.landed} 拳、只挨了 ${log.taken} 拳。這套可以繼續用。`
        : `贏了，但打中 ${log.landed} 拳也挨了 ${log.taken} 拳，是硬換來的。下一個對手更強，做「基本功」練防守，或讓我跑一次陪練模擬。`,
    );
  return out.slice(0, 2);
}
