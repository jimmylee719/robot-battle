/**
 * 三位裁判的計分，照 UFC 的「10 分必勝制」：每回合打得好的那一邊拿 10 分，另一邊 9 分；
 * 被打得很慘（被擊倒、傷害差很多）是 10-8；幾乎一樣才是 10-10。
 * 三位裁判看重的東西不太一樣（有人看傷害、有人看手數、有人看誰在往前壓），
 * 再加上一點「看漏」的誤差（種子亂數，重播一致），所以接近的比賽會出現分歧判定。
 * 純邏輯，不碰畫面。
 */
import { Rng } from '../core/rng';

/** 一邊在一個回合裡的數據 */
export interface RoundStats {
  /** 乾淨打中幾下 */
  landed: number;
  /** 出手幾次 */
  thrown: number;
  /** 打出去的傷害（含被擋下來穿過去的） */
  damage: number;
  /** 擊倒對手幾次 */
  knockdowns: number;
  /** 往對手逼近的時間（tick） */
  pressure: number;
}

export function newStats(): RoundStats {
  return { landed: 0, thrown: 0, damage: 0, knockdowns: 0, pressure: 0 };
}

interface Judge {
  name: string;
  /** 傷害（占對手血量的百分比）、擊倒、打中、出手、壓迫（秒）各算幾分 */
  damage: number;
  knockdown: number;
  landed: number;
  thrown: number;
  pressure: number;
}

export const JUDGES: readonly Judge[] = [
  // 看傷害：誰把誰打得比較痛
  { name: '裁判 A', damage: 1.2, knockdown: 14, landed: 0.4, thrown: 0, pressure: 0.15 },
  // 看手數：誰打中比較多下
  { name: '裁判 B', damage: 0.7, knockdown: 12, landed: 1.1, thrown: 0.1, pressure: 0.15 },
  // 看主導：誰在往前壓、誰在控制場面
  { name: '裁判 C', damage: 0.9, knockdown: 12, landed: 0.6, thrown: 0.15, pressure: 0.45 },
];

/** 這位裁判覺得一邊這回合打得多好 */
function grade(j: Judge, me: RoundStats, foeMaxHp: number): number {
  return (
    (me.damage / foeMaxHp) * 100 * j.damage +
    me.knockdowns * j.knockdown +
    me.landed * j.landed +
    me.thrown * j.thrown +
    (me.pressure / 60) * j.pressure
  );
}

/**
 * 一個回合的計分卡：每位裁判給 [紅, 藍] 幾分。
 * rng 是裁判專用的亂數（和戰鬥用的分開，才不會改到打鬥本身）。
 */
export function scoreRound(stats: [RoundStats, RoundStats], maxHp: [number, number], rng: Rng): [number, number][] {
  return JUDGES.map((j) => {
    // 看漏或看重某一下：每位裁判每回合有一點誤差
    const a = grade(j, stats[0], maxHp[1]) + (rng.next() - 0.5) * 3;
    const b = grade(j, stats[1], maxHp[0]) + (rng.next() - 0.5) * 3;
    const diff = a - b;
    if (Math.abs(diff) < 0.8) return [10, 10];
    const win = diff > 0 ? 0 : 1;
    const w = stats[win];
    const l = stats[1 - win];
    // 10-8：多擊倒兩次以上，或擊倒一次而且打得一面倒
    const lopsided = w.knockdowns - l.knockdowns >= 2 || (w.knockdowns > l.knockdowns && Math.abs(diff) > 30);
    const lose = lopsided ? 8 : 9;
    return win === 0 ? [10, lose] : [lose, 10];
  });
}

export type Verdict = 'unanimous' | 'split' | 'majority' | 'draw';

export interface Decision {
  /** 0 / 1 = 贏家，-1 = 平手 */
  winner: number;
  verdict: Verdict;
  /** 每位裁判的總分 [紅, 藍] */
  totals: [number, number][];
}

/** 三回合打完：把每位裁判的分數加起來，看幾位裁判判誰贏 */
export function decide(cards: [number, number][][]): Decision {
  const totals = JUDGES.map((_, j) => {
    let a = 0;
    let b = 0;
    for (const round of cards) {
      a += round[j][0];
      b += round[j][1];
    }
    return [a, b] as [number, number];
  });
  const red = totals.filter(([a, b]) => a > b).length;
  const blue = totals.filter(([a, b]) => b > a).length;
  const even = totals.length - red - blue;
  if (red === 3 || blue === 3) return { winner: red === 3 ? 0 : 1, verdict: 'unanimous', totals };
  if ((red === 2 && blue === 1) || (blue === 2 && red === 1)) return { winner: red > blue ? 0 : 1, verdict: 'split', totals };
  if ((red === 2 || blue === 2) && even === 1) return { winner: red > blue ? 0 : 1, verdict: 'majority', totals };
  return { winner: -1, verdict: 'draw', totals };
}

export const VERDICT_TEXT: Record<Verdict, string> = {
  unanimous: '一致判定',
  split: '分歧判定',
  majority: '多數判定',
  draw: '判定平手',
};
