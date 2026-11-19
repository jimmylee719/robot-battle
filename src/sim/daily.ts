/**
 * 每日挑戰：同一天，全世界的玩家打同一台對手、用同一個種子。
 * 不用伺服器：對手和種子都從「第幾天」算出來（純函式）。今天是第幾天由畫面層給，這裡不讀時間。
 * 計分鼓勵「用最少的額度打贏」：省下來的額度、剩下的血量、剩下的時間都算分。
 */
import { Rng } from '../core/rng';
import { randomBot } from './camp';
import { BUDGET, totalCost } from './gear';
import { randomLook } from './look';
import { MATCH_TICKS, TICK_HZ, type Match, type RobotSetup } from './match';

export interface Daily {
  day: number;
  seed: number;
  foe: RobotSetup;
}

const TITLES = ['鐵砧', '暴雷', '冷鋒', '黑箱', '碎骨', '夜班', '過熱', '零件王', '斷線', '老闆', '加班', '回音', '短路', '壓路機'];

/** 第 day 天（從 1970-01-01 UTC 算起）的挑戰 */
export function dailyFor(day: number): Daily {
  const base = (Math.imul(day, 2654435761) ^ 0x5bd1e995) >>> 0;
  const rng = new Rng(base);
  // 挑一台把額度花得差不多的：太便宜的對手沒有挑戰性
  let foe = randomBot(base, '');
  for (let i = 1; i < 40 && (totalCost(foe.gear, foe.brain, foe.deck) < 880 || foe.deck.length < 2); i++) foe = randomBot((base + i * 7919) >>> 0, '');
  const title = TITLES[rng.int(TITLES.length)];
  foe = {
    ...foe,
    name: `DAILY-${String(day % 1000).padStart(3, '0')} ${title}`,
    temper: { drive: 0.25 + rng.next() * 0.5, nerve: 0.25 + rng.next() * 0.5, grip: 0.25 + rng.next() * 0.5 },
    look: randomLook(() => rng.next()),
  };
  return { day, seed: (base ^ 0x9e3779b9) >>> 0, foe };
}

export interface DailyScore {
  total: number;
  /** 打贏的基本分、省下的額度、剩下的血、剩下的時間 */
  win: number;
  thrift: number;
  health: number;
  speed: number;
}

/** 這一場的分數。沒打贏就是 0 分。 */
export function dailyScore(m: Match, player: RobotSetup): DailyScore {
  if (m.winner !== 0) return { total: 0, win: 0, thrift: 0, health: 0, speed: 0 };
  const me = m.robots[0];
  const win = 400;
  const thrift = Math.max(0, BUDGET - totalCost(player.gear, player.brain, player.deck, player.model ?? null));
  const health = Math.round((me.hp / me.spec.maxHp) * 300);
  const speed = Math.round((Math.max(0, MATCH_TICKS - m.fightTicks) / TICK_HZ) * 5);
  return { total: win + thrift + health + speed, win, thrift, health, speed };
}
