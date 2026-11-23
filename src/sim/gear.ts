/**
 * 裝備與出場額度。每台機器人都只有 1000 點額度，
 * 大腦、骨架、武器、推進器、流派、每一張卡都要花：聰明的大腦 = 比較弱的身體或比較少的卡。
 * 大腦和零件的價格沿用 Godot 版（scripts/data/parts.gd）；網頁版只有三個零件槽。
 */
import { TUNE } from './tuning';
import { CARDS, type BrainId } from './cards';
import type { ModelSnapshot } from './model';
import type { AttackSpec, Loadout, RobotSpec } from './types';

export const BUDGET = 1000;

export interface GearItem {
  id: string;
  name: string;
  cost: number;
  /** 一句話說明優點和缺點 */
  text: string;
}

interface Weapon extends GearItem {
  jab: AttackSpec;
  heavy: AttackSpec;
}

interface Armor extends GearItem {
  maxHp: number;
  maxPoise: number;
  damageTaken: number;
  knockbackTaken: number;
  speed: number;
}

interface Thruster extends GearItem {
  dashEnergy: number;
  dashSpeed: number;
  dashTicks: number;
  dashCooldown: number;
  speed: number;
}

export const WEAPONS: Record<Loadout['weapon'], Weapon> = {
  fists: {
    id: 'fists',
    name: '活塞拳',
    cost: 100,
    text: '出手快、收招快，什麼都能做，沒有特別強的地方。',
    jab: { windup: 7, recover: 13, reach: 24, arc: 0.7, damage: 5, poise: 12, knockback: 0.5, stun: 8, lunge: 2, energy: 5 },
    heavy: { windup: 22, recover: 30, reach: 27, arc: 0.6, damage: 12, poise: 42, knockback: 2.2, stun: 18, lunge: 5, energy: 14 },
  },
  spear: {
    id: 'spear',
    name: '長矛',
    cost: 180,
    text: '打得很遠，對手還沒碰到你就先中。出手慢、收招慢、每一下都比較輕。',
    jab: { windup: 9, recover: 13, reach: 30, arc: 0.45, damage: 5.15, poise: 12.22, knockback: 0.8, stun: 7, lunge: 2, energy: 6 },
    heavy: { windup: 24, recover: 32, reach: 33, arc: 0.4, damage: 14.78, poise: 38, knockback: 2.6, stun: 18, lunge: 5, energy: 15 },
  },
  hammer: {
    id: 'hammer',
    name: '大錘',
    cost: 280,
    text: '每一下都很重，重擊幾乎一定把人打倒。又慢又笨、很耗能，揮空就是大破綻。',
    jab: { windup: 10, recover: 16, reach: 24, arc: 0.7, damage: 7, poise: 18, knockback: 0.8, stun: 10, lunge: 2, energy: 8 },
    heavy: { windup: 26, recover: 34, reach: 27, arc: 0.7, damage: 20.82, poise: 65, knockback: 3.4, stun: 24, lunge: 6, energy: 22 },
  },
};

export const ARMORS: Record<Loadout['armor'], Armor> = {
  light: {
    id: 'light',
    name: '輕型骨架',
    cost: 140,
    text: '走得快。不耐打。',
    maxHp: 150,
    maxPoise: 100,
    damageTaken: 1,
    knockbackTaken: 1,
    speed: 1,
  },
  medium: {
    id: 'medium',
    name: '中型骨架',
    cost: 240,
    text: '血多 6%、比較站得穩。走得慢 8%。',
    maxHp: 160,
    maxPoise: 110,
    damageTaken: 1,
    knockbackTaken: 0.9,
    speed: 0.92,
  },
  heavy: {
    id: 'heavy',
    name: '重型骨架',
    cost: 380,
    text: '血多 20%、站得穩、不容易被打飛。走得慢 16%。',
    maxHp: 170,
    maxPoise: 120,
    damageTaken: 1,
    knockbackTaken: 0.8,
    speed: 0.85,
  },
};

export const THRUSTERS: Record<Loadout['thruster'], Thruster> = {
  standard: {
    id: 'standard',
    name: '標準推進器',
    cost: 120,
    text: '衝刺一次要等 1.7 秒才能再衝。',
    dashEnergy: 12,
    dashSpeed: 2.2,
    dashTicks: 10,
    dashCooldown: 100,
    speed: 1,
  },
  turbo: {
    id: 'turbo',
    name: '渦輪推進器',
    cost: 180,
    text: '衝得更遠、比較省電，冷卻只要 0.9 秒，平常也走得快一點。',
    dashEnergy: 9,
    dashSpeed: 2.6,
    dashTicks: 10,
    dashCooldown: 55,
    speed: 1.08,
  },
};

/** 大腦價格（照 Godot 版） */
/** 自訓模型的價格跟著熟練度走（model.costOf），這裡是完全沒練過的價格 */
export const BRAIN_COST: Record<BrainId, number> = { potato: 50, autofill: 120, parrot: 190, chatter: 260, nerd: 330, mama: 400, trained: 150 };

export const DEFAULT_GEAR: Loadout = { weapon: 'fists', armor: 'light', thruster: 'standard' };

/** 把不認得的零件換成預設的（存檔、分享連結進來的資料不能直接信） */
export function cleanGear(g: Partial<Loadout> | undefined): Loadout {
  return {
    weapon: g?.weapon && g.weapon in WEAPONS ? g.weapon : DEFAULT_GEAR.weapon,
    armor: g?.armor && g.armor in ARMORS ? g.armor : DEFAULT_GEAR.armor,
    thruster: g?.thruster && g.thruster in THRUSTERS ? g.thruster : DEFAULT_GEAR.thruster,
  };
}

export function brainCost(brain: BrainId, model: ModelSnapshot | null = null): number {
  return brain === 'trained' && model ? model.cost : BRAIN_COST[brain];
}

/** 卡組花的額度（流派和每張卡各有價格） */
export function deckCost(deck: readonly string[]): number {
  let sum = 0;
  for (const id of deck) sum += CARDS[id]?.price ?? 0;
  return sum;
}

export function totalCost(gear: Loadout, brain: BrainId, deck: readonly string[], model: ModelSnapshot | null = null): number {
  return (
    WEAPONS[gear.weapon].cost +
    ARMORS[gear.armor].cost +
    THRUSTERS[gear.thruster].cost +
    brainCost(brain, model) +
    deckCost(deck)
  );
}

export function withinBudget(gear: Loadout, brain: BrainId, deck: readonly string[], model: ModelSnapshot | null = null, cap = BUDGET): boolean {
  return totalCost(gear, brain, deck, model) <= cap;
}

/** 超出額度就從卡組最後面開始拿掉卡，直到放得下（放不下就全部拿掉） */
export function fitDeck(gear: Loadout, brain: BrainId, deck: readonly string[], model: ModelSnapshot | null = null, cap = BUDGET): string[] {
  const out = [...deck];
  while (out.length > 0 && !withinBudget(gear, brain, out, model, cap)) out.pop();
  return out;
}

export function gearText(gear: Loadout): string {
  return `${WEAPONS[gear.weapon].name}・${ARMORS[gear.armor].name}・${THRUSTERS[gear.thruster].name}`;
}

const BASE_WALK = 0.6;

/** 裝備 → 機器人的數值（卡牌的影響之後再由 cards.applyMods 疊上去） */
export function buildSpec(name: string, gear: Loadout): RobotSpec {
  const w = WEAPONS[gear.weapon];
  const a = ARMORS[gear.armor];
  const t = THRUSTERS[gear.thruster];
  return {
    name,
    loadout: { ...gear },
    // 血量整體倍率：控制有多少場撐到裁判判定（UFC 大約一半）
    maxHp: Math.round(a.maxHp * TUNE.hpScale),
    maxPoise: a.maxPoise,
    walkSpeed: BASE_WALK * a.speed * t.speed,
    turnSpeed: 0.12,
    radius: 10,
    damageTaken: a.damageTaken,
    knockbackTaken: a.knockbackTaken,
    heavyArmor: false,
    parry: false,
    footwork: false,
    guardCrush: false,
    dashSpeed: t.dashSpeed,
    dashTicks: t.dashTicks,
    dashCooldown: t.dashCooldown,
    dashEnergy: t.dashEnergy,
    maxEnergy: 100,
    energyUse: 1,
    jab: { ...w.jab },
    heavy: { ...w.heavy },
  };
}
