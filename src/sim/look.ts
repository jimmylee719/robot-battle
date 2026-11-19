/**
 * 機器人的外觀：烤漆、配色、發光顏色、頭型、塗裝。
 * 純裝飾：不花出場額度、不進戰鬥邏輯。放在這裡只是因為它跟著 RobotSetup 一起存檔、一起進分享連結，
 * 而連結可以被人手改，所以解開之後要清洗（只留認得的選項）。
 */

export interface Look {
  /** 身體的烤漆 */
  paint: string;
  /** 手腳和塗裝用的第二個顏色 */
  trim: string;
  /** 護目鏡和核心的發光顏色 */
  glow: string;
  head: string;
  pattern: string;
}

export interface Swatch {
  name: string;
  hex: string;
}

export const PAINTS: Record<string, Swatch> = {
  red: { name: '競技紅', hex: '#d8433a' },
  orange: { name: '袈裟橘', hex: '#e07a2c' },
  yellow: { name: '工程黃', hex: '#e2b52e' },
  green: { name: '電路綠', hex: '#4fae52' },
  teal: { name: '青瓷', hex: '#2fa39b' },
  blue: { name: '競技藍', hex: '#3a7bd8' },
  purple: { name: '霓虹紫', hex: '#8a55d6' },
  pink: { name: '泡泡糖', hex: '#e060a8' },
  white: { name: '骨白', hex: '#e4e1d6' },
  grey: { name: '鐵灰', hex: '#7a8496' },
  black: { name: '消光黑', hex: '#343a48' },
  rust: { name: '鏽鐵', hex: '#9a5a34' },
};

export const GLOWS: Record<string, Swatch> = {
  cyan: { name: '冷光藍', hex: '#5ef2ff' },
  amber: { name: '琥珀', hex: '#ffc94d' },
  red: { name: '警示紅', hex: '#ff4d5e' },
  green: { name: '終端機綠', hex: '#6dff7a' },
  magenta: { name: '洋紅', hex: '#ff6df0' },
  white: { name: '白光', hex: '#ffffff' },
};

export const HEADS: Record<string, string> = {
  helmet: '標準頭盔',
  mono: '獨眼',
  crest: '鬥雞冠',
  box: '螢幕頭',
  horns: '雙角',
};

export const PATTERNS: Record<string, string> = {
  plain: '素色',
  stripe: '賽車條紋',
  split: '左右雙色',
  hazard: '警示腰帶',
};

export const DEFAULT_LOOK: Look = { paint: 'red', trim: 'black', glow: 'cyan', head: 'helmet', pattern: 'plain' };

function pick<T>(table: Record<string, T>, raw: unknown, fallback: string): string {
  return typeof raw === 'string' && Object.prototype.hasOwnProperty.call(table, raw) ? raw : fallback;
}

/** 清洗外觀。不是物件就回傳 undefined（用角落的預設配色）。 */
export function cleanLook(raw: unknown): Look | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  return {
    paint: pick(PAINTS, r.paint, DEFAULT_LOOK.paint),
    trim: pick(PAINTS, r.trim, DEFAULT_LOOK.trim),
    glow: pick(GLOWS, r.glow, DEFAULT_LOOK.glow),
    head: pick(HEADS, r.head, DEFAULT_LOOK.head),
    pattern: pick(PATTERNS, r.pattern, DEFAULT_LOOK.pattern),
  };
}

/** 隨機一套外觀。rand 給 0..1 的數（設定畫面用 Math.random 就好，這不影響戰鬥）。 */
export function randomLook(rand: () => number): Look {
  const any = (table: Record<string, unknown>): string => {
    const keys = Object.keys(table);
    return keys[Math.floor(rand() * keys.length) % keys.length];
  };
  const paint = any(PAINTS);
  let trim = any(PAINTS);
  if (trim === paint) trim = paint === 'black' ? 'white' : 'black';
  return { paint, trim, glow: any(GLOWS), head: any(HEADS), pattern: any(PATTERNS) };
}
