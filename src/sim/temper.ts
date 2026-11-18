/**
 * 性格：長出來的，不是從選單挑的。規則照 Godot 版（scripts/sim/temper.gd）。
 * 三個傾向，各 0..1，0.5 是中間（全部 0.5 = 完全沒有性格，行為和沒有這個系統時一模一樣）：
 *   drive 🔥 積極：搶著出手、慢半拍才肯退 ↔ 🧘 沉著：等對手先動、防守反應快
 *   nerve 🎲 大膽：愛出重拳 ↔ 🛡 穩健：多用刺拳
 *   grip  🤼 貼身：喜歡黏著打 ↔ 🦶 游走：保持在外圍
 * （Godot 版的 grip 是擒抱；網頁版沒有擒抱，改成「打的距離」。）
 * 每場打完，每個傾向往「這場實際的打法」漂移一點；訓練營可以刻意推其中一個。
 * 沒有哪一頭比較好。性格只影響流派怎麼補細節，不會蓋過卡牌。
 */
import type { ActionKind } from './rules';

export type Axis = 'drive' | 'nerve' | 'grip';
export const AXES: Axis[] = ['drive', 'nerve', 'grip'];
export type Temper = Record<Axis, number>;

export const AXIS_TEXT: Record<Axis, { high: string; low: string }> = {
  drive: { high: '🔥 積極', low: '🧘 沉著' },
  nerve: { high: '🎲 大膽', low: '🛡 穩健' },
  grip: { high: '🤼 貼身', low: '🦶 游走' },
};

const MIN = 0.1;
const MAX = 0.9;
/** 一場對戰讓每個傾向往它表現出來的樣子靠近多少 */
const RATE = 0.06;
/** 訓練營額外推的量 */
const CAMP_PUSH = 0.07;
/** 中間性格的機器人在一場對戰裡平均表現出來的值（無畫面量出來的），以及差多少算多少 */
const MEAN: Temper = { drive: 0.67, nerve: 0.27, grip: 0.46 };
const SCALE: Temper = { drive: 1.2, nerve: 1.2, grip: 0.9 };
/** 能動的時間少於這麼多 tick 的對戰學不到東西 */
const MIN_TICKS = 300;

export const NEUTRAL: Temper = { drive: 0.5, nerve: 0.5, grip: 0.5 };

export function cleanTemper(raw: unknown): Temper {
  const out = { ...NEUTRAL };
  for (const axis of AXES) {
    const v = Number((raw as Record<string, unknown> | null)?.[axis]);
    if (Number.isFinite(v)) out[axis] = Math.max(MIN, Math.min(MAX, v));
  }
  return out;
}

/** 離中間多遠：-0.4..0.4 */
export function lean(t: Temper, axis: Axis): number {
  return t[axis] - 0.5;
}

/** 屬於「等、守、退」的動作：沉著的性格接得快，積極的接得慢 */
const WAITING: ActionKind[] = ['guard', 'slip', 'keepaway', 'kite', 'counter', 'wait', 'center', 'dashOut'];

export function isWaiting(action: ActionKind): boolean {
  return WAITING.includes(action);
}

/** 性格對反應時間的影響（中間 = 1） */
export function reactMult(t: Temper, action: ActionKind): number {
  const d = lean(t, 'drive');
  return isWaiting(action) ? 1 + 0.35 * d : 1 - 0.35 * d;
}

/** 大腦在一場對戰裡記下的打法統計 */
export interface FightNotes {
  /** 能自己決定動作的 tick 數 */
  ticks: number;
  /** 其中離對手很近的 tick 數 */
  close: number;
  /** 其中在做進攻類動作的 tick 數 */
  forward: number;
  swings: number;
  heavies: number;
}

export function newNotes(): FightNotes {
  return { ticks: 0, close: 0, forward: 0, swings: 0, heavies: 0 };
}

/** 這場對戰裡每個傾向表現出來的值（資料不夠就沒有） */
export function observe(n: FightNotes): Partial<Temper> {
  const seen: Partial<Temper> = {};
  if (n.ticks < MIN_TICKS) return seen;
  seen.drive = n.forward / n.ticks;
  seen.grip = n.close / n.ticks;
  if (n.swings >= 4) seen.nerve = n.heavies / n.swings;
  return seen;
}

/** 打完一場：每個傾向往這場表現出來的樣子漂移 */
export function learnTemper(t: Temper, notes: FightNotes): Temper {
  const seen = observe(notes);
  const out = { ...t };
  for (const axis of AXES) {
    const v = seen[axis];
    if (v === undefined) continue;
    const target = Math.max(0, Math.min(1, 0.5 + (v - MEAN[axis]) * SCALE[axis]));
    out[axis] = Math.max(MIN, Math.min(MAX, t[axis] + (target - t[axis]) * RATE));
  }
  return out;
}

/** 訓練營：把一個傾向往上（dir 1）或往下（-1）推 */
export function pushTemper(t: Temper, axis: Axis, dir: 1 | -1): Temper {
  return { ...t, [axis]: Math.max(MIN, Math.min(MAX, t[axis] + CAMP_PUSH * dir)) };
}
