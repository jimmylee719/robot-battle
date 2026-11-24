/**
 * 從一場比賽挑精華片段（純計算，不碰 DOM）：用同一個種子無畫面重跑一次，記下事件，
 * 照「失誤演出 > 擊倒／讀秒絕殺 > 反殺 > 一般重拳」的優先順序挑 1～2 段，總長 10～15 秒。
 * 重跑用的是獨立的比賽物件，不影響正在玩的那一場；結果和原本那場完全一樣（可重播）。
 */
import { createMatch, ROUND_TICKS, ROUNDS, stepMatch, TICK_HZ, type RobotSetup } from '../sim/match';
import type { MisfireEvent } from '../sim/types';

export type ClipKind = 'misfire' | 'buzzer' | 'ko' | 'comeback' | 'heavy';

export interface Clip {
  kind: ClipKind;
  /** 片段從哪個 tick 播到哪個 tick */
  from: number;
  to: number;
  /** 重點那一刻 */
  at: number;
  score: number;
  /** 失誤片段：是哪一次失誤 */
  misfire?: MisfireEvent;
  /** 失誤持續多久（tick） */
  misfireTicks?: number;
  /** 擊倒片段：誰贏、怎麼贏 */
  winner?: number;
  method?: string;
  /** 反殺：贏家最低剩多少血（0..1） */
  low?: number;
  /** 重拳片段：誰打誰、多少傷害 */
  attacker?: number;
  damage?: number;
}

export interface Highlights {
  clips: Clip[];
  /** 比賽結束時的 tick（片段不會超過結束後的倒地畫面） */
  last: number;
  winner: number;
  method: string | null;
}

const MIN_TOTAL = 10 * TICK_HZ;
const MAX_TOTAL = 15 * TICK_HZ;
/** 留 1 秒給片尾，影片才不會超過 15 秒太多（失誤片段會放慢一點點） */
const BUDGET = 13 * TICK_HZ;

export function pickHighlights(seed: number, setups: [RobotSetup, RobotSetup]): Highlights {
  const m = createMatch(seed, setups);
  const cands: Clip[] = [];
  // 失誤：持續了多久（聽錯：還在聽錯；固定毛病：還在用同一條規則而且還和正確理解不同）
  const open: ({ e: MisfireEvent; rule: number; clip: Clip } | null)[] = [null, null];
  const lowest = [1, 1];
  let fightStart = 0;
  let endTick = -1;
  let guard = 0;
  while (!m.done && guard++ < 20000) {
    stepMatch(m);
    if (m.phase === 'fight' && fightStart === 0) fightStart = m.tick;
    for (const side of [0, 1]) {
      const o = open[side];
      if (!o) continue;
      const brain = m.brains[side];
      const going = o.e.kind === 'mishear' ? m.robots[side].fumbling : brain.active === o.rule && brain.quirkDiff;
      if (going && m.phase === 'fight') o.clip.misfireTicks!++;
      else open[side] = null;
    }
    m.robots.forEach((r, i) => {
      if (m.phase === 'fight') lowest[i] = Math.min(lowest[i], r.hp / r.spec.maxHp);
    });
    for (const e of m.events) {
      if (e.type === 'misfire' && m.phase === 'fight') {
        const base = e.kind === 'slow' ? 60 : e.kind === 'mishear' ? 110 : 125;
        const clip: Clip = { kind: 'misfire', from: 0, to: 0, at: e.tick, score: base, misfire: e, misfireTicks: e.kind === 'slow' ? 0 : 1 };
        cands.push(clip);
        if (e.kind !== 'slow') open[e.robot] = { e, rule: m.brains[e.robot].active, clip };
      } else if (e.type === 'hit' && !e.blocked && (e.kind === 'heavy' || e.counter)) {
        cands.push({ kind: 'heavy', from: 0, to: 0, at: m.tick, score: 30 + e.damage + (e.counter ? 10 : 0), attacker: e.attacker, damage: e.damage });
      } else if (e.type === 'end') {
        endTick = m.tick;
        if (e.method === 'KO' || e.method === 'TKO') {
          const loser = 1 - e.winner;
          // 讀秒絕殺：最後一回合的最後 10 秒；反殺：贏家曾經只剩三成血以下，而且當時血比對手少
          const buzzer = m.round === ROUNDS && m.roundTicks >= ROUND_TICKS - 10 * TICK_HZ;
          const comeback = e.winner >= 0 && lowest[e.winner] < 0.3 && lowest[loser] > lowest[e.winner];
          cands.push({
            kind: buzzer ? 'buzzer' : comeback ? 'comeback' : 'ko',
            from: 0,
            to: 0,
            at: m.tick,
            score: buzzer ? 100 : comeback ? 92 : 85,
            winner: e.winner,
            method: e.method,
            low: lowest[e.winner],
          });
        }
      }
    }
  }
  if (endTick < 0) endTick = m.tick;
  const last = Math.min(m.tick, endTick + 100);

  // 每個候選的時間窗
  for (const c of cands) {
    if (c.kind === 'misfire') {
      c.score += Math.min(300, c.misfireTicks ?? 0) / 10;
      c.from = c.at - 75;
      c.to = c.at + Math.max(150, Math.min(c.misfireTicks ?? 0, 300)) + 30;
    } else if (c.kind === 'heavy') {
      c.from = c.at - 120;
      c.to = c.at + 75;
    } else {
      // 擊倒：前面 4 秒鋪陳，後面接倒地
      c.from = c.at - 240;
      c.to = c.at + 95;
    }
    c.from = Math.max(fightStart, c.from);
    c.to = Math.min(last, c.to);
  }

  // 挑：分數最高的先放，第二段不能和第一段重疊，總長不超過預算
  cands.sort((a, b) => b.score - a.score || a.at - b.at);
  const clips: Clip[] = [];
  let total = 0;
  for (const c of cands) {
    if (clips.length >= 2) break;
    const len = c.to - c.from;
    if (clips.some((k) => c.from < k.to + 30 && c.to > k.from - 30)) continue;
    if (clips.length && total + len > BUDGET) continue;
    // 第二段：同一類的失誤只要一次就夠
    if (clips.length && c.kind === 'misfire' && clips[0].kind === 'misfire' && c.misfire!.robot === clips[0].misfire!.robot && c.misfire!.kind === clips[0].misfire!.kind) continue;
    clips.push({ ...c });
    total += len;
    if (total >= MIN_TOTAL) break;
  }
  // 太短：把片段往前後補到 10 秒（不超過比賽範圍）
  if (clips.length && total < MIN_TOTAL) {
    clips.sort((a, b) => a.from - b.from);
    let need = MIN_TOTAL - total;
    for (const c of clips) {
      const grow = Math.ceil(need / 2);
      const before = c.from;
      c.from = Math.max(fightStart, c.from - grow);
      need -= before - c.from;
    }
    for (const c of clips.slice().reverse()) {
      if (need <= 0) break;
      const after = c.to;
      c.to = Math.min(last, c.to + need);
      need -= c.to - after;
    }
  }
  // 太長：從後面切
  clips.sort((a, b) => a.from - b.from);
  total = clips.reduce((n, c) => n + c.to - c.from, 0);
  if (total > MAX_TOTAL) clips[clips.length - 1].to -= total - MAX_TOTAL;
  // 片段補長之後可能重疊：後一段從前一段結束的地方接著播
  for (let i = 1; i < clips.length; i++) if (clips[i].from < clips[i - 1].to) clips[i].from = clips[i - 1].to;
  return { clips, last, winner: m.winner ?? -1, method: m.method };
}
