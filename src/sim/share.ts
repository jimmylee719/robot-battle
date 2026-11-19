/**
 * 重播分享：一場對戰完全由「種子 + 兩邊的設定」決定，所以把這些包成一段字串放進連結，
 * 朋友打開就能在自己的電腦上重跑出一模一樣的一場。
 *
 * 連結裡的東西可以被人手改，所以解開之後一律清洗過才用（照 Godot 版的 clean_build）：
 * 只留認得的零件和卡、名字截短、超出預算就換成最便宜的大腦、自訓模型的價格重新算。
 * 手改連結做不出比規則允許更強的機器人。
 */
import { BRAINS, legalDeck, type BrainId } from './cards';
import { cleanGear, withinBudget } from './gear';
import type { RobotSetup } from './match';
import { cleanSnapshot } from './model';
import { cleanTemper } from './temper';

/** 格式版本。戰鬥規則有改、舊連結重跑會不一樣時要加一。 */
const VERSION = 3;
const NAME_MAX = 28;

export interface Replay {
  seed: number;
  setups: [RobotSetup, RobotSetup];
  /** 原本那場打完的狀態指紋；重跑完對不上就表示版本不同 */
  hash: number | null;
}

function cleanName(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback;
  // 拿掉控制字元和頭尾空白，截短
  const s = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, NAME_MAX);
  return s || fallback;
}

export function cleanSetup(raw: unknown, fallbackName: string): RobotSetup {
  const r = (raw ?? {}) as Record<string, unknown>;
  const gear = cleanGear(r.gear as never);
  let brain: BrainId = typeof r.brain === 'string' && r.brain in BRAINS ? (r.brain as BrainId) : 'potato';
  const model = brain === 'trained' ? cleanSnapshot(r.model) : undefined;
  // 超出預算：換成最便宜的大腦
  if (!withinBudget(gear, brain, model ?? null)) brain = 'potato';
  const deck = legalDeck(Array.isArray(r.deck) ? r.deck.map(String) : [], brain);
  const setup: RobotSetup = { name: cleanName(r.name, fallbackName), gear, brain, deck, temper: cleanTemper(r.temper) };
  if (brain === 'trained' && model) setup.model = model;
  return setup;
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(code: string): string {
  const bin = atob(code.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** 重播 → 可以放進連結的字串 */
export function encodeReplay(r: Replay): string {
  return toBase64Url(JSON.stringify({ v: VERSION, s: r.seed, a: r.setups[0], b: r.setups[1], h: r.hash }));
}

/** 連結裡的字串 → 重播。看不懂或版本不對就回傳 null。 */
export function decodeReplay(code: string): Replay | null {
  try {
    const d = JSON.parse(fromBase64Url(code)) as Record<string, unknown>;
    if (d.v !== VERSION) return null;
    const seed = Number(d.s);
    if (!Number.isFinite(seed)) return null;
    const hash = Number(d.h);
    return {
      seed: seed >>> 0,
      setups: [cleanSetup(d.a, '紅方'), cleanSetup(d.b, '藍方')],
      hash: d.h === null || !Number.isFinite(hash) ? null : hash >>> 0,
    };
  } catch {
    return null;
  }
}
