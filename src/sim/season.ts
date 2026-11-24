/**
 * 賽季與獎勵路線（純邏輯，不碰畫面）。參考熱賣遊戲的「賽季通行證」，但沒有付費路線、沒有真錢：
 *  - 一季 14 天，從固定的起始日（UTC）算，全世界同一時間換季，不用伺服器
 *  - 每一場比賽（任何模式）都拿星星：贏 3、平手 2、輸 1，K.O. 贏 +1，生涯和聯盟 +1，每日挑戰打贏 +2；
 *    每天第一場勝利再 +3（「每日首勝」）
 *  - 每 8 顆星升一階，共 20 階，每階一個獎勵：晶片幣、碎片、免費扭蛋、指定稀有度的新卡
 *  - 換季時還沒領的獎勵自動發，留一筆「上季打到第幾階」的紀錄，星星歸零
 * 獎勵只決定拿到什麼，不改卡的數值，所以不用加分享的 VERSION。
 */
import type { Rng } from '../core/rng';
import { CARD_LIST, CARDS } from './cards';
import { COST_ONE, CRAFT_COST, RARITY_NAME, rarityOf, spin, type Rarity, type Wallet } from './gacha';

export const SEASON_DAYS = 14;
/** 第 1 季的第一天：2026-01-01（UTC） */
const EPOCH = 20454;
export const TIERS = 20;
export const STARS_PER_TIER = 8;

/** 每一季的名字，輪流用 */
const NAMES = ['霓虹開季', '鏽鐵之秋', '雷暴季', '螺絲盛夏', '冰原鋼骨', '夜市擂台', '齒輪狂歡', '電漿之冬'];

export function seasonOf(day: number): number {
  return Math.floor((day - EPOCH) / SEASON_DAYS) + 1;
}

export function seasonName(id: number): string {
  return `S${id}・${NAMES[(((id - 1) % NAMES.length) + NAMES.length) % NAMES.length]}`;
}

/** 這一季還剩幾天（含今天） */
export function daysLeft(day: number): number {
  return SEASON_DAYS - ((((day - EPOCH) % SEASON_DAYS) + SEASON_DAYS) % SEASON_DAYS);
}

export type Reward =
  | { kind: 'coins'; n: number }
  | { kind: 'frags'; n: number }
  | { kind: 'pull'; n: number }
  | { kind: 'card'; rarity: Rarity };

/** 20 階的獎勵。第 5、10、15 階是稀有卡，最後一階是超稀有卡 */
export const ROAD: Reward[] = [
  { kind: 'coins', n: 100 },
  { kind: 'frags', n: 30 },
  { kind: 'pull', n: 1 },
  { kind: 'coins', n: 150 },
  { kind: 'card', rarity: 'R' },
  { kind: 'frags', n: 40 },
  { kind: 'coins', n: 150 },
  { kind: 'pull', n: 1 },
  { kind: 'frags', n: 60 },
  { kind: 'card', rarity: 'R' },
  { kind: 'coins', n: 200 },
  { kind: 'pull', n: 2 },
  { kind: 'frags', n: 80 },
  { kind: 'coins', n: 200 },
  { kind: 'card', rarity: 'R' },
  { kind: 'coins', n: 250 },
  { kind: 'frags', n: 100 },
  { kind: 'pull', n: 3 },
  { kind: 'coins', n: 300 },
  { kind: 'card', rarity: 'SR' },
];

export function rewardIcon(r: Reward): string {
  switch (r.kind) {
    case 'coins': return '🪙';
    case 'frags': return '💠';
    case 'pull': return '🎰';
    case 'card': return r.rarity === 'SR' ? '🌈' : '🃏';
  }
}

export function rewardText(r: Reward): string {
  switch (r.kind) {
    case 'coins': return `晶片幣 ${r.n}`;
    case 'frags': return `碎片 ${r.n}`;
    case 'pull': return `免費扭蛋 ×${r.n}`;
    case 'card': return `${RARITY_NAME[r.rarity]}新卡`;
  }
}

export interface SeasonState {
  id: number;
  stars: number;
  /** 領過的階（1 起算） */
  claimed: number[];
  /** 最後一次拿「每日首勝」是哪一天 */
  firstWinDay: number;
  /** 以前的賽季打到第幾階（最新的在前面） */
  history: { id: number; tier: number }[];
}

export function newSeason(day: number): SeasonState {
  return { id: seasonOf(day), stars: 0, claimed: [], firstWinDay: -1, history: [] };
}

/** 打到第幾階（0 = 還沒到第 1 階） */
export function tierOf(stars: number): number {
  return Math.min(TIERS, Math.floor(stars / STARS_PER_TIER));
}

/** 到了、還沒領的階 */
export function claimable(s: SeasonState): number[] {
  const out: number[] = [];
  for (let t = 1; t <= tierOf(s.stars); t++) if (!s.claimed.includes(t)) out.push(t);
  return out;
}

export type FightMode = 'career' | 'solo' | 'daily' | 'league';

export interface StarGain {
  stars: number;
  /** 怎麼算的，給賽後畫面用 */
  parts: string[];
  /** 升了幾階 */
  tiersUp: number;
}

/** 打完一場：加星星。winner：0 玩家贏、1 輸、其他平手 */
export function addStars(s: SeasonState, winner: number, ko: boolean, mode: FightMode, day: number): StarGain {
  const parts: string[] = [];
  const won = winner === 0;
  let n = won ? 3 : winner === 1 ? 1 : 2;
  parts.push(won ? '贏 3' : winner === 1 ? '輸 1' : '平手 2');
  if (won && ko) {
    n += 1;
    parts.push('K.O. +1');
  }
  if (mode === 'career' || mode === 'league') {
    n += 1;
    parts.push(mode === 'career' ? '生涯 +1' : '聯盟 +1');
  }
  if (mode === 'daily' && won) {
    n += 2;
    parts.push('每日挑戰 +2');
  }
  if (won && s.firstWinDay !== day) {
    s.firstWinDay = day;
    n += 3;
    parts.push('每日首勝 +3');
  }
  const before = tierOf(s.stars);
  // 滿階之後星星還是記著（看得到打了多少），只是不會再升
  s.stars += n;
  return { stars: n, parts, tiersUp: tierOf(s.stars) - before };
}

/** 發一個獎勵，回傳一句說明 */
export function grant(r: Reward, owned: string[], w: Wallet, rng: Rng): string {
  switch (r.kind) {
    case 'coins':
      w.coins += r.n;
      return `🪙 晶片幣 +${r.n}`;
    case 'frags':
      w.frags += r.n;
      return `💠 碎片 +${r.n}`;
    case 'pull': {
      // 免費扭蛋：先把錢補上再轉，機率和保底都和扭蛋機一樣
      const got: string[] = [];
      for (let i = 0; i < r.n; i++) {
        w.coins += COST_ONE;
        const p = spin(1, owned, w, rng)!;
        got.push(`${CARDS[p[0].card].name}${p[0].fresh ? '（新）' : `→💠${p[0].frags}`}`);
      }
      return `🎰 免費扭蛋：${got.join('、')}`;
    }
    case 'card': {
      // 還沒有的那個稀有度的卡隨機一張；都有了就換成兌換一張的一半碎片
      const pool = CARD_LIST.filter((c) => rarityOf(c.id) === r.rarity && !owned.includes(c.id));
      if (!pool.length) {
        const n = Math.round(CRAFT_COST[r.rarity] / 2);
        w.frags += n;
        return `💠 ${RARITY_NAME[r.rarity]}卡都收齊了，換成碎片 +${n}`;
      }
      const card = pool[rng.int(pool.length)].id;
      owned.push(card);
      w.copies[card] = 1;
      return `🃏 新卡：${CARDS[card].name}`;
    }
  }
}

/** 領一階的獎勵。不能領回傳 null */
export function claim(s: SeasonState, tier: number, owned: string[], w: Wallet, rng: Rng): string | null {
  if (tier < 1 || tier > tierOf(s.stars) || s.claimed.includes(tier)) return null;
  s.claimed.push(tier);
  return grant(ROAD[tier - 1], owned, w, rng);
}

/**
 * 換季：還沒領的獎勵全部發掉、記下上季打到第幾階、星星歸零。
 * 沒換季回傳 null；換了回傳發了哪些東西。
 */
export function rollover(s: SeasonState, day: number, owned: string[], w: Wallet, rng: Rng): { from: number; tier: number; got: string[] } | null {
  const now = seasonOf(day);
  if (s.id === now) return null;
  const from = s.id;
  const tier = tierOf(s.stars);
  const got = claimable(s).map((t) => claim(s, t, owned, w, rng)!);
  if (s.stars > 0) s.history.unshift({ id: from, tier });
  s.history = s.history.slice(0, 8);
  s.id = now;
  s.stars = 0;
  s.claimed = [];
  return { from, tier, got };
}

/** 存檔讀回來時清洗 */
export function cleanSeason(raw: unknown, day: number): SeasonState {
  const r = raw as Partial<SeasonState> | null;
  const s = newSeason(day);
  if (!r || typeof r !== 'object') return s;
  const int = (v: unknown): number => Math.max(0, Math.floor(Number(v) || 0));
  // 季數用存檔裡的（可能是上一季：載入後 rollover 會處理）；比現在還新的不合理，當作這一季
  const id = int(r.id);
  s.id = id >= 1 && id <= seasonOf(day) ? id : seasonOf(day);
  s.stars = Math.min(int(r.stars), 100000);
  s.claimed = Array.isArray(r.claimed) ? [...new Set(r.claimed.map(int))].filter((t) => t >= 1 && t <= TIERS) : [];
  s.firstWinDay = Number.isFinite(Number(r.firstWinDay)) ? Math.floor(Number(r.firstWinDay)) : -1;
  s.history = Array.isArray(r.history)
    ? r.history
        .filter((h): h is { id: number; tier: number } => !!h && typeof h === 'object')
        .map((h) => ({ id: int(h.id), tier: Math.min(TIERS, int(h.tier)) }))
        .slice(0, 8)
    : [];
  return s;
}
