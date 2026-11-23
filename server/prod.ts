/**
 * 正式伺服器：一支 Node 程式，送出打包好的遊戲（dist/），並提供聯盟 API（/api/league）。
 * 聯盟的規則全部在 `src/sim/league.ts`，這裡只做「讀資料 → handle() → 存資料」和用量控管。
 * 不依賴任何套件。資料是一個 JSON 檔，放在 DATA_DIR（Railway 上指到 Volume）。
 *
 * 用量控管（都可以用環境變數調，見 LIMITS）：
 *  - 每個 IP 每分鐘的請求數、每個玩家每天的挑戰數、同一個對手每天能打幾次
 *  - 每個 IP 每天能新登錄幾台、整個聯盟最多幾台
 *  - 全站每天最多算幾場（超過就回 429，隔天恢復）——這是花費的總開關
 */
import { randomInt } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, relative } from 'node:path';
import { gzipSync } from 'node:zlib';
import { handle, newLeague, type LeagueData } from '../src/sim/league';

function env(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

const PORT = env('PORT', 3000);
const DIST = process.env.DIST_DIR ?? 'dist';
const DATA_DIR = process.env.DATA_DIR ?? 'data';
const DATA_FILE = join(DATA_DIR, 'league.json');
/** 一個請求最大多少位元組（一台機器人的設定遠小於這個） */
const MAX_BODY = 16 * 1024;

const LIMITS = {
  /** 每個 IP 每分鐘最多幾個聯盟請求 */
  perMinute: env('LIMIT_PER_MINUTE', 40),
  /** 每個玩家每天最多挑戰幾場 */
  fightsPerDay: env('LIMIT_FIGHTS_PER_DAY', 60),
  /** 同一個對手每天最多打幾次（防止找一台弱的一直刷積分） */
  sameFoePerDay: env('LIMIT_SAME_FOE_PER_DAY', 3),
  /** 每個 IP 每天最多新登錄幾台守擂機器人 */
  signupsPerDay: env('LIMIT_SIGNUPS_PER_DAY', 5),
  /** 整個聯盟最多幾台（含系統放的） */
  maxEntries: env('LIMIT_MAX_ENTRIES', 5000),
  /** 全站每天最多算幾場：花費的總開關 */
  globalFightsPerDay: env('LIMIT_GLOBAL_FIGHTS_PER_DAY', 20000),
};

// ---------------------------------------------------------------- 資料
function load(): LeagueData {
  try {
    if (existsSync(DATA_FILE)) return JSON.parse(readFileSync(DATA_FILE, 'utf8')) as LeagueData;
  } catch (err) {
    // 檔案壞了：留一份起來，重開一個聯盟
    console.error('league data unreadable, starting fresh', err);
    try {
      renameSync(DATA_FILE, `${DATA_FILE}.broken-${Date.now()}`);
    } catch {
      // 連改名都不行就算了
    }
  }
  return newLeague();
}

mkdirSync(DATA_DIR, { recursive: true });
const data = load();
let dirty = false;

/** 存檔：先寫到暫存檔再改名，寫到一半當機也不會留下半個檔案 */
function flush(): void {
  if (!dirty) return;
  dirty = false;
  try {
    const tmp = `${DATA_FILE}.tmp`;
    writeFileSync(tmp, JSON.stringify(data));
    renameSync(tmp, DATA_FILE);
  } catch (err) {
    dirty = true;
    console.error('league save failed', err);
  }
}
// 有改動的話每兩秒存一次（不是每個請求都寫硬碟）；關機前再存一次
setInterval(flush, 2000).unref();
for (const sig of ['SIGTERM', 'SIGINT'] as const)
  process.on(sig, () => {
    flush();
    process.exit(0);
  });

// ---------------------------------------------------------------- 用量控管
/** 計數器：key → 次數。到期整張清掉；筆數有上限，記憶體不會被塞爆。 */
class Counter {
  private map = new Map<string, number>();
  private resetAt = 0;
  constructor(
    private windowMs: number,
    private maxKeys = 50000,
  ) {}
  private roll(): void {
    const now = Date.now();
    if (now >= this.resetAt) {
      this.map.clear();
      this.resetAt = now + this.windowMs;
    }
  }
  get(key: string): number {
    this.roll();
    return this.map.get(key) ?? 0;
  }
  /** 加一。筆數滿了就當作已經超量（寧可擋掉，也不讓記憶體長大） */
  add(key: string): void {
    this.roll();
    if (!this.map.has(key) && this.map.size >= this.maxKeys) return;
    this.map.set(key, (this.map.get(key) ?? 0) + 1);
  }
  get full(): boolean {
    return this.map.size >= this.maxKeys;
  }
}

const DAY = 86400000;
const perMinute = new Counter(60000);
const fightsToday = new Counter(DAY);
const sameFoeToday = new Counter(DAY);
const signupsToday = new Counter(DAY);
const globalToday = new Counter(DAY, 1);

/** 玩家的 IP。Railway 的代理會把真正的來源放在 X-Real-IP；沒有的話用連線本身的位址。 */
function ipOf(req: IncomingMessage): string {
  const real = req.headers['x-real-ip'];
  if (typeof real === 'string' && real) return real;
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd) return fwd.split(',').pop()!.trim();
  return req.socket.remoteAddress ?? 'unknown';
}

/** 這個請求可不可以做。回傳字串就是擋下來的原因。 */
function refuse(action: string, body: Record<string, unknown>, ip: string): string | null {
  if (perMinute.get(ip) >= LIMITS.perMinute || perMinute.full) return '請求太頻繁，請稍等一分鐘。';
  perMinute.add(ip);
  const token = typeof body.token === 'string' ? body.token : '';
  if (action === 'fight') {
    if (globalToday.get('all') >= LIMITS.globalFightsPerDay) return '今天聯盟的場次已經滿了，明天再來。';
    if (fightsToday.get(token) >= LIMITS.fightsPerDay || fightsToday.full) return `今天的挑戰次數用完了（每天 ${LIMITS.fightsPerDay} 場）。`;
    const pair = `${token}|${String(body.defender)}`;
    if (sameFoeToday.get(pair) >= LIMITS.sameFoePerDay || sameFoeToday.full) return `同一個對手每天只能挑戰 ${LIMITS.sameFoePerDay} 次，換一個對手吧。`;
  }
  if (action === 'enter' && !(token in data.tokens)) {
    if (data.entries.length >= LIMITS.maxEntries) return '聯盟已經額滿，暫時不能登錄新的機器人。';
    if (signupsToday.get(ip) >= LIMITS.signupsPerDay || signupsToday.full) return '今天從這個網路登錄的機器人太多了，明天再來。';
  }
  return null;
}

/** 做成功之後記帳 */
function count(action: string, body: Record<string, unknown>, ip: string, isNew: boolean): void {
  const token = String(body.token);
  if (action === 'fight') {
    globalToday.add('all');
    fightsToday.add(token);
    sameFoeToday.add(`${token}|${String(body.defender)}`);
  }
  if (action === 'enter' && isNew) signupsToday.add(ip);
}

// ---------------------------------------------------------------- 聯盟 API
function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    // 遊戲放在別的網站（CrazyGames、Poki）時也要連得到
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  });
  res.end(status === 204 ? undefined : JSON.stringify(body));
}

function league(req: IncomingMessage, res: ServerResponse, action: string): void {
  if (req.method === 'OPTIONS') return send(res, 204, null);
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
  let raw = '';
  let size = 0;
  req.on('data', (chunk: Buffer) => {
    size += chunk.length;
    if (size > MAX_BODY) {
      send(res, 413, { error: 'too large' });
      req.destroy();
      return;
    }
    raw += chunk.toString('utf8');
  });
  req.on('end', () => {
    if (size > MAX_BODY) return;
    try {
      const body = JSON.parse(raw || '{}') as Record<string, unknown>;
      const ip = ipOf(req);
      const why = refuse(action, body, ip);
      if (why) return send(res, 429, { error: why });
      const isNew = action === 'enter' && !(String(body.token) in data.tokens);
      const out = handle(data, action, body, randomInt(0, 2 ** 32));
      if (out === null) return send(res, 400, { error: 'bad request' });
      count(action, body, ip, isNew);
      if (action !== 'board') dirty = true;
      send(res, 200, out);
    } catch {
      send(res, 400, { error: 'bad request' });
    }
  });
}

// ---------------------------------------------------------------- 靜態檔
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
};

interface Asset {
  type: string;
  raw: Buffer;
  /** 壓縮過的版本（文字檔才有）：流量算錢，能小就小 */
  gz: Buffer | null;
  /** 檔名帶雜湊的可以讓瀏覽器永久快取，之後就不會再來要 */
  cache: string;
}

/** 開機時把 dist/ 整個讀進記憶體（總共不到 1 MB），之後不碰硬碟 */
function loadAssets(dir: string): Map<string, Asset> {
  const out = new Map<string, Asset>();
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) {
        walk(p);
        continue;
      }
      const ext = extname(name);
      const raw = readFileSync(p);
      const text = /^(text\/|application\/json|image\/svg)/.test(TYPES[ext] ?? '');
      const url = '/' + relative(dir, p).split('\\').join('/');
      out.set(url, {
        type: TYPES[ext] ?? 'application/octet-stream',
        raw,
        gz: text && raw.length > 512 ? gzipSync(raw, { level: 9 }) : null,
        cache: url.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'public, max-age=300',
      });
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}

const assets = loadAssets(DIST);

function serve(req: IncomingMessage, res: ServerResponse, path: string): void {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }
  const a = assets.get(path === '/' ? '/index.html' : path);
  if (!a) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('not found');
    return;
  }
  const gz = a.gz !== null && String(req.headers['accept-encoding'] ?? '').includes('gzip');
  const body = gz ? a.gz! : a.raw;
  res.writeHead(200, {
    'Content-Type': a.type,
    'Content-Length': body.length,
    'Cache-Control': a.cache,
    Vary: 'Accept-Encoding',
    ...(gz ? { 'Content-Encoding': 'gzip' } : {}),
  });
  res.end(req.method === 'HEAD' ? undefined : body);
}

// ---------------------------------------------------------------- 啟動
const server = createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0];
  if (path === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok');
    return;
  }
  if (path.startsWith('/api/league/')) return league(req, res, path.slice('/api/league/'.length));
  serve(req, res, path);
});
// 慢慢送的連線不讓它一直掛著
server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.keepAliveTimeout = 5000;
server.listen(PORT, () => {
  console.log(`prompt-cage listening on :${PORT} · ${assets.size} files · ${data.entries.length} league entries · data in ${DATA_FILE}`);
  if (assets.size === 0) console.warn(`no files in ${DIST}/ — run "npm run build" first`);
});
