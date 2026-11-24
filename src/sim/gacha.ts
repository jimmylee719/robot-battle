/**
 * 扭蛋機和晶片幣（純邏輯，不碰畫面）。只用遊戲裡賺的晶片幣，沒有真錢。
 *  - 稀有度三種：普通 70%、稀有 25%、超稀有 5%；同稀有度裡平均抽
 *  - 保底：連續 PITY 次沒出超稀有，下一次一定是超稀有
 *  - 十連：十顆裡至少一顆稀有以上
 *  - 抽到已經有的卡變成碎片；碎片可以指定兌換還沒有的卡
 *  - 機率全部公開在扭蛋機畫面上
 * 扭蛋不影響戰鬥規則（卡本身的數值不變），所以不用改分享連結的 VERSION。
 */
import type { Rng } from '../core/rng';
import { CARD_LIST, CARDS } from './cards';

export type Rarity = 'N' | 'R' | 'SR';

export const RARITY: Record<string, Rarity> = {
  outfighter: 'SR',
  haymaker: 'SR',
  overclocked: 'SR',
  never_back: 'SR',
  zen: 'SR',
  punish: 'R',
  second_wind: 'R',
  read_heavy: 'R',
  hit_and_run: 'R',
  buzzer: 'R',
  smell_blood: 'R',
  hothead: 'R',
  blitz: 'R',
  // 武術流派
  jkd: 'SR',
  lethwei: 'SR',
  aikido: 'SR',
  taekwondo: 'R',
  muaythai: 'R',
  judo: 'R',
  bjj: 'R',
  capoeira: 'R',
  wingchun: 'R',
  sumo: 'R',
  kyokushin: 'R',
};

export function rarityOf(id: string): Rarity {
  return RARITY[id] ?? 'N';
}

export const RARITY_NAME: Record<Rarity, string> = { N: '普通', R: '稀有', SR: '超稀有' };
export const RARITY_STARS: Record<Rarity, string> = { N: '★', R: '★★', SR: '★★★' };
/** 機率（加起來 1） */
export const RATES: Record<Rarity, number> = { N: 0.7, R: 0.25, SR: 0.05 };
export const PITY = 30;
export const COST_ONE = 100;
export const COST_TEN = 900;
/** 重複的卡換多少碎片、兌換一張要多少碎片 */
export const FRAG_FROM_DUPE: Record<Rarity, number> = { N: 10, R: 25, SR: 60 };
export const CRAFT_COST: Record<Rarity, number> = { N: 60, R: 150, SR: 400 };

/** 晶片幣收入 */
export const INCOME = {
  win: 60,
  loss: 20,
  draw: 30,
  /** 每日挑戰打贏另外加 */
  daily: 80,
  league: 40,
  /** 大廳的每日補給 */
  supply: 150,
  /** 第一次玩送的 */
  welcome: 300,
};

export interface Wallet {
  coins: number;
  frags: number;
  /** 距離上次超稀有抽了幾次 */
  pity: number;
  /** 每張卡拿過幾張（含第一張）：倉庫上顯示 ×N */
  copies: Record<string, number>;
  /** 每日補給最後領的是第幾天（UTC） */
  supplyDay: number;
}

export function newWallet(): Wallet {
  return { coins: INCOME.welcome, frags: 0, pity: 0, copies: {}, supplyDay: -1 };
}

export function cleanWallet(raw: unknown): Wallet {
  const r = (raw ?? null) as Partial<Wallet> | null;
  if (!r || typeof r !== 'object') return newWallet();
  const num = (v: unknown): number => Math.max(0, Math.floor(Number(v) || 0));
  const copies: Record<string, number> = {};
  if (r.copies && typeof r.copies === 'object')
    for (const [id, n] of Object.entries(r.copies)) if (id in CARDS && num(n) > 0) copies[id] = num(n);
  return { coins: num(r.coins), frags: num(r.frags), pity: Math.min(PITY, num(r.pity)), copies, supplyDay: Number.isFinite(Number(r.supplyDay)) ? Math.floor(Number(r.supplyDay)) : -1 };
}

export interface Pull {
  card: string;
  rarity: Rarity;
  /** 第一次拿到 */
  fresh: boolean;
  /** 重複的話換到的碎片 */
  frags: number;
}

function poolOf(r: Rarity): string[] {
  return CARD_LIST.filter((c) => rarityOf(c.id) === r).map((c) => c.id);
}

function roll(rng: Rng, pity: number, floorR: boolean): Rarity {
  if (pity >= PITY - 1) return 'SR';
  const x = rng.next();
  if (x < RATES.SR) return 'SR';
  if (x < RATES.SR + RATES.R || floorR) return 'R';
  return 'N';
}

/**
 * 轉 n 次（1 或 10）。錢不夠回傳 null。owned 和 wallet 會被改掉（新卡加進 owned）。
 */
export function spin(n: 1 | 10, owned: string[], w: Wallet, rng: Rng): Pull[] | null {
  const cost = n === 10 ? COST_TEN : COST_ONE;
  if (w.coins < cost) return null;
  w.coins -= cost;
  const out: Pull[] = [];
  for (let i = 0; i < n; i++) {
    // 十連的最後一顆：前面九顆都是普通的話，這顆至少稀有
    const floorR = n === 10 && i === n - 1 && out.every((p) => p.rarity === 'N');
    const rarity = roll(rng, w.pity, floorR);
    w.pity = rarity === 'SR' ? 0 : w.pity + 1;
    const pool = poolOf(rarity);
    const card = pool[rng.int(pool.length)];
    out.push(take(card, owned, w));
  }
  return out;
}

/** 拿到一張卡：新的就收進來，重複的換碎片 */
function take(card: string, owned: string[], w: Wallet): Pull {
  const rarity = rarityOf(card);
  const fresh = !owned.includes(card);
  if (fresh) owned.push(card);
  w.copies[card] = Math.max(1, w.copies[card] ?? 1) + (fresh ? 0 : 1);
  const frags = fresh ? 0 : FRAG_FROM_DUPE[rarity];
  w.frags += frags;
  return { card, rarity, fresh, frags };
}

/** 用碎片兌換一張還沒有的卡。成功回傳 true。 */
export function craft(card: string, owned: string[], w: Wallet): boolean {
  if (!(card in CARDS) || owned.includes(card)) return false;
  const cost = CRAFT_COST[rarityOf(card)];
  if (w.frags < cost) return false;
  w.frags -= cost;
  owned.push(card);
  w.copies[card] = 1;
  return true;
}

/** 每日補給：今天還沒領就加錢，回傳拿到多少（0 = 今天領過了） */
export function claimSupply(w: Wallet, day: number): number {
  if (w.supplyDay === day) return 0;
  w.supplyDay = day;
  w.coins += INCOME.supply;
  return INCOME.supply;
}
