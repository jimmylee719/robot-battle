/**
 * 一鍵配法：選一張流派卡，自動湊出一整台適合這個流派的機器人（骨架、裝甲厚度、武器、推進器、大腦、其他卡）。
 * 純邏輯：只用玩家擁有的卡、不超過出場額度。改裝廠用；不影響戰鬥規則，所以不用加分享 VERSION。
 * 每個流派的裝備和大腦是無畫面搜尋挑的（武器固定照流派的主題，其他照勝率；相撲刻意留重骨架）。
 */
import { BRAINS, CARDS, type BrainId } from './cards';
import { ARMORS, totalCost } from './gear';
import type { Loadout } from './types';

export interface Preset {
  gear: Loadout;
  /** 額度夠時用的大腦 */
  brain: BrainId;
  /** 其他卡的優先順序（玩家有的才會插） */
  cards: string[];
  /** 一句話：這套是什麼打法 */
  blurb: string;
}

const STRIKER = ['read_heavy', 'punish', 'jab_jab', 'smell_blood', 'slip_counter', 'shell_up', 'second_wind', 'zen'];
const OUTBOX = ['hit_and_run', 'slip_counter', 'jab_jab', 'punish', 'off_the_wall', 'read_heavy', 'zen'];
const PRESSURE = ['cage_press', 'smell_blood', 'blitz', 'never_back', 'haymaker', 'chase', 'read_heavy', 'shell_up'];
const GRAPPLE = ['chase', 'cage_press', 'read_heavy', 'shell_up', 'smell_blood', 'punish', 'second_wind'];
const COUNTER = ['read_heavy', 'punish', 'shell_up', 'second_wind', 'zen', 'slip_counter', 'off_the_wall'];

const g = (armor: Loadout['armor'], plate: number, weapon: Loadout['weapon'], thruster: Loadout['thruster']): Loadout => ({ armor, plate, weapon, thruster });

export const PRESETS: Record<string, Preset> = {
  boxing: { gear: g('medium', 5, 'fists', 'turbo'), brain: 'chatter', cards: STRIKER, blurb: '擋重拳、抓破綻，標準拳擊手' },
  outfighter: { gear: g('heavy', 15, 'spear', 'standard'), brain: 'parrot', cards: OUTBOX, blurb: '長矛撐開距離，打了就跑' },
  brawler: { gear: g('medium', 5, 'hammer', 'turbo'), brain: 'autofill', cards: PRESSURE, blurb: '掄重錘，一路往前砸' },
  taichi: { gear: g('heavy', 15, 'fists', 'standard'), brain: 'nerd', cards: COUNTER, blurb: '站穩等對手出錯' },
  karate: { gear: g('medium', 5, 'fists', 'turbo'), brain: 'nerd', cards: STRIKER, blurb: '保持距離，一擊進出' },
  taekwondo: { gear: g('medium', 5, 'fists', 'turbo'), brain: 'nerd', cards: OUTBOX, blurb: '輕快長腿，遠距離踢' },
  muaythai: { gear: g('medium', 5, 'fists', 'standard'), brain: 'parrot', cards: PRESSURE, blurb: '膝肘掃踢，貼著打' },
  kickboxing: { gear: g('medium', 5, 'fists', 'turbo'), brain: 'chatter', cards: STRIKER, blurb: '拳腳組合，穩穩打' },
  wingchun: { gear: g('medium', 5, 'fists', 'turbo'), brain: 'parrot', cards: COUNTER, blurb: '近身連打、截擊' },
  judo: { gear: g('medium', 15, 'fists', 'standard'), brain: 'chatter', cards: GRAPPLE, blurb: '貼近抓了就摔' },
  wrestling: { gear: g('medium', 15, 'fists', 'turbo'), brain: 'chatter', cards: GRAPPLE, blurb: '衝進去抱腿摔' },
  bjj: { gear: g('heavy', 15, 'fists', 'turbo'), brain: 'chatter', cards: GRAPPLE, blurb: '等你出手，抓住就摔' },
  aikido: { gear: g('medium', 25, 'fists', 'turbo'), brain: 'nerd', cards: COUNTER, blurb: '借力使力，化解再摔' },
  sumo: { gear: g('heavy', 25, 'fists', 'standard'), brain: 'parrot', cards: PRESSURE, blurb: '超重量級，推出場邊' },
  capoeira: { gear: g('medium', 5, 'fists', 'turbo'), brain: 'nerd', cards: OUTBOX, blurb: '轉圈閃躲、旋踢' },
  jkd: { gear: g('medium', 5, 'fists', 'standard'), brain: 'nerd', cards: STRIKER, blurb: '截擊、最短路徑' },
  kravmaga: { gear: g('medium', 5, 'fists', 'turbo'), brain: 'chatter', cards: PRESSURE, blurb: '被打就反撲' },
  sambo: { gear: g('medium', 5, 'fists', 'standard'), brain: 'parrot', cards: GRAPPLE, blurb: '打摔並用' },
  savate: { gear: g('medium', 5, 'fists', 'turbo'), brain: 'chatter', cards: STRIKER, blurb: '法式踢腿，遠距離' },
  lethwei: { gear: g('medium', 5, 'fists', 'turbo'), brain: 'nerd', cards: PRESSURE, blurb: '頭槌硬碰硬' },
  kyokushin: { gear: g('medium', 5, 'fists', 'turbo'), brain: 'parrot', cards: PRESSURE, blurb: '站著互毆不退' },
  sanda: { gear: g('medium', 5, 'fists', 'turbo'), brain: 'nerd', cards: GRAPPLE, blurb: '踢打接摔' },
};

/** 大腦從貴到便宜試：先求卡槽和反應，湊不進額度才往下換 */
const BRAIN_ORDER: BrainId[] = ['nerd', 'chatter', 'parrot', 'autofill', 'potato'];

export interface Built {
  gear: Loadout;
  brain: BrainId;
  deck: string[];
}

/** 用流派的優先順序把卡槽塞滿（只塞有的、塞得下額度的） */
function fill(style: string, list: readonly string[], owned: readonly string[], gear: Loadout, brain: BrainId, cap: number): string[] {
  const deck = [style];
  for (const id of list) {
    if (deck.length >= BRAINS[brain].slots) break;
    if (!owned.includes(id) || !CARDS[id] || deck.includes(id)) continue;
    if (totalCost(gear, brain, [...deck, id]) > cap) continue;
    deck.push(id);
  }
  return deck;
}

/** 一步一步把裝備換便宜：裝甲變薄 → 武器換回拳 → 推進器換回標準 → 骨架換輕 */
function cheaper(gear: Loadout): Loadout | null {
  const def = ARMORS[gear.armor].plate;
  const plate = gear.plate ?? def;
  if (plate > 0) return { ...gear, plate: Math.max(0, plate - 10) };
  if (gear.weapon !== 'fists') return { ...gear, weapon: 'fists' };
  if (gear.thruster !== 'standard') return { ...gear, thruster: 'standard' };
  if (gear.armor !== 'light') return { ...gear, armor: 'light', plate: 0 };
  return null;
}

/**
 * 選一張流派卡就湊好一整台：裝備和大腦照預設表，再照優先順序把有的卡塞進卡槽；
 * 額度不夠（生涯的低級別有上限）：先在 Parrot 以上的大腦裡挑、把裝備一步步換便宜；還是不夠才用更便宜的大腦。
 */
export function buildFor(style: string, owned: readonly string[], cap: number): Built {
  const p = PRESETS[style] ?? PRESETS.boxing;
  const start: Loadout = { ...p.gear, plate: Math.min(p.gear.plate ?? 0, ARMORS[p.gear.armor].maxPlate) };
  const order = [p.brain, ...BRAIN_ORDER.filter((b) => b !== p.brain && BRAINS[b].slots < BRAINS[p.brain].slots)];
  // 第一輪：大腦最低到 Parrot（四個卡槽），寧可先把裝備換便宜；第二輪才用更便宜的大腦
  for (const minSlots of [Math.min(4, BRAINS[p.brain].slots), 0]) {
    let gear: Loadout | null = start;
    while (gear) {
      for (const brain of order) {
        if (BRAINS[brain].slots < minSlots || totalCost(gear, brain, [style]) > cap) continue;
        const deck = fill(style, p.cards, owned, gear, brain, cap);
        // 第一輪至少要多插得下一張卡；第二輪放得下就好
        if (deck.length > 1 || minSlots === 0) return { gear, brain, deck };
      }
      gear = cheaper(gear);
    }
  }
  const cheap: Loadout = { weapon: 'fists', armor: 'light', thruster: 'standard', plate: 0 };
  return { gear: cheap, brain: 'potato', deck: totalCost(cheap, 'potato', [style]) <= cap ? [style] : [] };
}
