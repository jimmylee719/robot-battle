/**
 * 開發用的聯盟伺服器：掛在 Vite 的開發伺服器上（`npm run dev` 就有），資料存成專案裡的一個 JSON 檔。
 * 規則全部在 `src/sim/league.ts`（純邏輯）。正式上線時換成真正的後端，只要做同樣三件事：
 * 讀資料 → 呼叫 handle() → 存資料。
 */
import { randomInt } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { Plugin } from 'vite';
import { handle, newLeague, type LeagueData } from '../src/sim/league';

const FILE = 'league-data.local';
/** 一個請求最大多少位元組（一台機器人的設定遠小於這個） */
const MAX_BODY = 16 * 1024;

function load(): LeagueData {
  try {
    if (existsSync(FILE)) return JSON.parse(readFileSync(FILE, 'utf8')) as LeagueData;
  } catch {
    // 檔案壞了就重開一個聯盟
  }
  return newLeague();
}

export function devLeague(): Plugin {
  let data: LeagueData | null = null;
  return {
    name: 'prompt-cage-dev-league',
    configureServer(server) {
      server.middlewares.use('/api/league', (req, res) => {
        const send = (status: number, body: unknown): void => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(body));
        };
        if (req.method !== 'POST') return send(405, { error: 'POST only' });
        let raw = '';
        let tooBig = false;
        req.on('data', (chunk: Buffer) => {
          raw += chunk.toString('utf8');
          if (raw.length > MAX_BODY) tooBig = true;
        });
        req.on('end', () => {
          if (tooBig) return send(413, { error: 'too large' });
          try {
            data ??= load();
            const body = JSON.parse(raw || '{}') as Record<string, unknown>;
            const action = (req.url ?? '').replace(/^\//, '').split('?')[0];
            const out = handle(data, action, body, randomInt(0, 2 ** 32));
            if (out === null) return send(400, { error: 'bad request' });
            if (action !== 'board') writeFileSync(FILE, JSON.stringify(data));
            send(200, out);
          } catch {
            send(400, { error: 'bad request' });
          }
        });
      });
    },
  };
}
