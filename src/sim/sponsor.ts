/**
 * 贊助商合約（純邏輯，生涯模式用）。參考 Godot 版的 career.gd／career_text.gd，精簡成網頁版：
 *  - 每家贊助商會「注意到」你的某件事（第一場勝利、連勝、K.O.、人氣、輸很多場……），然後來信開條件
 *  - 簽約拿一筆簽約金；之後每場做到它的條件就付一次錢
 *  - 沒做到先警告，連續兩場沒做到就解約，過 15 週才可能再來信；拒絕的話過 6 週；自己解約的不會再來
 *  - 能簽幾家看級別（1／2／3／3）
 *  - 合約的錢都是晶片幣，和出場費、扭蛋共用
 * 條件只看一場打完的數字（FightStats，由畫面從事件數出來），不會回頭影響勝負。
 * 名字全部是虛構的公司。
 */

export type DemandKind =
  | 'win'
  | 'ko'
  | 'early'
  | 'no_down'
  | 'outland'
  | 'no_gas'
  | 'distance'
  | 'hits'
  | 'heavies'
  | 'counters'
  | 'safe_win'
  | 'dmg';

export interface Demand {
  kind: DemandKind;
  n?: number;
}

/** 注意到你的條件：全部成立才會來信 */
export interface Notice {
  wins?: number;
  losses?: number;
  kos?: number;
  /** 被 K.O.／TKO 幾次 */
  koLosses?: number;
  fans?: number;
  streak?: number;
  fights?: number;
  /** 打滿 3 場之後的勝率 */
  winrate?: number;
}

export interface Sponsor {
  id: string;
  name: string;
  icon: string;
  /** 印在機器人身上的顏色：底色、字色 */
  bg: string;
  fg: string;
  /** 最低要在第幾級才會出現 */
  div: number;
  when: Notice;
  demand: Demand;
  sign: number;
  pay: number;
  /** 來信、警告、解約各一句 */
  pitch: string;
  warn: string;
  drop: string;
}

export const SPONSORS: Sponsor[] = [
  {
    id: 'ohmworks', name: '歐姆工坊電池', icon: '⚡', bg: '#151515', fg: '#ffd23f', div: 0,
    when: { wins: 1 }, demand: { kind: 'no_gas' }, sign: 80, pay: 25,
    pitch: '您的首勝帶著一股電壓。我們想把它印上海報——只要您別在台上沒電。',
    warn: '您的機器人在直播時沒電了，裝的還是我們的電池。看出問題在哪了嗎？',
    drop: '沒電兩次。這份合約，我們決定放電歸零。',
  },
  {
    id: 'gearburger', name: '齒輪堡', icon: '🍔', bg: '#c8261f', fg: '#ffd23f', div: 0,
    when: { fans: 40 }, demand: { kind: 'hits', n: 16 }, sign: 70, pay: 25,
    pitch: '大家都在聊你，而粉絲肚子很餓。每場給我狂打，就跟我們的漢堡一樣——料多到爆。',
    warn: '那場打得像什麼都沒夾的漢堡皮。給我多打幾下！',
    drop: '你從我們的菜單上下架了。',
  },
  {
    id: 'rustaway', name: '除鏽淨', icon: '💧', bg: '#0f3b3a', fg: '#ff8c42', div: 0,
    when: { fights: 3, winrate: 0.5 }, demand: { kind: 'outland' }, sign: 90, pay: 30,
    pitch: '勝率過半，而且身上沒什麼凹痕。除鏽淨要的就是亮晶晶：打中對手要比挨打多。',
    warn: '你挨的拳比打出去的多，烤漆都花了。這一點都不除鏽淨。',
    drop: '凹痕太多了。我們的律師正在把你從名單上噴掉。',
  },
  {
    id: 'circuity', name: '電路保險', icon: '🛡', bg: '#0b2530', fg: '#5ad1e6', div: 0,
    when: { koLosses: 2 }, demand: { kind: 'distance' }, sign: 100, pay: 20,
    pitch: '凹痕難免，有我們在。只要別再被 K.O.，理賠我們照付。',
    warn: '又被 K.O. 了。精算師的臉色很難看。',
    drop: '風險太高，我們決定不續保。',
  },
  {
    id: 'sprocket', name: '鏈輪父子', icon: '⚙', bg: '#20402a', fg: '#f2e6c8', div: 0,
    when: { losses: 3 }, demand: { kind: 'win' }, sign: 60, pay: 45,
    pitch: '你輸了不少場。我們六二年也是。老機器就是要逆轉——贏一場，錢我們出。',
    warn: '又輸了！鏈輪阿公在電視前面睡著了。',
    drop: '不贏球，沒錢拿。抱歉啦，孩子。',
  },
  {
    id: 'fizztron', name: '嘶嘶創可樂', icon: '🥤', bg: '#ffffff', fg: '#d7192c', div: 1,
    when: { kos: 2 }, demand: { kind: 'ko' }, sign: 160, pay: 60,
    pitch: '你的 K.O. 就像開瓶那一聲「嘶」。我們只要這個聲音。',
    warn: '沒氣的可樂誰要喝？下次給我 K.O.。',
    drop: '這瓶沒氣了，我們換一瓶。',
  },
  {
    id: 'rotorun', name: '轉子跑運動燃料', icon: '🏃', bg: '#5b1fa8', fg: '#ffffff', div: 1,
    when: { streak: 2 }, demand: { kind: 'heavies', n: 3 }, sign: 140, pay: 50,
    pitch: '連勝的燃料是哪一牌？我們。每場給我至少三記重拳。',
    warn: '才那幾記重拳？燃料還剩一大半。',
    drop: '油門踩不下去的選手，我們不贊助。',
  },
  {
    id: 'kranko', name: '克蘭可工具', icon: '🔧', bg: '#123a8c', fg: '#ffffff', div: 1,
    when: { wins: 6 }, demand: { kind: 'counters', n: 10 }, sign: 150, pay: 55,
    pitch: '轉不動？克蘭可一下。我們喜歡會抓時機的選手：每場至少十次反擊打中。',
    warn: '反擊才那幾下，扳手都生鏽了。',
    drop: '時機感不見了，我們收回扳手。',
  },
  {
    id: 'hexnut', name: '六角螺母銀行', icon: '🏦', bg: '#0e1a3a', fg: '#f2c230', div: 2,
    when: { wins: 10 }, demand: { kind: 'safe_win', n: 0.3 }, sign: 240, pay: 110,
    pitch: '我們只投資穩健的資產：贏，而且血量要剩三成以上。',
    warn: '這場贏得太驚險，風控部門很不安。',
    drop: '您的風險等級過高，帳戶已凍結。',
  },
  {
    id: 'torqueplus', name: '扭力加機油', icon: '🛢', bg: '#111111', fg: '#ff3b30', div: 2,
    when: { streak: 3 }, demand: { kind: 'dmg', n: 150 }, sign: 260, pay: 85,
    pitch: '壓力越大越順。每場至少打出 150 點傷害，讓觀眾看到扭力。',
    warn: '輸出不夠，引擎在空轉。',
    drop: '扭力不足，合約到此為止。',
  },
  {
    id: 'pixa', name: '皮夏披薩', icon: '🍕', bg: '#ff8c1a', fg: '#1b1b1b', div: 2,
    when: { fans: 300 }, demand: { kind: 'early' }, sign: 220, pay: 110,
    pitch: '無人機外送，準時送達。你也一樣：前兩回合就把對手送走。',
    warn: '拖太久了，披薩都涼了。',
    drop: '超時太多次，我們換外送員。',
  },
  {
    id: 'channel_ohm', name: '歐姆頻道', icon: '📺', bg: '#2a0f2e', fg: '#ff6bd6', div: 3,
    when: { fans: 500 }, demand: { kind: 'hits', n: 26 }, sign: 400, pay: 130,
    pitch: '世界冠軍賽的轉播權在我們手上。收視率只看一件事：動作。每場至少打中 26 下。',
    warn: '打得太悶，收視率掉了兩成。',
    drop: '收視太差，節目停播。',
  },
];

export const SPONSOR: Record<string, Sponsor> = Object.fromEntries(SPONSORS.map((s) => [s.id, s]));

/** 各級可以同時簽幾家 */
export const SLOTS = [1, 2, 3, 3];
/** 連續沒做到幾場就解約 */
export const MISSES_TO_DROP = 2;
/** 拒絕之後幾週才會再來信 */
export const REOFFER_WEEKS = 6;
/** 被解約之後幾週才會再來信（網頁版比 Godot 版寬鬆：長生涯不會把贊助商用光） */
export const RETURN_WEEKS = 15;
/** 最多同時有幾封還沒回的邀約 */
const MAX_PENDING = 3;

/** 一場打完的數字（玩家這一邊）。由畫面讀事件數出來。 */
export interface FightStats {
  won: boolean;
  /** 玩家 K.O.／TKO 贏 */
  koWin: boolean;
  /** 玩家被 K.O.／TKO */
  koLoss: boolean;
  /** 結束時是第幾回合 */
  round: number;
  landed: number;
  /** 挨了幾下（沒擋住的） */
  taken: number;
  heavyLanded: number;
  counters: number;
  dealt: number;
  downs: number;
  gassed: number;
  /** 結束時剩下的血量比例 */
  hpFrac: number;
}

export interface Contract {
  id: string;
  /** 連續沒做到幾場 */
  misses: number;
  /** 一共拿了多少 */
  paid: number;
}

export interface SponsorBook {
  contracts: Contract[];
  /** 還沒回覆的邀約 */
  pending: string[];
  /** 自己解約的：不會再來 */
  gone: string[];
  /** 拒絕過、被解約過的：第幾週以後才會再來信 */
  cool: Record<string, number>;
}

export function newBook(): SponsorBook {
  return { contracts: [], pending: [], gone: [], cool: {} };
}

/** 生涯裡贊助商會看的數字 */
export interface CareerFacts {
  week: number;
  div: number;
  w: number;
  l: number;
  ko: number;
  kol: number;
  fans: number;
  streak: number;
}

export function demandText(d: Demand): string {
  switch (d.kind) {
    case 'win': return '拿下勝利';
    case 'ko': return 'K.O. 或 TKO 獲勝';
    case 'early': return '前兩回合就 K.O. 對手';
    case 'no_down': return '整場都不能倒地';
    case 'outland': return '打中的比挨打的多';
    case 'no_gas': return '整場都不能沒電';
    case 'distance': return '不能被 K.O.';
    case 'hits': return `至少打中 ${d.n} 下`;
    case 'heavies': return `至少打中 ${d.n} 記重拳`;
    case 'counters': return `至少 ${d.n} 次反擊打中`;
    case 'safe_win': return `贏，而且血量剩 ${Math.round((d.n ?? 0) * 100)}% 以上`;
    case 'dmg': return `至少打出 ${d.n} 點傷害`;
  }
}

/** 這一場有沒有做到條件 */
export function demandMet(d: Demand, s: FightStats): boolean {
  const n = d.n ?? 0;
  switch (d.kind) {
    case 'win': return s.won;
    case 'ko': return s.koWin;
    case 'early': return s.koWin && s.round <= 2;
    case 'no_down': return s.downs === 0 && !s.koLoss;
    case 'outland': return s.landed > s.taken;
    case 'no_gas': return s.gassed === 0;
    case 'distance': return !s.koLoss;
    case 'hits': return s.landed >= n;
    case 'heavies': return s.heavyLanded >= n;
    case 'counters': return s.counters >= n;
    case 'safe_win': return s.won && s.hpFrac >= n;
    case 'dmg': return s.dealt >= n;
  }
}

/** 這場打到一半，條件現在看起來怎樣（給比賽中的提示用）：true 已經做到、false 已經沒機會、null 還不知道 */
export function demandSoFar(d: Demand, s: FightStats, over: boolean): boolean | null {
  if (over) return demandMet(d, s);
  const n = d.n ?? 0;
  switch (d.kind) {
    case 'hits': return s.landed >= n ? true : null;
    case 'heavies': return s.heavyLanded >= n ? true : null;
    case 'counters': return s.counters >= n ? true : null;
    case 'dmg': return s.dealt >= n ? true : null;
    case 'no_down': return s.downs > 0 ? false : null;
    case 'no_gas': return s.gassed > 0 ? false : null;
    case 'early': return s.round > 2 ? false : null;
    default: return null;
  }
}

function noticed(w: Notice, f: CareerFacts): boolean {
  const fights = f.w + f.l;
  if (w.wins !== undefined && f.w < w.wins) return false;
  if (w.losses !== undefined && f.l < w.losses) return false;
  if (w.kos !== undefined && f.ko < w.kos) return false;
  if (w.koLosses !== undefined && f.kol < w.koLosses) return false;
  if (w.fans !== undefined && f.fans < w.fans) return false;
  if (w.streak !== undefined && f.streak < w.streak) return false;
  if (w.fights !== undefined && fights < w.fights) return false;
  if (w.winrate !== undefined && (fights < 3 || f.w / fights < w.winrate)) return false;
  return true;
}

export function slots(div: number): number {
  return SLOTS[Math.min(div, SLOTS.length - 1)];
}

export interface Settlement {
  lines: string[];
  coins: number;
  news: string[];
}

/** 打完一場：每家贊助商看條件，付錢或警告或解約 */
export function settle(b: SponsorBook, s: FightStats, week: number): Settlement {
  const out: Settlement = { lines: [], coins: 0, news: [] };
  for (const c of [...b.contracts]) {
    const sp = SPONSOR[c.id];
    if (!sp) continue;
    if (demandMet(sp.demand, s)) {
      c.misses = 0;
      c.paid += sp.pay;
      out.coins += sp.pay;
      out.lines.push(`🤝 ${sp.icon} ${sp.name}：達標 +🪙${sp.pay}`);
    } else {
      c.misses++;
      if (c.misses >= MISSES_TO_DROP) {
        b.contracts = b.contracts.filter((x) => x !== c);
        b.cool[c.id] = week + RETURN_WEEKS;
        out.lines.push(`💔 ${sp.icon} ${sp.name}解約了：「${sp.drop}」`);
        out.news.push(`💼 ${sp.name}和你解約`);
      } else out.lines.push(`⚠ ${sp.icon} ${sp.name}：沒做到「${demandText(sp.demand)}」，再一次就解約`);
    }
  }
  return out;
}

/** 一週過去：注意到你的贊助商寫信來（一週最多一封） */
export function checkOffers(b: SponsorBook, f: CareerFacts): string | null {
  if (b.pending.length >= MAX_PENDING) return null;
  for (const sp of SPONSORS) {
    if (sp.div > f.div) continue;
    if (b.contracts.some((c) => c.id === sp.id) || b.pending.includes(sp.id) || b.gone.includes(sp.id)) continue;
    if ((b.cool[sp.id] ?? 0) > f.week) continue;
    if (!noticed(sp.when, f)) continue;
    b.pending.push(sp.id);
    return sp.id;
  }
  return null;
}

/** 簽約：成功的話回傳簽約金，不能簽回傳 -1 */
export function sign(b: SponsorBook, id: string, div: number): number {
  const sp = SPONSOR[id];
  if (!sp || !b.pending.includes(id) || b.contracts.length >= slots(div)) return -1;
  b.pending = b.pending.filter((x) => x !== id);
  b.contracts.push({ id, misses: 0, paid: 0 });
  return sp.sign;
}

/** 拒絕邀約：過一陣子可能再來 */
export function decline(b: SponsorBook, id: string, week: number): void {
  b.pending = b.pending.filter((x) => x !== id);
  b.cool[id] = week + REOFFER_WEEKS;
}

/** 自己解約：不退簽約金，這家也不會再來 */
export function quit(b: SponsorBook, id: string): void {
  if (!b.contracts.some((c) => c.id === id)) return;
  b.contracts = b.contracts.filter((c) => c.id !== id);
  b.gone.push(id);
}

/** 存檔讀回來時清洗 */
export function cleanBook(raw: unknown): SponsorBook {
  const r = raw as Partial<SponsorBook> | null;
  const b = newBook();
  if (!r || typeof r !== 'object') return b;
  const known = (v: unknown): v is string => typeof v === 'string' && v in SPONSOR;
  const seen = new Set<string>();
  if (Array.isArray(r.contracts))
    for (const c of r.contracts as Partial<Contract>[]) {
      if (!c || !known(c.id) || seen.has(c.id) || b.contracts.length >= SLOTS[SLOTS.length - 1]) continue;
      seen.add(c.id);
      b.contracts.push({ id: c.id, misses: Math.min(MISSES_TO_DROP - 1, Math.max(0, Math.floor(Number(c.misses) || 0))), paid: Math.max(0, Math.floor(Number(c.paid) || 0)) });
    }
  if (Array.isArray(r.pending)) b.pending = [...new Set(r.pending.filter(known))].filter((id) => !seen.has(id)).slice(0, MAX_PENDING);
  if (Array.isArray(r.gone)) b.gone = [...new Set(r.gone.filter(known))];
  if (r.cool && typeof r.cool === 'object')
    for (const [k, v] of Object.entries(r.cool)) if (known(k)) b.cool[k] = Math.max(0, Math.floor(Number(v) || 0));
  return b;
}
