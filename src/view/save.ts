/** 玩家的進度存檔（localStorage）：自訓模型、性格、今天訓練營用掉的經驗。只存在本機。 */
import { cleanModel, newModel, TRAINING_DAILY_XP, type TrainedModel } from '../sim/model';
import { cleanTemper, NEUTRAL, type Temper } from '../sim/temper';

const KEY = 'prompt-cage.progress';

export interface Progress {
  model: TrainedModel;
  temper: Temper;
  /** 訓練營的每日上限：哪一天、那天已經拿了多少經驗 */
  day: string;
  campXp: number;
  campRuns: number;
  fights: number;
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export function loadProgress(): Progress {
  const fresh: Progress = { model: newModel(), temper: { ...NEUTRAL }, day: today(), campXp: 0, campRuns: 0, fights: 0 };
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
    };
  } catch {
    return fresh;
  }
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
