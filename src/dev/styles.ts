/**
 * 武術流派互打的勝率表（開發工具，不進打包）。改流派卡的數值之後跑一次：
 * `npm run dev` 後在瀏覽器主控台 `(await import('/src/dev/styles.ts')).runStyles()`。
 * 每個流派用同一套裝備和大腦（三種裝備 × 三種大腦 × n 個種子）和其他流派各打一輪。
 * 目標：整體勝率大約 40～60%（貴的流派可以高一點），每個流派都有剋它的對手。
 */
import { createMatch } from '../sim/match';
import { runToEnd } from '../sim/camp';
import { CARD_LIST } from '../sim/cards';
import type { RobotSetup } from '../sim/match';
import type { BrainId } from '../sim/cards';
import type { Loadout } from '../sim/types';

const GEARS: Loadout[] = [
  { weapon: 'fists', armor: 'medium', thruster: 'standard' },
  { weapon: 'spear', armor: 'light', thruster: 'turbo' },
  { weapon: 'hammer', armor: 'light', thruster: 'standard' },
];
const BRAINS: BrainId[] = ['parrot', 'chatter', 'nerd'];

export function runStyles(n = 4): Record<string, string> {
  const styles = CARD_LIST.filter((c) => c.kind === 'style').map((c) => c.id);
  const win: Record<string, number> = {};
  const games: Record<string, number> = {};
  const pair: Record<string, Record<string, number>> = {};
  let seed = 1;
  for (const a of styles)
    for (const b of styles) {
      if (a >= b) continue;
      for (const gear of GEARS)
        for (const brain of BRAINS)
          for (let k = 0; k < n; k++) {
            seed++;
            const sa: RobotSetup = { name: a, gear: { ...gear }, brain, deck: [a] };
            const sb: RobotSetup = { name: b, gear: { ...gear }, brain, deck: [b] };
            const flip = (k & 1) === 1;
            const m = runToEnd(createMatch(seed * 7919, flip ? [sb, sa] : [sa, sb]));
            const wa = m.winner === null || m.winner < 0 ? 0.5 : m.winner === (flip ? 1 : 0) ? 1 : 0;
            win[a] = (win[a] ?? 0) + wa;
            win[b] = (win[b] ?? 0) + 1 - wa;
            games[a] = (games[a] ?? 0) + 1;
            games[b] = (games[b] ?? 0) + 1;
            (pair[a] ??= {})[b] = (pair[a][b] ?? 0) + wa;
            (pair[b] ??= {})[a] = (pair[b][a] ?? 0) + 1 - wa;
          }
    }
  const per = GEARS.length * BRAINS.length * n;
  const out: Record<string, string> = {};
  for (const s of [...styles].sort((x, y) => win[y] / games[y] - win[x] / games[x])) {
    const sorted = Object.entries(pair[s]).sort((x, y) => x[1] - y[1]);
    const price = CARD_LIST.find((c) => c.id === s)!.price;
    out[s] = `${price}點 ${((win[s] / games[s]) * 100).toFixed(0)}%・怕 ${sorted[0][0]} ${((sorted[0][1] / per) * 100).toFixed(0)}%・剋 ${sorted[sorted.length - 1][0]} ${((sorted[sorted.length - 1][1] / per) * 100).toFixed(0)}%`;
  }
  return out;
}
