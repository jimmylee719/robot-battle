/**
 * 自訓模型：玩家自己養的大腦。規則照 Godot 版（scripts/ai/trained_model.gd）。
 *  - 不是一個固定的準確率，而是「每個動作各有熟練度」，實戰用得越多越熟
 *  - 20% 起跳，一開始長得快、後來變慢，最高 90%（等於最好的現成大腦）
 *  - 做成功（打中、擋住、躲掉）比只是做了學得多
 *  - 沒用到的動作每場退一點，但學會之後不會低於 40%
 *  - 練最多的動作會變成習慣：聽錯時就會做它
 *  - 價格跟著最強的幾招漲，所以練強了還是要花預算
 * 全部是純函式；存檔由 view/save.ts 負責。
 */
import { ACTION_TEXT, type ActionKind } from './rules';

export const START = 0.2;
export const CAP = 0.9;
/** 穩定使用大約 10 場會到 65% 左右 */
const XP_SCALE = 300;
/** 做成功一次的額外經驗（每用一次本來就 +1） */
const SUCCESS_XP = 2;
/** 沒用到的動作，每場剩下這個比例的經驗 */
const DECAY = 0.97;
/** 學會過的動作不會退到這個熟練度以下 */
const DECAY_FLOOR = 0.4;
/** 練到這麼多經驗才會變成習慣 */
const FAVORITE_XP = 90;
/** 訓練營學得比較快，但每天有上限 */
export const TRAINING_MULT = 1.5;
export const TRAINING_DAILY_XP = 200;
const COST_BASE = 80;
const COST_PER_PROF = 350;

/** 玩家的模型：每個動作累積的經驗 */
export interface TrainedModel {
  xp: Record<string, number>;
}

/** 開打時凍結的版本：一場對戰只看這個，所以重播不受之後的訓練影響 */
export interface ModelSnapshot {
  prof: Record<string, number>;
  habit: ActionKind | null;
  cost: number;
}

export function profForXp(xp: number): number {
  return START + (CAP - START) * (1 - Math.exp(-Math.max(0, xp) / XP_SCALE));
}

function xpForProf(p: number): number {
  return -XP_SCALE * Math.log(1 - (p - START) / (CAP - START));
}

const FLOOR_XP = xpForProf(DECAY_FLOOR);

function isAction(key: string): key is ActionKind {
  return key in ACTION_TEXT;
}

export function newModel(): TrainedModel {
  return { xp: {} };
}

/** 存檔或分享碼進來的資料不能直接信：只留認得的動作、數字要在合理範圍 */
export function cleanModel(raw: unknown): TrainedModel {
  const out: TrainedModel = { xp: {} };
  const xp = (raw as { xp?: Record<string, unknown> } | null)?.xp;
  if (xp && typeof xp === 'object')
    for (const key of Object.keys(xp)) {
      const v = Number(xp[key]);
      if (isAction(key) && Number.isFinite(v) && v > 0) out.xp[key] = Math.min(v, 5000);
    }
  return out;
}

/** 習慣：練最多、而且練得夠多的那個動作 */
export function habitOf(model: TrainedModel): ActionKind | null {
  let best: ActionKind | null = null;
  let bestXp = FAVORITE_XP;
  for (const key of Object.keys(model.xp).sort()) {
    if (isAction(key) && model.xp[key] >= bestXp && (best === null || model.xp[key] > bestXp)) {
      best = key;
      bestXp = model.xp[key];
    }
  }
  return best;
}

/** 價格：看最強的三招的平均熟練度 */
export function costOf(prof: Record<string, number>): number {
  const top = Object.values(prof)
    .sort((a, b) => b - a)
    .slice(0, 3);
  while (top.length < 3) top.push(START);
  return Math.round(COST_BASE + COST_PER_PROF * (top.reduce((a, b) => a + b, 0) / 3));
}

export function snapshot(model: TrainedModel): ModelSnapshot {
  const prof: Record<string, number> = {};
  for (const key of Object.keys(model.xp).sort()) prof[key] = profForXp(model.xp[key]);
  return { prof, habit: habitOf(model), cost: costOf(prof) };
}

/** 別人給的快照：數字夾到合理範圍，價格重新算（不能自稱很便宜） */
export function cleanSnapshot(raw: unknown): ModelSnapshot {
  const prof: Record<string, number> = {};
  const r = raw as { prof?: Record<string, unknown>; habit?: unknown } | null;
  if (r?.prof && typeof r.prof === 'object')
    for (const key of Object.keys(r.prof).sort()) {
      const v = Number(r.prof[key]);
      if (isAction(key) && Number.isFinite(v)) prof[key] = Math.max(START, Math.min(CAP, v));
    }
  const habit = typeof r?.habit === 'string' && isAction(r.habit) && r.habit in prof ? r.habit : null;
  return { prof, habit, cost: costOf(prof) };
}

/** 一場打完之後，每個動作用了幾次、成功幾次 */
export interface Usage {
  used: Record<string, number>;
  success: Record<string, number>;
}

export interface LearnResult {
  model: TrainedModel;
  /** 熟練度有變的動作：[之前, 之後] */
  changes: Record<string, [number, number]>;
  /** 這次實際拿到多少經驗 */
  gained: number;
  /** 被每日上限砍掉了 */
  capped: boolean;
}

/**
 * 從一場對戰學習。mult 是學習倍率（訓練營 1.5）；xpLeft 是今天還能拿多少經驗
 * （實戰不設限就傳 Infinity）。不改原本的 model，回傳新的。
 */
export function learn(model: TrainedModel, usage: Usage, mult = 1, xpLeft = Infinity): LearnResult {
  const xp = { ...model.xp };
  const gains: Record<string, number> = {};
  let total = 0;
  for (const key of Object.keys(usage.used).sort()) {
    if (!isAction(key)) continue;
    const g = (usage.used[key] + SUCCESS_XP * (usage.success[key] ?? 0)) * mult;
    if (g > 0) {
      gains[key] = g;
      total += g;
    }
  }
  const allowed = Math.max(0, Math.min(total, xpLeft));
  const scale = total > 0 ? allowed / total : 0;

  const changes: Record<string, [number, number]> = {};
  for (const key of Object.keys(gains)) {
    const before = profForXp(xp[key] ?? 0);
    xp[key] = (xp[key] ?? 0) + gains[key] * scale;
    const after = profForXp(xp[key]);
    if (after - before > 0.0005) changes[key] = [before, after];
  }
  // 這場沒用到的動作退步一點
  for (const key of Object.keys(xp)) {
    if (key in gains) continue;
    const before = profForXp(xp[key]);
    const floor = xp[key] >= FLOOR_XP ? FLOOR_XP : 0;
    xp[key] = Math.max(floor, xp[key] * DECAY);
    const after = profForXp(xp[key]);
    if (before - after > 0.0005) changes[key] = [before, after];
  }
  return { model: { xp }, changes, gained: allowed, capped: allowed < total - 0.001 };
}
