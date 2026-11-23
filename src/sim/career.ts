/**
 * 生涯模式（純邏輯，不碰畫面）：從車庫地下賽一路打到世界冠軍。
 * 參考 Godot 版的 career.gd，精簡成網頁版：
 *  - 四個級別，每級有自己的出場額度上限（玩家和對手都一樣），越高越貴
 *  - 每級一張 6 人排名表，玩家從「新人」開始；打贏排名比你高的，就搶走他的名次
 *  - 排第 2 名可以打冠軍戰；拿下腰帶就升到下一級。最高級拿下就是世界冠軍，之後是衛冕戰
 *  - 每場是一週。每週有 2～3 個邀約可以選（挑戰、對決、熱身、冠軍戰、宿敵戰）
 *  - 宿敵：上一個打敗你的人；打宿敵人氣加倍
 *  - 人氣越高，出場費越多；出場費是晶片幣（和扭蛋共用）
 *  - 每週其他選手也在打：排名表會有人上下，新聞會報
 * 對手全部從「生涯種子 + 級別 + 編號」生出來，所以同一個存檔永遠是同一批人。
 */
import { Rng } from '../core/rng';
import { randomBot, runToEnd } from './camp';
import { CARD_LIST, CARDS } from './cards';
import { DEFAULT_GEAR, fitDeck, totalCost } from './gear';
import { createMatch, type RobotSetup } from './match';
import { TACTIC_LIST, type Tactic } from './tactics';
import type { FinishMethod } from './types';

export interface Division {
  name: string;
  icon: string;
  /** 這一級的出場額度上限（玩家也一樣） */
  cap: number;
  /** 基本出場費（晶片幣） */
  purse: number;
  /** 排名表上的對手比玩家少多少額度（低級別讓多一點，新手比較好上手） */
  edge: number;
}

export const DIVISIONS: Division[] = [
  { name: '車庫地下賽', icon: '🔩', cap: 650, purse: 50, edge: 100 },
  { name: '城市聯賽', icon: '🏙', cap: 780, purse: 80, edge: 140 },
  { name: '全國職業聯賽', icon: '🏟', cap: 900, purse: 120, edge: 110 },
  { name: '世界冠軍賽', icon: '👑', cap: 1000, purse: 180, edge: 70 },
];

/** 每級排名表有幾個電腦選手（玩家另外插進去） */
export const RANKED = 6;

export interface Fighter {
  id: string;
  name: string;
  seed: number;
  w: number;
  l: number;
}

export interface Career {
  seed: number;
  week: number;
  div: number;
  /** 這一級的排名表，第 0 個是冠軍；玩家是 id 'me' */
  table: Fighter[];
  fans: number;
  w: number;
  l: number;
  ko: number;
  /** 宿敵的 id（null = 沒有） */
  rival: string | null;
  /** 世界冠軍：衛冕了幾次（-1 = 還不是世界冠軍） */
  defenses: number;
  /** 新聞，最新的在前面 */
  news: string[];
  /** 拿過哪些級別的腰帶 */
  belts: number[];
}

export type OfferKind = 'title' | 'defend' | 'rival' | 'climb' | 'jump' | 'warmup';

export interface Offer {
  kind: OfferKind;
  /** 對手在排名表的位置；熱身賽的對手不在表上（-1） */
  at: number;
  foe: Fighter;
  purse: number;
  fans: number;
}

export const OFFER_NAME: Record<OfferKind, string> = {
  title: '🏆 冠軍戰',
  defend: '🛡 衛冕戰',
  rival: '🔥 宿敵戰',
  climb: '⚔ 排名戰',
  jump: '🚀 越級挑戰',
  warmup: '🌱 熱身賽',
};

const ME = 'me';

// 名字：前半 + 後半 + 型號，全部從種子挑
const HEAD = ['鐵', '鋼', '電', '火', '霓虹', '齒輪', '鏽', '雷', '夜', '玻璃', '銅', '鈦', '磁', '冰', '蒸汽', '螺絲'];
const TAIL = ['拳', '錘', '狼', '牙', '鴉', '蠍', '獸', '衛', '鬼', '王', '熊', '鯊', '蜂', '龍', '犀', '貓'];
const CODE = ['KX', 'RB', 'MK', 'ZR', 'TX', 'VT', 'GR', 'HX', 'Q', 'DX'];

function fighterName(rng: Rng): string {
  return `${CODE[rng.int(CODE.length)]}-${1 + rng.int(99)} ${HEAD[rng.int(HEAD.length)]}${TAIL[rng.int(TAIL.length)]}`;
}

function mix(...n: number[]): number {
  let h = 0x811c9dc5;
  for (const x of n) h = Math.imul(h ^ (x >>> 0), 0x01000193) >>> 0;
  return h >>> 0;
}

/** 一級的候選人數：多生幾個，比過一輪再照強弱排進排名表 */
const CANDIDATES = 10;
const REFS = 8;
/** 排好之後挑第幾個（0 = 最強） */
const PICK = [0, 2, 4, 6, 8, 9];

/**
 * 一級的六個電腦選手（名字不重複）。
 * 隨機生出來的機器人強弱差很多，所以先生 10 個，各和 8 台基準機器人打一場，
 * 照勝場排：最強的當冠軍，名次越後面越弱。全部用種子，所以同一個存檔排出來一樣。
 */
export function makeTable(seed: number, div: number): Fighter[] {
  const rng = new Rng(mix(seed, div, 77));
  const pool: { f: Fighter; score: number }[] = [];
  const used = new Set<string>();
  const cap = DIVISIONS[div].cap - DIVISIONS[div].edge;
  const refs = Array.from({ length: REFS }, (_, k) => randomBot(mix(div, k, 31337), 'ref', cap));
  while (pool.length < CANDIDATES) {
    const name = fighterName(rng);
    if (used.has(name)) continue;
    used.add(name);
    const f: Fighter = { id: '', name, seed: mix(seed, div, pool.length, 13), w: 0, l: 0 };
    const s = buildFor(f, div, false);
    let score = 0;
    refs.forEach((r, k) => {
      const m = runToEnd(createMatch(mix(seed, div, pool.length, k), k % 2 ? [s, r] : [r, s]));
      if (m.winner === (k % 2 ? 0 : 1)) score++;
    });
    pool.push({ f, score });
  }
  // 分數一樣的照生出來的順序，排序才穩定
  const sorted = pool.map((p, i) => ({ ...p, i })).sort((a, b) => b.score - a.score || a.i - b.i);
  // 最強的當冠軍，其他的從強到弱平均挑，排名表才有坡度
  return PICK.map((k, i) => ({ ...sorted[k].f, id: `d${div}f${i}` }));
}

/** 選手的機器人：同一級都用同樣的額度（比玩家少一點），強弱靠排名表的排序 */
function buildFor(f: Fighter, div: number, rookie: boolean): RobotSetup {
  // 最便宜的機器人（活塞拳、輕型、標準推進器、Potato）是 410，再加一張流派卡：至少留 500
  const cap = Math.max(500, DIVISIONS[div].cap - (rookie ? 260 : DIVISIONS[div].edge));
  // 額度太緊時流派卡會被擠掉（沒有流派只會走過去戳一下）：換個種子重抽，直到有流派
  let s = randomBot(f.seed, f.name, cap);
  for (let k = 1; k < 20 && !s.deck.some((id) => CARDS[id]?.kind === 'style'); k++) s = randomBot(mix(f.seed, k), f.name, cap);
  if (!s.deck.some((id) => CARDS[id]?.kind === 'style')) {
    // 還是沒有：最便宜的零件和大腦，配一張隨機的流派卡
    const room = cap - totalCost(DEFAULT_GEAR, 'potato', []);
    const fitting = CARD_LIST.filter((c) => c.kind === 'style' && c.price <= room);
    const styles = fitting.length ? fitting : CARD_LIST.filter((c) => c.kind === 'style');
    s = { name: f.name, gear: { ...DEFAULT_GEAR }, brain: 'potato', deck: [styles[mix(f.seed, 3) % styles.length].id] };
    s.deck = fitDeck(s.gear, s.brain, s.deck, null, cap);
  }
  if (div >= 1) {
    const rng = new Rng(mix(f.seed, 5));
    const pool: Tactic[] = TACTIC_LIST.filter((t) => t !== 'auto');
    s.plan = [0, 1, 2].map(() => (rng.next() < 0.35 ? 'auto' : pool[rng.int(pool.length)]));
  }
  return s;
}

export function newCareer(seed: number): Career {
  const table = makeTable(seed, 0);
  table.push({ id: ME, name: '', seed: 0, w: 0, l: 0 });
  const c: Career = { seed: seed >>> 0, week: 1, div: 0, table, fans: 0, w: 0, l: 0, ko: 0, rival: null, defenses: -1, news: [], belts: [] };
  // 一開始就有人看你不順眼：排名第 5 的放話
  const r = table[RANKED - 2];
  c.rival = r.id;
  c.news.unshift(`📣 ${r.name}：「車庫來的新人？撐不過一回合。」`);
  return c;
}

/** 玩家現在的名次（1 起算；最後一名就是新人） */
export function myRank(c: Career): number {
  return c.table.findIndex((f) => f.id === ME) + 1;
}

/** 一個選手的機器人（at = -1 是不在排名表上的熱身對手） */
export function fighterSetup(c: Career, f: Fighter, at: number): RobotSetup {
  return buildFor(f, c.div, at < 0);
}

/** 這一場的種子：存檔種子 + 第幾週（同一週重打是同一場） */
export function fightSeed(c: Career): number {
  return mix(c.seed, c.week, 991) % 1000000;
}

function pay(c: Career, base: number): number {
  // 人氣每 100 多 10%
  return Math.round(base * (1 + c.fans / 1000));
}

/** 這一週可以接的比賽 */
export function offers(c: Career): Offer[] {
  const div = DIVISIONS[c.div];
  const me = myRank(c) - 1;
  const out: Offer[] = [];
  const add = (kind: OfferKind, at: number, mult: number, fans: number): void => {
    const foe = c.table[at];
    if (!foe || foe.id === ME || out.some((o) => o.at === at)) return;
    out.push({ kind, at, foe, purse: pay(c, div.purse * mult), fans });
  };
  if (me === 0) {
    // 冠軍：最高級是衛冕戰；其他級別拿到腰帶就升級了，不會停在這裡
    add('defend', 1, 2.2, 30);
    add('defend', 2, 1.8, 22);
  } else if (me === 1) add('title', 0, 2.5, 40);
  // 宿敵在你前面才打得到
  const ri = c.rival ? c.table.findIndex((f) => f.id === c.rival) : -1;
  if (ri >= 1 && ri < me) add('rival', ri, 1.5, 24);
  if (me >= 3) add('jump', me - 2, 1.6, 18);
  if (me >= 2) add('climb', me - 1, 1.2, 12);
  // 熱身賽：不在排名表上的新面孔，比較好打，不影響名次
  const rng = new Rng(mix(c.seed, c.week, 404));
  const rookie: Fighter = { id: `w${c.week}`, name: fighterName(rng), seed: mix(c.seed, c.week, 405), w: 0, l: 0 };
  out.push({ kind: 'warmup', at: -1, foe: rookie, purse: pay(c, div.purse * 0.7), fans: 5 });
  return out;
}

export interface CareerResult {
  lines: string[];
  coins: number;
  /** 拿下這一級的腰帶、升級了 */
  promoted: boolean;
}

/**
 * 打完一場：改名次、人氣、宿敵，寫新聞，週數加一，順便讓其他人也打一輪。
 * winner：0 = 玩家贏，1 = 輸，其他 = 平手。
 */
export function finishFight(c: Career, o: Offer, winner: number, method: FinishMethod | null, myName: string): CareerResult {
  const lines: string[] = [];
  const div = DIVISIONS[c.div];
  const me = myRank(c) - 1;
  const won = winner === 0;
  const lost = winner === 1;
  const ko = won && (method === 'KO' || method === 'TKO');
  const isRival = o.foe.id === c.rival;
  const foe = o.at >= 0 ? c.table[o.at] : null;

  // 出場費：贏全拿，K.O. 多 30%，平手 60%，輸了 40%
  const coins = Math.round(o.purse * (won ? (ko ? 1.3 : 1) : lost ? 0.4 : 0.6));
  let fans = won ? o.fans + (ko ? 10 : 0) : lost ? -6 : 2;
  if (isRival && won) fans *= 2;
  c.fans = Math.max(0, c.fans + fans);
  if (won) c.w++;
  if (lost) c.l++;
  if (ko) c.ko++;
  if (foe) {
    if (won) foe.l++;
    if (lost) foe.w++;
  }
  lines.push(`💵 出場費 🪙${coins}・👥 人氣 ${fans >= 0 ? '+' : ''}${fans}`);

  let promoted = false;
  const finish = ko ? `${method === 'KO' ? 'K.O.' : 'TKO'} 擊倒` : '判定擊敗';
  if (won && o.at >= 0 && o.at < me) {
    // 搶走他的名次：自己插到他的位置，中間的人各退一名
    const [self] = c.table.splice(me, 1);
    c.table.splice(o.at, 0, self);
    lines.push(`📈 升到第 ${o.at + 1} 名`);
  } else if (lost && me < c.table.length - 1 && o.kind !== 'warmup') {
    // 輸給排名戰的對手：掉一名
    const t = c.table;
    [t[me], t[me + 1]] = [t[me + 1], t[me]];
    lines.push(`📉 掉到第 ${me + 2} 名`);
  }

  if (won) {
    if (o.kind === 'title') {
      c.belts.push(c.div);
      if (c.div < DIVISIONS.length - 1) {
        c.news.unshift(`🏆 ${myName} ${finish} ${o.foe.name}，拿下${div.name}冠軍腰帶！`);
        lines.push(`🏆 ${div.name}冠軍！下週升上「${DIVISIONS[c.div + 1].name}」`);
        promoted = true;
      } else {
        c.defenses = 0;
        c.news.unshift(`👑 ${myName} ${finish} ${o.foe.name}，成為新的世界冠軍！`);
        lines.push('👑 世界冠軍！接下來每一場都是衛冕戰');
      }
    } else if (o.kind === 'defend') {
      c.defenses++;
      c.news.unshift(`🛡 ${myName} 第 ${c.defenses} 次衛冕成功，${finish} ${o.foe.name}`);
      lines.push(`🛡 衛冕成功（第 ${c.defenses} 次）`);
    } else if (isRival) {
      c.news.unshift(`🔥 宿怨了結：${myName} ${finish} ${o.foe.name}`);
      lines.push('🔥 打敗宿敵，人氣加倍');
    } else if (ko) c.news.unshift(`💥 ${myName} ${finish} ${o.foe.name}`);
    if (isRival) c.rival = null;
  } else if (lost) {
    if (o.kind === 'defend') {
      c.defenses = -1;
      c.news.unshift(`💔 ${o.foe.name} 擊敗 ${myName}，搶走世界冠軍腰帶`);
    } else c.news.unshift(`😤 ${o.foe.name} 擊敗 ${myName}`);
    // 打敗你的人（排名表上的）變成宿敵
    if (o.at >= 0) {
      c.rival = o.foe.id;
      lines.push(`🔥 ${o.foe.name} 成了你的宿敵`);
    }
  }

  c.week++;
  others(c);
  // 沒有宿敵的話，排在你前面的那個人會來找麻煩
  const nm = myRank(c) - 1;
  if (!c.rival && nm >= 1 && !promoted) {
    const r = c.table[nm - 1];
    c.rival = r.id;
    c.news.unshift(`📣 ${r.name}：「下一個就是你。」`);
  }
  if (promoted) promote(c);
  c.news = c.news.slice(0, 12);
  return { lines, coins, promoted };
}

/** 其他選手這週也打了一場：隨機兩個相鄰的電腦選手，後面的有 40% 爆冷 */
function others(c: Career): void {
  const rng = new Rng(mix(c.seed, c.week, 8));
  const ai = c.table.map((_, i) => i).filter((i) => c.table[i].id !== ME && c.table[i + 1] && c.table[i + 1].id !== ME);
  if (ai.length === 0) return;
  const i = ai[rng.int(ai.length)];
  const a = c.table[i];
  const b = c.table[i + 1];
  if (rng.next() < 0.4) {
    c.table[i] = b;
    c.table[i + 1] = a;
    b.w++;
    a.l++;
    c.news.unshift(i === 0 ? `👑 爆冷！${b.name} 擊敗冠軍 ${a.name}，拿下${DIVISIONS[c.div].name}腰帶` : `📰 ${b.name} 爆冷擊敗 ${a.name}，升上第 ${i + 1} 名`);
  } else {
    a.w++;
    b.l++;
    c.news.unshift(`📰 ${a.name} 守住第 ${i + 1} 名，擊敗 ${b.name}`);
  }
}

/** 升到下一級：新的排名表，從新人開始 */
function promote(c: Career): void {
  c.div++;
  const table = makeTable(c.seed, c.div);
  table.push({ id: ME, name: '', seed: 0, w: 0, l: 0 });
  c.table = table;
  const r = table[RANKED - 2];
  c.rival = r.id;
  c.news.unshift(`📣 ${r.name}：「${DIVISIONS[c.div].name}可不是車庫。」`);
}

/** 存檔讀回來時清洗：認不得就當作沒有生涯 */
export function cleanCareer(raw: unknown): Career | null {
  const r = raw as Partial<Career> | null;
  if (!r || typeof r !== 'object' || !Array.isArray(r.table)) return null;
  const int = (v: unknown, min = 0): number => Math.max(min, Math.floor(Number(v) || 0));
  const div = Math.min(DIVISIONS.length - 1, int(r.div));
  const table: Fighter[] = [];
  for (const f of r.table as Partial<Fighter>[]) {
    if (!f || typeof f.id !== 'string') continue;
    table.push({ id: f.id.slice(0, 12), name: String(f.name ?? '').slice(0, 24), seed: int(f.seed) >>> 0, w: int(f.w), l: int(f.l) });
  }
  if (table.filter((f) => f.id === ME).length !== 1 || table.length !== RANKED + 1) return null;
  return {
    seed: int(r.seed) >>> 0,
    week: int(r.week, 1),
    div,
    table,
    fans: int(r.fans),
    w: int(r.w),
    l: int(r.l),
    ko: int(r.ko),
    rival: typeof r.rival === 'string' && table.some((f) => f.id === r.rival) ? r.rival : null,
    defenses: Math.max(-1, Math.floor(Number(r.defenses ?? -1))),
    news: Array.isArray(r.news) ? r.news.filter((n): n is string => typeof n === 'string').slice(0, 12).map((n) => n.slice(0, 80)) : [],
    belts: Array.isArray(r.belts) ? r.belts.map((b) => int(b)).filter((b) => b < DIVISIONS.length) : [],
  };
}
