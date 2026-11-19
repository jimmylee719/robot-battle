/**
 * 平衡基準測試（開發用，不會被打包進遊戲）。
 * 用法：npm run dev 之後，在瀏覽器主控台執行
 *   (await import('/src/dev/bench.ts')).runBench()
 * 全部是無畫面對戰，同樣的程式碼一定得到同樣的數字。
 */
import { BRAINS, CARD_LIST, type BrainId } from '../sim/cards';
import { randomBot, runToEnd } from '../sim/camp';
import { withinBudget } from '../sim/gear';
import { createMatch, matchHash, type RobotSetup } from '../sim/match';
import { LADDER } from '../sim/roster';
import type { Loadout } from '../sim/types';

const STYLES = ['boxing', 'brawler', 'taichi', 'outfighter'] as const;
type Style = (typeof STYLES)[number];

/** 每種流派的常見搭配：買得起就升級的武器、照順序插的卡 */
const EXTRA: Record<Style, string[]> = {
  boxing: ['read_heavy', 'punish', 'smell_blood'],
  brawler: ['haymaker', 'smell_blood', 'cage_press'],
  taichi: ['zen', 'punish', 'read_heavy'],
  outfighter: ['hit_and_run', 'punish', 'chase'],
};
const WEAPON: Record<Style, Loadout['weapon']> = { boxing: 'spear', brawler: 'hammer', taichi: 'hammer', outfighter: 'fists' };
const STD: Loadout = { weapon: 'fists', armor: 'light', thruster: 'standard' };
const STOCK: BrainId[] = ['potato', 'autofill', 'parrot', 'chatter', 'nerd', 'mama'];

function pool(): RobotSetup[] {
  return [...LADDER.slice(1).map((o) => o.setup), randomBot(11, 'r1'), randomBot(29, 'r2'), randomBot(47, 'r3')];
}

/** p 對一組對手各打 n 場的勝率（百分比） */
function rate(p: RobotSetup, foes: RobotSetup[], n: number): number {
  let wins = 0;
  let count = 0;
  for (const foe of foes)
    for (let seed = 1; seed <= n; seed++) {
      count++;
      if (runToEnd(createMatch(seed, [p, foe])).winner === 0) wins++;
    }
  return Math.round((wins / count) * 100);
}

function bot(deck: string[], brain: BrainId = 'chatter', gear: Loadout = STD): RobotSetup {
  return { name: 'bench', gear, brain, deck };
}

export interface BenchReport {
  /** 花錢買大腦還是買身體：每顆大腦把剩下的預算照同一套順序花在身體上 */
  brains: Record<string, string>;
  /** 流派互打（只插流派卡） */
  styles: Record<string, string>;
  /** 只插流派卡時對對手池的勝率 */
  cardBase: Record<string, number>;
  /** 每張卡加進去之後勝率多（少）幾個百分點 */
  cards: Record<string, string>;
  /** 渦輪推進器帶來的勝率變化 */
  turbo: string;
  /** 用入門卡組打五個對手 */
  ladder: Record<string, string>;
  deterministic: boolean;
}

export function runBench(n = 40): BenchReport {
  const foes = pool();
  const out: BenchReport = { brains: {}, styles: {}, cardBase: {}, cards: {}, turbo: '', ladder: {}, deterministic: true };

  for (const st of STYLES) {
    const row: string[] = [];
    for (const brain of STOCK) {
      let gear: Loadout = { ...STD };
      const upgrades: Partial<Loadout>[] = [{ armor: 'heavy' }, { weapon: WEAPON[st] }, { thruster: 'turbo' }];
      for (const up of upgrades) {
        const next = { ...gear, ...up };
        if (withinBudget(next, brain)) gear = next;
      }
      const deck = [st, ...EXTRA[st]].slice(0, Math.min(BRAINS[brain].slots, 4));
      row.push(`${brain.slice(0, 4)} ${rate(bot(deck, brain, gear), foes, n)}%`);
    }
    out.brains[st] = row.join(' | ');
  }

  for (let i = 0; i < STYLES.length; i++)
    for (let j = i + 1; j < STYLES.length; j++)
      out.styles[`${STYLES[i]} v ${STYLES[j]}`] = `${rate(bot([STYLES[i]]), [bot([STYLES[j]])], 100)}%`;

  for (const st of STYLES) out.cardBase[st] = rate(bot([st]), foes, n);
  const delta = (st: Style, p: RobotSetup): string => {
    const d = rate(p, foes, n) - out.cardBase[st];
    return `${st.slice(0, 3)}${d >= 0 ? '+' : ''}${d}`;
  };
  for (const card of CARD_LIST)
    if (card.kind !== 'style') out.cards[card.id] = STYLES.map((st) => delta(st, bot([st, card.id]))).join(' ');
  out.turbo = STYLES.map((st) => delta(st, bot([st], 'chatter', { ...STD, thruster: 'turbo' }))).join(' ');

  const starters: Record<string, string[]> = {
    boxing: ['boxing', 'slip_counter', 'shell_up'],
    brawler: ['brawler', 'jab_jab'],
    taichi: ['taichi', 'slip_counter'],
  };
  for (const k of Object.keys(starters))
    out.ladder[k] = LADDER.map((o) => `${o.id} ${rate(bot(starters[k], 'parrot'), [o.setup], 80)}%`).join('  ');

  const hash = (s: number): number => matchHash(runToEnd(createMatch(s, [randomBot(s * 3, 'a'), randomBot(s * 5 + 1, 'b')])));
  for (let s = 1; s <= 10; s++) if (hash(s) !== hash(s)) out.deterministic = false;
  return out;
}
