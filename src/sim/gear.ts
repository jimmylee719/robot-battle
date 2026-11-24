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

/**
 * 骨架：決定量級、能掛多厚的裝甲、馬達和關節伺服有多強。
 * 骨架本身的結構耐久差不多；耐不耐打主要看外面掛多厚的裝甲（見 plate、weightInfo）。
 */
interface Armor extends GearItem {
  /** 骨架本身多重（公斤，不含裝甲、武器、推進器） */
  mass: number;
  /** 要包裝甲的表面積（平方公尺）：骨架越大，同樣厚度的裝甲越重 */
  area: number;
  /** 腿部馬達功率（指數）：走路速度 = √(馬達 ÷ 總重) */
  motor: number;
  /** 關節伺服的額定負重（公斤）：總重超過它，出招、收招、耗能都會變慢、變多 */
  servo: number;
  /** 結構耐久（血量，還要乘上 TUNE.hpScale） */
  maxHp: number;
  /** 裝甲最厚能掛幾毫米 */
  maxPlate: number;
  /** 預設掛幾毫米 */
  plate: number;
  /** 裝甲每毫米多少點額度 */
  platePrice: number;
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
    cost: 120,
    text: '40 公斤，馬達小但身體輕，走得快。裝甲最多 20 mm。',
    mass: 40,
    area: 1.6,
    motor: 74,
    servo: 74,
    maxHp: 145,
    maxPlate: 20,
    plate: 5,
    platePrice: 4,
  },
  medium: {
    id: 'medium',
    name: '中型骨架',
    cost: 165,
    text: '60 公斤，馬達和關節都比較強，掛得動 30 mm 裝甲。',
    mass: 60,
    area: 1.9,
    motor: 114,
    servo: 135,
    maxHp: 143,
    maxPlate: 30,
    plate: 15,
    platePrice: 5,
  },
  heavy: {
    id: 'heavy',
    name: '重型骨架',
    cost: 230,
    text: '85 公斤，最強的馬達和關節，掛得動 40 mm 裝甲；但身體大，同樣厚度的裝甲比較重。',
    mass: 85,
    area: 2.3,
    motor: 158,
    servo: 218,
    maxHp: 141,
    maxPlate: 40,
    plate: 25,
    platePrice: 6,
  },
};

/** 武器和推進器的重量（公斤） */
export const WEAPON_MASS: Record<Loadout['weapon'], number> = { fists: 8, spear: 12, hammer: 20 };
export const THRUSTER_MASS: Record<Loadout['thruster'], number> = { standard: 10, turbo: 12 };
/** 複合裝甲：每平方公尺、每毫米 2 公斤 */
export const PLATE_DENSITY = 2;
/** 裝甲厚度一格 5 毫米 */
export const PLATE_STEP = 5;
/** 防護率 = 厚度 ÷ (厚度 + 這個數)：越厚越擋得住，但效益遞減 */
export const PLATE_HALF = 120;
/** 量重的基準：輕型骨架、活塞拳、標準推進器、5 mm 裝甲 = 74 公斤 */
export const REF_MASS = 74;

/** 這套骨架掛的裝甲有幾毫米（沒寫就是骨架的預設值，超過上限就砍到上限） */
export function plateOf(gear: Loadout): number {
  const a = ARMORS[gear.armor];
  const t = gear.plate ?? a.plate;
  return Math.max(0, Math.min(a.maxPlate, Math.round(t / PLATE_STEP) * PLATE_STEP));
}

export interface WeightInfo {
  /** 總重（公斤）和各部分 */
  mass: number;
  frame: number;
  plate: number;
  plateMm: number;
  weapon: number;
  thruster: number;
  /** 量級名稱 */
  cls: string;
  /** 受傷倍率（1 = 全吃）和防護率 */
  taken: number;
  /** 走路速度倍率（相對於基準 74 公斤的輕型骨架） */
  speed: number;
  /** 出招、收招的時間倍率和耗能倍率（> 1 是比較慢、比較耗） */
  action: number;
  /** 被打退的倍率、平衡值倍率、衝刺速度倍率 */
  knockback: number;
  poise: number;
  dash: number;
}

/**
 * 重量的換算（全部是確定的公式，同樣的配法永遠得到同樣的數字）：
 *  總重 M = 骨架 + 裝甲（表面積 × 厚度 × 2）+ 武器 + 推進器
 *  受傷 = 1 − 厚度 ÷ (厚度 + 120)
 *  走路 = √(馬達 ÷ M)
 *  出招／收招時間、耗能 = (M ÷ 伺服額定)^0.3
 *  被打退 = (74 ÷ M)^0.21、平衡值 = (M ÷ 74)^0.17、衝刺 = (74 ÷ M)^0.15
 */
export function weightInfo(gear: Loadout): WeightInfo {
  const a = ARMORS[gear.armor];
  const plateMm = plateOf(gear);
  const plate = a.area * plateMm * PLATE_DENSITY;
  const weapon = WEAPON_MASS[gear.weapon];
  const thruster = THRUSTER_MASS[gear.thruster];
  const mass = a.mass + plate + weapon + thruster;
  return {
    mass,
    frame: a.mass,
    plate,
    plateMm,
    weapon,
    thruster,
    cls: mass < 90 ? '輕量級' : mass < 150 ? '中量級' : mass < 210 ? '重量級' : '超重量級',
    taken: 1 - plateMm / (plateMm + PLATE_HALF),
    speed: Math.sqrt(a.motor / mass),
    action: Math.pow(mass / a.servo, 0.3),
    knockback: Math.pow(REF_MASS / mass, 0.21),
    poise: Math.pow(mass / REF_MASS, 0.17),
    dash: Math.pow(REF_MASS / mass, 0.15),
  };
}

/** 裝甲花的額度 */
export function plateCost(gear: Loadout): number {
  return plateOf(gear) * ARMORS[gear.armor].platePrice;
}

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

/** 把不認得的零件換成預設的（存檔、分享連結進來的資料不能直接信）；裝甲厚度沒寫或不是數字就用骨架的預設值 */
export function cleanGear(g: Partial<Loadout> | undefined): Loadout {
  const out: Loadout = {
    weapon: g?.weapon && g.weapon in WEAPONS ? g.weapon : DEFAULT_GEAR.weapon,
    armor: g?.armor && g.armor in ARMORS ? g.armor : DEFAULT_GEAR.armor,
    thruster: g?.thruster && g.thruster in THRUSTERS ? g.thruster : DEFAULT_GEAR.thruster,
  };
  const t = typeof g?.plate === 'number' && Number.isFinite(g.plate) ? g.plate : ARMORS[out.armor].plate;
  out.plate = plateOf({ ...out, plate: t });
  return out;
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
    plateCost(gear) +
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
  return `${WEAPONS[gear.weapon].name}・${ARMORS[gear.armor].name}（${plateOf(gear)} mm）・${THRUSTERS[gear.thruster].name}`;
}

const BASE_WALK = 0.6;

/** 裝備 → 機器人的數值（卡牌的影響之後再由 cards.applyMods 疊上去） */
export function buildSpec(name: string, gear: Loadout): RobotSpec {
  const w = WEAPONS[gear.weapon];
  const a = ARMORS[gear.armor];
  const t = THRUSTERS[gear.thruster];
  const wi = weightInfo(gear);
  // 越重出招越慢：蓄力和收招的時間照伺服的負擔放大（預設配法剛好是 1，不變）
  const slow = (k: AttackSpec): AttackSpec => ({
    ...k,
    windup: Math.max(4, Math.round(k.windup * wi.action)),
    recover: Math.max(6, Math.round(k.recover * wi.action)),
  });
  return {
    name,
    loadout: { ...gear, plate: wi.plateMm },
    // 血量整體倍率：控制有多少場撐到裁判判定（UFC 大約一半）
    maxHp: Math.round(a.maxHp * TUNE.hpScale),
    maxPoise: 100 * wi.poise,
    walkSpeed: BASE_WALK * wi.speed * t.speed,
    turnSpeed: 0.12,
    radius: 10,
    damageTaken: wi.taken,
    knockbackTaken: wi.knockback,
    heavyArmor: false,
    parry: false,
    footwork: false,
    guardCrush: false,
    grapple: false,
    dashSpeed: t.dashSpeed * wi.dash,
    dashTicks: t.dashTicks,
    dashCooldown: t.dashCooldown,
    dashEnergy: t.dashEnergy * wi.action,
    maxEnergy: 100,
    energyUse: wi.action,
    jab: slow(w.jab),
    heavy: slow(w.heavy),
  };
}
