/**
 * 卡冊：卡牌是打贏來的，不買也不抽。規則照 Godot 版（scripts/data/album.gd）的精簡版。
 *  - 新玩家有六張：三個流派和三張入門反射
 *  - 第一次打贏每個對手，拿到它的獎勵卡
 *  - 每次打贏，還會拿到對手這場最常用的那張卡（如果還沒有）
 *  - 其餘的卡每贏三場發一張，順序固定
 * 沒有隨機，沒有卡包。全部是純函式。
 */
import { CARDS } from './cards';

export const STARTER: readonly string[] = ['boxing', 'brawler', 'taichi', 'karate', 'judo', 'kickboxing', 'jab_jab', 'slip_counter', 'shell_up'];

/** 每贏三場發一張，照這個順序（已經有的就跳過） */
export const BY_WINS: readonly string[] = [
  'punish',
  'blitz',
  'smell_blood',
  'chase',
  'hit_and_run',
  'cage_press',
  'second_wind',
  'off_the_wall',
  'hothead',
  'never_back',
  'buzzer',
];
export const WINS_PER_CARD = 3;

export function cleanOwned(raw: unknown): string[] {
  const out = [...STARTER];
  if (Array.isArray(raw)) for (const id of raw) if (typeof id === 'string' && id in CARDS && !out.includes(id)) out.push(id);
  return out;
}

export interface Drop {
  card: string;
  why: string;
}

export interface WinInfo {
  /** 對手的名字和它的獎勵卡 */
  foeName: string;
  prize: string;
  firstWin: boolean;
  /** 對手這場每張卡發動了幾次 */
  foeCardUses: Record<string, number>;
  /** 算上這一場之後的總勝場 */
  totalWins: number;
}

/** 打贏一場之後拿到哪些卡。回傳新的持有清單和這次拿到的卡。 */
export function grantForWin(owned: readonly string[], win: WinInfo): { owned: string[]; drops: Drop[] } {
  const have = [...owned];
  const drops: Drop[] = [];
  const give = (card: string, why: string): void => {
    if (!(card in CARDS) || have.includes(card)) return;
    have.push(card);
    drops.push({ card, why });
  };

  if (win.firstWin) give(win.prize, `第一次打贏 ${win.foeName}`);

  // 對手這場最常用、而且我還沒有的卡（同次數時照卡名排序，結果才固定）
  const used = Object.keys(win.foeCardUses)
    .filter((id) => id in CARDS && !have.includes(id) && win.foeCardUses[id] > 0)
    .sort((a, b) => win.foeCardUses[b] - win.foeCardUses[a] || (a < b ? -1 : 1));
  if (used.length) give(used[0], `${win.foeName} 這場最常用的卡`);

  if (win.totalWins % WINS_PER_CARD === 0) {
    const next = BY_WINS.find((id) => !have.includes(id));
    if (next) give(next, `累積 ${win.totalWins} 勝`);
  }
  return { owned: have, drops };
}

/** 還沒拿到的卡要怎麼拿（給卡桌上的剪影看） */
export function howToGet(card: string, prizes: Record<string, string>): string {
  if (prizes[card]) return `第一次打贏 ${prizes[card]}`;
  if (BY_WINS.includes(card)) return `每贏 ${WINS_PER_CARD} 場發一張，或打贏有這張卡的對手`;
  return '打贏有這張卡的對手';
}
