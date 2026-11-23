/**
 * 訓練營與賽後成長。規則照 Godot 版（scripts/sim/camp.gd）。
 * 訓練營：選一個想練的方向，機器人自己去和三個隨機陪練打三場沒人看的練習賽。
 * 每場照常讓性格漂移，最後訓練營再往選的方向推一把；自訓模型也會從練習賽學到東西
 * （學得比實戰快，但每天有上限）。練習賽不算戰績。
 * 全部是純函式：同樣的輸入和種子一定得到同樣的結果。
 */
import { Rng } from '../core/rng';
import { BRAINS, CARD_LIST, type BrainId } from './cards';
import { ARMORS, BUDGET, fitDeck, THRUSTERS, WEAPONS, withinBudget } from './gear';
import { createMatch, stepMatch, type Match, type RobotSetup } from './match';
import { learn, snapshot, TRAINING_MULT, type LearnResult, type TrainedModel } from './model';
import { learnTemper, pushTemper, type Axis, type Temper } from './temper';
import type { Loadout } from './types';

export const SPARS = 3;

export interface Focus {
  axis: Axis;
  dir: 1 | -1;
  name: string;
  tip: string;
}

export const FOCUS: Focus[] = [
  { axis: 'drive', dir: 1, name: '🔥 壓迫訓練', tip: '更積極：搶著出手，但比較慢才肯防守' },
  { axis: 'drive', dir: -1, name: '🧘 耐心訓練', tip: '更沉著：防守反應快，但出手慢半拍' },
  { axis: 'nerve', dir: 1, name: '🎲 重砲訓練', tip: '更大膽：多出重拳' },
  { axis: 'nerve', dir: -1, name: '🛡 基本功', tip: '更穩健：多用刺拳' },
  { axis: 'grip', dir: 1, name: '🤼 貼身訓練', tip: '更愛黏著打' },
  { axis: 'grip', dir: -1, name: '🦶 步法訓練', tip: '更愛在外圍游走' },
];

function pick<T>(rng: Rng, list: readonly T[]): T {
  return list[rng.int(list.length)];
}

/** 一個在出場額度內的隨機機器人：隨機裝備、現成大腦、一張流派加幾張別的卡。cap 是額度上限（生涯的低級別比較少） */
export function randomBot(seed: number, name: string, cap = BUDGET): RobotSetup {
  const rng = new Rng(seed);
  const brains = (Object.keys(BRAINS) as BrainId[]).filter((b) => b !== 'trained');
  let gear: Loadout;
  let brain: BrainId;
  do {
    gear = {
      weapon: pick(rng, Object.keys(WEAPONS) as Loadout['weapon'][]),
      armor: pick(rng, Object.keys(ARMORS) as Loadout['armor'][]),
      thruster: pick(rng, Object.keys(THRUSTERS) as Loadout['thruster'][]),
    };
    brain = pick(rng, brains);
  } while (!withinBudget(gear, brain, [], null, cap));

  const deck = [pick(rng, CARD_LIST.filter((c) => c.kind === 'style')).id];
  const others = CARD_LIST.filter((c) => c.kind !== 'style');
  const extra = Math.min(BRAINS[brain].slots - 1, rng.int(3));
  while (deck.length < 1 + extra) {
    const id = pick(rng, others).id;
    if (!deck.includes(id)) deck.push(id);
  }
  // 卡也要花額度：放不下的從後面拿掉
  return { name, gear, brain, deck: fitDeck(gear, brain, deck, null, cap) };
}

/** 不看畫面，把一場直接跑完 */
export function runToEnd(m: Match): Match {
  let guard = 0;
  while (!m.done && guard++ < 20000) stepMatch(m);
  return m;
}

export interface Growth {
  model: TrainedModel;
  temper: Temper;
  /** 自訓模型這次的變化（不是自訓模型就沒有變化） */
  learned: LearnResult;
}

/**
 * 一場打完之後，side 那一邊的成長。
 * 性格一定會漂移；模型只有在用自訓模型打的時候才學。
 */
export function growFrom(
  m: Match,
  side: number,
  model: TrainedModel,
  temper: Temper,
  mult = 1,
  xpLeft = Infinity,
): Growth {
  const brain = m.brains[side];
  const trained = brain.program.brain.id === 'trained';
  const learned: LearnResult = trained
    ? learn(model, brain.usage, mult, xpLeft)
    : { model, changes: {}, gained: 0, capped: false };
  return { model: learned.model, temper: learnTemper(temper, brain.notes), learned };
}

export interface SparReport {
  foe: string;
  /** 1 贏、0 平手、-1 輸 */
  result: number;
  ko: boolean;
}

export interface CampReport {
  spars: SparReport[];
  model: TrainedModel;
  temper: Temper;
  /** 整個訓練營下來，模型每個動作的熟練度變化 */
  changes: Record<string, [number, number]>;
  gained: number;
  capped: boolean;
}

/**
 * 跑一次訓練營。me 的 model / temper 欄位會被忽略，改用傳進來的 model 和 temper
 * （每場練習賽都用當下最新的）。xpLeft 是今天訓練營還能給多少經驗。
 */
export function runCamp(
  me: RobotSetup,
  model: TrainedModel,
  temper: Temper,
  focus: Focus,
  seed: number,
  xpLeft: number,
): CampReport {
  const spars: SparReport[] = [];
  const changes: Record<string, [number, number]> = {};
  let gained = 0;
  let capped = false;

  for (let i = 0; i < SPARS; i++) {
    const foe = randomBot((seed + i * 7919) >>> 0, `陪練 ${i + 1} 號`);
    const setup: RobotSetup = { ...me, temper, model: snapshot(model) };
    const m = runToEnd(createMatch((seed ^ (i * 104729)) >>> 0, [setup, foe]));
    const g = growFrom(m, 0, model, temper, TRAINING_MULT, xpLeft - gained);
    for (const key of Object.keys(g.learned.changes)) {
      const [before, after] = g.learned.changes[key];
      changes[key] = [changes[key]?.[0] ?? before, after];
    }
    gained += g.learned.gained;
    capped = capped || g.learned.capped;
    model = g.model;
    temper = g.temper;
    spars.push({
      foe: `${foe.name}（${BRAINS[foe.brain].name}）`,
      result: m.winner === 0 ? 1 : m.winner === 1 ? -1 : 0,
      ko: m.robots.some((r) => r.action === 'ko'),
    });
  }
  return { spars, model, temper: pushTemper(temper, focus.axis, focus.dir), changes, gained, capped };
}
