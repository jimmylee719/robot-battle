/**
 * 聯盟（非同步對戰）的規則，純邏輯：伺服器和瀏覽器都用這一份。
 * 玩家把一台機器人登錄成「守擂機器人」放在伺服器上；別人隨時可以拿自己的機器人來挑戰它，不用兩邊同時在線。
 * 勝負由伺服器自己重跑一場算出來（戰鬥邏輯是純函式、結果固定），所以瀏覽器回報什麼都沒用，作不了弊。
 */
import { randomBot, runToEnd } from './camp';
import type { BrainId } from './cards';
import { createMatch, type RobotSetup } from './match';
import { LADDER } from './roster';
import { cleanSetup } from './share';
import type { Loadout } from './types';

export const START_RATING = 1000;
const K = 32;

export interface Entry {
  id: string;
  setup: RobotSetup;
  rating: number;
  wins: number;
  losses: number;
  /** 系統放的機器人（聯盟剛開張時充場面用） */
  bot: boolean;
}

export interface LeagueData {
  entries: Entry[];
  /** 玩家的密鑰 → 他的守擂機器人 id。密鑰只存在玩家自己的瀏覽器裡。 */
  tokens: Record<string, string>;
  nextId: number;
  fights: number;
}

/** 給別人看的資料：不含卡組（打過才看得到） */
export interface PublicEntry {
  id: string;
  name: string;
  rating: number;
  wins: number;
  losses: number;
  brain: BrainId;
  gear: Loadout;
  bot: boolean;
}

export interface Board {
  me: (PublicEntry & { rank: number }) | null;
  total: number;
  top: PublicEntry[];
  /** 積分和我最接近的幾台 */
  rivals: PublicEntry[];
}

export interface FightResult {
  seed: number;
  attacker: RobotSetup;
  defender: RobotSetup;
  defenderId: string;
  /** 0 = 挑戰者贏，1 = 守擂的贏，-1 = 平手 */
  winner: number;
  /** 挑戰者的積分：打之前、打之後 */
  before: number;
  after: number;
}

/** Elo：score 是 a 的得分（贏 1、平 0.5、輸 0），回傳兩邊的新積分 */
export function elo(a: number, b: number, score: number): [number, number] {
  const expect = 1 / (1 + Math.pow(10, (b - a) / 400));
  const d = Math.round(K * (score - expect));
  return [a + d, b - d];
}

/** 聯盟剛開張：先放五個天梯對手和十台隨機機器人，才有人可以打 */
export function newLeague(): LeagueData {
  const entries: Entry[] = [];
  const add = (setup: RobotSetup, rating: number): void => {
    entries.push({ id: 'b' + entries.length, setup, rating, wins: 0, losses: 0, bot: true });
  };
  LADDER.forEach((o, i) => add(o.setup, 850 + i * 90));
  const names = ['螺絲', '焊槍', '保險絲', '齒輪', '電容', '活塞', '軸承', '彈簧', '繼電器', '散熱片'];
  names.forEach((n, i) => add(randomBot(7001 + i * 131, `BOT-${String(i + 1).padStart(2, '0')} ${n}`), 900 + ((i * 37) % 200)));
  return { entries, tokens: {}, nextId: 1, fights: 0 };
}

function pub(e: Entry): PublicEntry {
  return { id: e.id, name: e.setup.name, rating: e.rating, wins: e.wins, losses: e.losses, brain: e.setup.brain, gear: e.setup.gear, bot: e.bot };
}

function validToken(token: unknown): token is string {
  return typeof token === 'string' && /^[a-z0-9]{16,64}$/.test(token);
}

/** 登錄（或更新）守擂機器人。積分和戰績會留著。 */
export function enter(data: LeagueData, token: unknown, rawSetup: unknown): Entry | null {
  if (!validToken(token)) return null;
  const setup = cleanSetup(rawSetup, '無名機器人');
  let entry = data.entries.find((e) => e.id === data.tokens[token]);
  if (!entry) {
    entry = { id: 'p' + data.nextId++, setup, rating: START_RATING, wins: 0, losses: 0, bot: false };
    data.entries.push(entry);
    data.tokens[token] = entry.id;
  } else entry.setup = setup;
  return entry;
}

export function board(data: LeagueData, token: unknown): Board {
  const sorted = [...data.entries].sort((a, b) => b.rating - a.rating || (a.id < b.id ? -1 : 1));
  const mine = validToken(token) ? sorted.find((e) => e.id === data.tokens[token]) : undefined;
  const center = mine ? mine.rating : START_RATING;
  const rivals = sorted
    .filter((e) => e !== mine)
    .sort((a, b) => Math.abs(a.rating - center) - Math.abs(b.rating - center) || (a.id < b.id ? -1 : 1))
    .slice(0, 6)
    .sort((a, b) => b.rating - a.rating);
  return {
    me: mine ? { ...pub(mine), rank: sorted.indexOf(mine) + 1 } : null,
    total: sorted.length,
    top: sorted.slice(0, 10).map(pub),
    rivals: rivals.map(pub),
  };
}

/**
 * 挑戰一台守擂機器人。挑戰者用現在這台（rawSetup，清洗過）去打；種子由伺服器決定。
 * 伺服器自己把這一場跑完，照結果改兩邊的積分。
 */
export function fight(data: LeagueData, token: unknown, defenderId: unknown, rawSetup: unknown, seed: number): FightResult | null {
  if (!validToken(token)) return null;
  const me = data.entries.find((e) => e.id === data.tokens[token]);
  const foe = data.entries.find((e) => e.id === defenderId);
  if (!me || !foe || me === foe) return null;
  const attacker = cleanSetup(rawSetup, me.setup.name);
  const winner = runToEnd(createMatch(seed >>> 0, [attacker, foe.setup])).winner ?? -1;
  const before = me.rating;
  const [a, b] = elo(me.rating, foe.rating, winner === 0 ? 1 : winner === 1 ? 0 : 0.5);
  me.rating = a;
  foe.rating = b;
  if (winner === 0) {
    me.wins++;
    foe.losses++;
  } else if (winner === 1) {
    me.losses++;
    foe.wins++;
  }
  data.fights++;
  return { seed: seed >>> 0, attacker, defender: foe.setup, defenderId: foe.id, winner, before, after: a };
}

/** 一個請求進來：照路徑分給上面的函式。回傳 null 表示請求不合法。 */
export function handle(data: LeagueData, action: string, body: Record<string, unknown>, seed: number): unknown {
  switch (action) {
    case 'enter': {
      const e = enter(data, body.token, body.setup);
      return e ? board(data, body.token) : null;
    }
    case 'board':
      return board(data, body.token);
    case 'fight': {
      const r = fight(data, body.token, body.defender, body.setup, seed);
      return r ? { result: r, board: board(data, body.token) } : null;
    }
    default:
      return null;
  }
}
