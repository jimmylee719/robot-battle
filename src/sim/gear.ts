/**
 * 裝備與預算。所有東西花同一筆預算，所以聰明的大腦 = 比較弱的身體。
 * 金額單位和大腦價格沿用 Godot 版（scripts/data/parts.gd）；網頁版只有三個零件槽。
 */
import type { BrainId } from './cards';
import type { ModelSnapshot } from './model';
import type { AttackSpec, Loadout, RobotSpec } from './types';

export const BUDGET = 900;

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
    jab: { windup: 7, recover: 13, reach: 24, arc: 0.7, damage: 5, poise: 12, knockback: 0.5, stun: 8, lunge: 2 },
    heavy: { windup: 22, recover: 30, reach: 27, arc: 0.6, damage: 12, poise: 42, knockback: 2.2, stun: 18, lunge: 5 },
  },
  spear: {
    id: 'spear',
    name: '長矛',
    cost: 180,
    text: '打得很遠，對手還沒碰到你就先中。出手慢、收招慢、每一下都比較輕。',
    jab: { windup: 10, recover: 18, reach: 30, arc: 0.45, damage: 4, poise: 9, knockback: 0.8, stun: 7, lunge: 2 },
    heavy: { windup: 25, recover: 34, reach: 33, arc: 0.4, damage: 10, poise: 36, knockback: 2.6, stun: 18, lunge: 5 },
  },
  hammer: {
    id: 'hammer',
    name: '大錘',
    cost: 250,
    text: '每一下都很重，重擊幾乎一定把人打倒。又慢又笨，揮空就是大破綻。',
    jab: { windup: 10, recover: 16, reach: 24, arc: 0.7, damage: 7, poise: 18, knockback: 0.8, stun: 10, lunge: 2 },
    heavy: { windup: 28, recover: 34, reach: 27, arc: 0.7, damage: 20, poise: 65, knockback: 3.4, stun: 24, lunge: 6 },
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
  heavy: {
    id: 'heavy',
    name: '重型骨架',
    cost: 350,
    text: '血多 20%、站得穩、不容易被打飛。走得慢 16%。',
    maxHp: 180,
    maxPoise: 120,
    damageTaken: 1,
    knockbackTaken: 0.8,
    speed: 0.84,
  },
};

export const THRUSTERS: Record<Loadout['thruster'], Thruster> = {
  standard: {
    id: 'standard',
    name: '標準推進器',
    cost: 120,
    text: '衝刺一次要等 1.7 秒才能再衝。',
    dashSpeed: 2.2,
    dashTicks: 10,
    dashCooldown: 100,
    speed: 1,
  },
  turbo: {
    id: 'turbo',
    name: '渦輪推進器',
    cost: 180,
    text: '衝得更遠，冷卻只要 0.9 秒，平常也走得快一點。',
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

export function totalCost(gear: Loadout, brain: BrainId, model: ModelSnapshot | null = null): number {
  return WEAPONS[gear.weapon].cost + ARMORS[gear.armor].cost + THRUSTERS[gear.thruster].cost + brainCost(brain, model);
}

export function withinBudget(gear: Loadout, brain: BrainId, model: ModelSnapshot | null = null): boolean {
  return totalCost(gear, brain, model) <= BUDGET;
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
    maxHp: a.maxHp,
    maxPoise: a.maxPoise,
    walkSpeed: BASE_WALK * a.speed * t.speed,
    turnSpeed: 0.12,
    radius: 10,
    damageTaken: a.damageTaken,
    knockbackTaken: a.knockbackTaken,
    heavyArmor: false,
    parry: false,
    dashSpeed: t.dashSpeed,
    dashTicks: t.dashTicks,
    dashCooldown: t.dashCooldown,
    jab: { ...w.jab },
    heavy: { ...w.heavy },
  };
}
