/**
 * 作戰計畫：賽前替三個回合各排一個戰術。照計畫打，所以對手不在線上也能打（對戰世界）。
 * 單人模式在局間休息可以改「下一回合」的戰術；改的是還沒用到的那一格，
 * 所以把最後的計畫存進重播，重跑出來一定一模一樣。
 *
 * 四種戰術互相克制（像猜拳繞一圈）：猛攻 → 技巧 → 破防 → 防守 → 猛攻。
 * 這回合我的戰術克制對手的，打出去的傷害和削平衡值都多 TUNE.counterBonus。
 * 「隨機應變」完全不改任何數值（沒有計畫 = 以前的打法）。
 * 純邏輯，不碰畫面。
 */
import { AXES, type Axis, type Temper } from './temper';

export type Tactic = 'auto' | 'rush' | 'guard' | 'tech' | 'break';
export const TACTIC_LIST: Tactic[] = ['rush', 'tech', 'break', 'guard', 'auto'];
export const ROUND_COUNT = 3;
export type Plan = Tactic[];

export interface TacticDef {
  id: Tactic;
  name: string;
  icon: string;
  /** 一句話說明 */
  text: string;
  /** 性格往哪裡推（加在原本的性格上） */
  temper: Partial<Record<Axis, number>>;
  /** 出拳、衝刺花的能量倍率 */
  energy: number;
  /** 回能量的倍率 */
  regen: number;
  /** 打出去的傷害倍率 */
  damage: number;
  /** 自己擋拳時，平衡值扣的倍率 */
  blockPoise: number;
  /** 對手擋下我的拳時，削它平衡值的倍率 */
  breakPoise: number;
  /** 思考間隔倍率（越小反應越快） */
  react: number;
}

const NONE = { energy: 1, regen: 1, damage: 1, blockPoise: 1, breakPoise: 1, react: 1 };

export const TACTICS: Record<Tactic, TacticDef> = {
  auto: { id: 'auto', name: '隨機應變', icon: '🎲', text: '照平常的打法', temper: {}, ...NONE },
  rush: {
    id: 'rush',
    name: '猛攻',
    icon: '🔥',
    text: '貼上去一直打，比較耗電',
    temper: { drive: 0.3, grip: 0.25 },
    ...NONE,
    energy: 1.18,
    damage: 1.03,
  },
  guard: {
    id: 'guard',
    name: '防守',
    icon: '🛡',
    text: '擋得穩、回電快，出手變少',
    temper: { drive: -0.3, grip: -0.1 },
    ...NONE,
    regen: 1.3,
    blockPoise: 0.7,
    damage: 0.97,
  },
  tech: {
    id: 'tech',
    name: '技巧',
    icon: '🎯',
    text: '外圍刺拳、反應更快',
    temper: { nerve: -0.3, grip: -0.2 },
    ...NONE,
    react: 0.78,
    energy: 0.9,
    damage: 1.04,
  },
  break: {
    id: 'break',
    name: '破防',
    icon: '💥',
    text: '多出重拳，專砸防禦',
    temper: { nerve: 0.35 },
    ...NONE,
    energy: 1.12,
    breakPoise: 1.35,
  },
};

/** 誰克制誰：key 克制 value */
export const BEATS: Record<Tactic, Tactic | null> = { rush: 'tech', tech: 'break', break: 'guard', guard: 'rush', auto: null };

export function beats(a: Tactic, b: Tactic): boolean {
  return BEATS[a] === b;
}

export const DEFAULT_PLAN: Plan = ['auto', 'auto', 'auto'];

export function cleanPlan(raw: unknown): Plan {
  const out: Plan = [...DEFAULT_PLAN];
  if (Array.isArray(raw)) for (let i = 0; i < ROUND_COUNT; i++) if (typeof raw[i] === 'string' && raw[i] in TACTICS) out[i] = raw[i] as Tactic;
  return out;
}

/** 照戰術推過的性格（範圍和性格本身一樣，0.1..0.9） */
export function tacticTemper(base: Temper, t: Tactic): Temper {
  const d = TACTICS[t].temper;
  const out = { ...base };
  for (const axis of AXES) if (d[axis]) out[axis] = Math.max(0.1, Math.min(0.9, base[axis] + d[axis]!));
  return out;
}
