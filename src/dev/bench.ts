/**
 * 平衡基準測試（開發用，不會被打包進遊戲）。
 * 用法：npm run dev 之後，在瀏覽器主控台執行
 *   (await import('/src/dev/bench.ts')).runBench()
 * 全部是無畫面對戰，同樣的程式碼一定得到同樣的數字。
 */
import { BRAINS, CARD_LIST, type BrainId } from '../sim/cards';
import { randomBot, runToEnd } from '../sim/camp';
import { fitDeck, totalCost, withinBudget } from '../sim/gear';
import { createMatch, matchHash, type RobotSetup } from '../sim/match';
import { LADDER } from '../sim/roster';
import type { Loadout } from '../sim/types';

// 調數值的工具要改到和對戰邏輯同一份資料，所以從這裡轉出去
export { TUNE } from '../sim/tuning';
export { CARDS } from '../sim/cards';
export { ARMORS, WEAPONS } from '../sim/gear';

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

/** 打一場，回傳贏家（0 / 1 / -1） */
export function playOne(seed: number, a: RobotSetup, b: RobotSetup): number | null {
  return runToEnd(createMatch(seed, [a, b])).winner;
}

/** 把 1000 點花滿的幾種典型配法 */
export const ARCHETYPES: Record<string, RobotSetup> = {
  拳擊重甲: { name: '拳擊重甲', gear: { weapon: 'fists', armor: 'heavy', thruster: 'standard' }, brain: 'chatter', deck: ['boxing', 'read_heavy'] },
  大錘亂鬥: { name: '大錘亂鬥', gear: { weapon: 'hammer', armor: 'medium', thruster: 'standard' }, brain: 'autofill', deck: ['brawler', 'cage_press', 'haymaker'] },
  太極大腦: { name: '太極大腦', gear: { weapon: 'fists', armor: 'light', thruster: 'standard' }, brain: 'mama', deck: ['taichi', 'zen', 'punish', 'read_heavy'] },
  長矛閃躲: { name: '長矛閃躲', gear: { weapon: 'spear', armor: 'light', thruster: 'turbo' }, brain: 'chatter', deck: ['outfighter', 'hit_and_run', 'punish', 'chase'] },
  笨腦硬殼: { name: '笨腦硬殼', gear: { weapon: 'hammer', armor: 'heavy', thruster: 'standard' }, brain: 'potato', deck: ['brawler', 'hothead'] },
  拳擊均衡: { name: '拳擊均衡', gear: { weapon: 'fists', armor: 'medium', thruster: 'standard' }, brain: 'chatter', deck: ['boxing', 'read_heavy', 'punish', 'shell_up'] },
  太極重甲: { name: '太極重甲', gear: { weapon: 'fists', armor: 'heavy', thruster: 'standard' }, brain: 'parrot', deck: ['taichi', 'punish'] },
  閃躲快腦: { name: '閃躲快腦', gear: { weapon: 'fists', armor: 'light', thruster: 'turbo' }, brain: 'nerd', deck: ['outfighter', 'punish', 'overclocked'] },
};

/** 典型配法循環賽（兩邊各當一次紅方，抵銷先後手的差別） */
export function runMeta(n = 20): Record<string, string> {
  const names = Object.keys(ARCHETYPES);
  const out: Record<string, string> = {};
  const win: number[][] = names.map(() => names.map(() => 50));
  for (let i = 0; i < names.length; i++)
    for (let j = i + 1; j < names.length; j++) {
      const a = ARCHETYPES[names[i]];
      const b = ARCHETYPES[names[j]];
      let w = 0;
      for (let s = 1; s <= n; s++) {
        const r1 = runToEnd(createMatch(s, [a, b])).winner;
        const r2 = runToEnd(createMatch(s + 500, [b, a])).winner;
        w += (r1 === 0 ? 1 : r1 === -1 ? 0.5 : 0) + (r2 === 1 ? 1 : r2 === -1 ? 0.5 : 0);
      }
      win[i][j] = Math.round((w / (2 * n)) * 100);
      win[j][i] = 100 - win[i][j];
    }
  names.forEach((name, i) => {
    const others = names.map((_, j) => j).filter((j) => j !== i);
    const avg = Math.round(others.reduce((s, j) => s + win[i][j], 0) / others.length);
    const worst = others.reduce((a, j) => (win[i][j] < win[i][a] ? j : a), others[0]);
    const best = others.reduce((a, j) => (win[i][j] > win[i][a] ? j : a), others[0]);
    const a = ARCHETYPES[name];
    out[name] =
      totalCost(a.gear, a.brain, a.deck) + '點 平均 ' + avg + '%・怕 ' + names[worst] + ' ' + win[i][worst] + '%・剋 ' + names[best] + ' ' + win[i][best] + '%・[' + others.map((j) => win[i][j]).join(' ') + ']';
  });
  return out;
}

/** 循環賽和流派互打離「大家都差不多、互有剋制」有多遠（越小越好） */
export function imbalance(n = 6): { score: number; styles: Record<string, string>; meta: Record<string, string> } {
  const q = runQuick(n);
  let score = 0;
  for (const v of Object.values(q.meta)) {
    const avg = Number(/平均 (\d+)%/.exec(v)![1]);
    score += (avg - 50) * (avg - 50);
    // 一面倒的對戰要罰：超過 75 / 25 之後，越一面倒罰越重（每場對戰兩邊各算一次）
    for (const w of /\[(.*)\]/.exec(v)![1].split(' ').map(Number)) {
      const off = Math.max(0, Math.abs(w - 50) - 25);
      score += off * off * 0.25;
    }
  }
  for (const v of Object.values(q.styles)) {
    const w = parseInt(v, 10);
    const off = Math.max(0, Math.abs(w - 50) - 15);
    score += off * off * 3;
  }
  return { score: Math.round(score), ...q };
}

/** 調數值時用的快速版：只看流派互打和典型配法循環賽 */
export function runQuick(n = 12): { styles: Record<string, string>; meta: Record<string, string> } {
  const styles: Record<string, string> = {};
  for (let i = 0; i < STYLES.length; i++)
    for (let j = i + 1; j < STYLES.length; j++) {
      const a = rate(bot([STYLES[i]]), [bot([STYLES[j]])], 60);
      const b = 100 - rate(bot([STYLES[j]]), [bot([STYLES[i]])], 60);
      styles[STYLES[i] + ' v ' + STYLES[j]] = Math.round((a + b) / 2) + '%';
    }
  return { styles, meta: runMeta(n) };
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
  /** 八種把額度花滿的典型配法互打：平均勝率・最怕誰・最剋誰。沒有任何一種應該全贏。 */
  meta: Record<string, string>;
  /** 超出額度的對手（應該是空的） */
  overBudget: string[];
  deterministic: boolean;
}

export function runBench(n = 40): BenchReport {
  const foes = pool();
  const out: BenchReport = { brains: {}, styles: {}, cardBase: {}, cards: {}, turbo: '', ladder: {}, meta: {}, overBudget: [], deterministic: true };

  for (const st of STYLES) {
    const row: string[] = [];
    for (const brain of STOCK) {
      let gear: Loadout = { ...STD };
      const upgrades: Partial<Loadout>[] = [{ armor: 'heavy' }, { weapon: WEAPON[st] }, { thruster: 'turbo' }];
      // 先留流派的額度，再照順序升級身體，剩下的才買卡
      for (const up of upgrades) {
        const next = { ...gear, ...up };
        if (withinBudget(next, brain, [st])) gear = next;
      }
      const deck = fitDeck(gear, brain, [st, ...EXTRA[st]].slice(0, Math.min(BRAINS[brain].slots, 4)));
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

  out.meta = runMeta(Math.max(10, n));
  for (const o of [...LADDER.map((l) => l.setup), ...Object.values(ARCHETYPES)])
    if (!withinBudget(o.gear, o.brain, o.deck)) out.overBudget.push(o.name + ' ' + totalCost(o.gear, o.brain, o.deck));

  const hash = (s: number): number => matchHash(runToEnd(createMatch(s, [randomBot(s * 3, 'a'), randomBot(s * 5 + 1, 'b')])));
  for (let s = 1; s <= 10; s++) if (hash(s) !== hash(s)) out.deterministic = false;
  return out;
}
