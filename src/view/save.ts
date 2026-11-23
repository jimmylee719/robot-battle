/** 玩家的進度存檔（localStorage）：自訓模型、性格、今天訓練營用掉的經驗。只存在本機。 */
import { cleanModel, newModel, TRAINING_DAILY_XP, type TrainedModel } from '../sim/model';
import { cleanTemper, NEUTRAL, type Temper } from '../sim/temper';
import { cleanOwned } from '../sim/album';
import { LADDER } from '../sim/roster';
import { cleanWallet, newWallet, type Wallet } from '../sim/gacha';

const KEY = 'prompt-cage.progress';

export interface Progress {
  model: TrainedModel;
  temper: Temper;
  /** 訓練營的每日上限：哪一天、那天已經拿了多少經驗 */
  day: string;
  campXp: number;
  campRuns: number;
  fights: number;
  /** 單人模式：擁有的卡、總勝場、對每個對手的戰績 */
  owned: string[];
  wins: number;
  record: Record<string, { w: number; l: number }>;
  /** 每日挑戰：今天的最佳成績和試了幾次、連續幾天打贏、最後一次打贏是哪一天 */
  daily: DailyRecord;
  /** 晶片幣、碎片、扭蛋保底、每張卡拿過幾張 */
  wallet: Wallet;
}

export interface DailyRecord {
  day: number;
  best: number;
  tries: number;
  streak: number;
  lastWin: number;
}

/** 今天是第幾天（UTC，全世界同一個時間換日） */
export function dailyDay(): number {
  return Math.floor(Date.now() / 86400000);
}

function cleanDaily(raw: unknown): DailyRecord {
  const r = (raw ?? {}) as Partial<DailyRecord>;
  const num = (v: unknown): number => Math.max(0, Math.floor(Number(v) || 0));
  const today = dailyDay();
  const lastWin = num(r.lastWin);
  // 換日：今天的成績歸零；昨天沒打贏的話連續天數也斷了
  const sameDay = num(r.day) === today;
  return {
    day: today,
    best: sameDay ? num(r.best) : 0,
    tries: sameDay ? num(r.tries) : 0,
    streak: lastWin >= today - 1 ? num(r.streak) : 0,
    lastWin,
  };
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export function loadProgress(): Progress {
  const fresh: Progress = {
    model: newModel(),
    temper: { ...NEUTRAL },
    day: today(),
    campXp: 0,
    campRuns: 0,
    fights: 0,
    owned: cleanOwned(null),
    wins: 0,
    record: {},
    daily: cleanDaily(null),
    wallet: newWallet(),
  };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh;
    const v = JSON.parse(raw) as Partial<Progress>;
    const sameDay = v.day === today();
    return {
      model: cleanModel(v.model),
      temper: cleanTemper(v.temper),
      day: today(),
      campXp: sameDay ? Math.max(0, Number(v.campXp) || 0) : 0,
      campRuns: Math.max(0, Math.floor(Number(v.campRuns) || 0)),
      fights: Math.max(0, Math.floor(Number(v.fights) || 0)),
      owned: cleanOwned(v.owned),
      wins: Math.max(0, Math.floor(Number(v.wins) || 0)),
      record: cleanRecord(v.record),
      daily: cleanDaily(v.daily),
      // 舊存檔沒有錢包：一樣送見面禮
      wallet: cleanWallet(v.wallet),
    };
  } catch {
    return fresh;
  }
}

function cleanRecord(raw: unknown): Progress['record'] {
  const out: Progress['record'] = {};
  for (const o of LADDER) {
    const r = (raw as Record<string, { w?: unknown; l?: unknown }> | null)?.[o.id];
    out[o.id] = { w: Math.max(0, Math.floor(Number(r?.w) || 0)), l: Math.max(0, Math.floor(Number(r?.l) || 0)) };
  }
  return out;
}

/** 打得到第幾個對手：要先贏過前一個 */
export function unlockedCount(p: Progress): number {
  let n = 1;
  while (n < LADDER.length && (p.record[LADDER[n - 1].id]?.w ?? 0) > 0) n++;
  return n;
}

export function saveProgress(p: Progress): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // 存不了就算了（無痕模式等）
  }
}

/** 今天訓練營還能給多少經驗 */
export function campXpLeft(p: Progress): number {
  if (p.day !== today()) {
    p.day = today();
    p.campXp = 0;
  }
  return Math.max(0, TRAINING_DAILY_XP - p.campXp);
}
