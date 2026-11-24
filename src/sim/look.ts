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
  /** 表面處理：消光、亮面、電鍍 */
  finish: string;
  /** 拳套（和武器握把）的顏色 */
  glove: string;
  /** 配件：肩甲樣式、臉（護目鏡）、背上、胸前 */
  shoulder: string;
  face: string;
  back: string;
  chest: string;
  /** 戰損：全新、刮痕、鏽斑、裂痕 */
  wear: string;
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
  crimson: { name: '酒紅', hex: '#9c2442' },
  gold: { name: '冠軍金', hex: '#d9a93a' },
  mint: { name: '薄荷', hex: '#7ee8c4' },
  sky: { name: '天空藍', hex: '#7fc4ff' },
  navy: { name: '海軍藍', hex: '#2a3f7a' },
  olive: { name: '軍綠', hex: '#6b7a3a' },
  sand: { name: '沙漠', hex: '#c9a86a' },
  lav: { name: '薰衣草', hex: '#b9a4ff' },
  coral: { name: '珊瑚', hex: '#ff8a76' },
  silver: { name: '亮銀', hex: '#c4ccd8' },
  forest: { name: '森林綠', hex: '#2f6b47' },
  ice: { name: '冰藍', hex: '#a8e4f0' },
};

export const GLOWS: Record<string, Swatch> = {
  cyan: { name: '冷光藍', hex: '#5ef2ff' },
  amber: { name: '琥珀', hex: '#ffc94d' },
  red: { name: '警示紅', hex: '#ff4d5e' },
  green: { name: '終端機綠', hex: '#6dff7a' },
  magenta: { name: '洋紅', hex: '#ff6df0' },
  white: { name: '白光', hex: '#ffffff' },
  orange: { name: '熔岩橘', hex: '#ff8a3c' },
  violet: { name: '紫外線', hex: '#a46dff' },
  lime: { name: '螢光黃綠', hex: '#d4ff4d' },
  pink: { name: '櫻花粉', hex: '#ffa6d6' },
  ice: { name: '冰晶', hex: '#c8f6ff' },
};

export const FINISHES: Record<string, string> = {
  matte: '消光',
  gloss: '亮面',
  chrome: '電鍍',
};

export const SHOULDERS: Record<string, string> = {
  plate: '標準肩甲',
  round: '圓弧肩甲',
  spiked: '尖刺肩甲',
  tall: '高聳肩甲',
  bare: '不裝肩甲',
  shield: '大盾肩',
  layered: '多層甲片',
};

export const FACES: Record<string, string> = {
  visor: '橫條護目鏡',
  eyes: '雙眼',
  slit: '細縫',
  mask: '面罩',
  cross: 'T 字護目鏡',
  triple: '三眼',
};

export const BACKS: Record<string, string> = {
  none: '只有推進器',
  cape: '披風',
  wings: '機翼',
  banner: '背旗',
  pipes: '排氣管',
  tank: '能源槽',
  blades: '背雙刀',
  jetpack: '雙筒噴射',
  halo: '光環',
};

export const CHESTS: Record<string, string> = {
  none: '無',
  emblem: '星形徽章',
  vent: '散熱格柵',
  number: '號碼牌',
  belt: '冠軍腰帶',
  reactor: '反應爐',
  straps: '交叉皮帶',
};

export const HEADS: Record<string, string> = {
  helmet: '標準頭盔',
  mono: '獨眼',
  crest: '鬥雞冠',
  box: '螢幕頭',
  horns: '雙角',
  samurai: '武士盔',
  dome: '玻璃腦艙',
  antenna: '雷達天線',
  skull: '骷髏',
};

export const PATTERNS: Record<string, string> = {
  plain: '素色',
  stripe: '賽車條紋',
  split: '左右雙色',
  hazard: '警示腰帶',
  camo: '迷彩',
  flame: '火焰',
  checker: '格子旗',
  tiger: '虎紋',
};

export const WEARS: Record<string, string> = {
  clean: '全新',
  scuffed: '刮痕',
  rusty: '鏽斑',
  battle: '戰損裂痕',
};

export const DEFAULT_LOOK: Look = {
  paint: 'red',
  trim: 'black',
  glow: 'cyan',
  head: 'helmet',
  pattern: 'plain',
  finish: 'matte',
  glove: 'white',
  shoulder: 'plate',
  face: 'visor',
  back: 'none',
  chest: 'none',
  wear: 'clean',
};

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
    finish: pick(FINISHES, r.finish, DEFAULT_LOOK.finish),
    glove: pick(PAINTS, r.glove, DEFAULT_LOOK.glove),
    shoulder: pick(SHOULDERS, r.shoulder, DEFAULT_LOOK.shoulder),
    face: pick(FACES, r.face, DEFAULT_LOOK.face),
    back: pick(BACKS, r.back, DEFAULT_LOOK.back),
    chest: pick(CHESTS, r.chest, DEFAULT_LOOK.chest),
    wear: pick(WEARS, r.wear, DEFAULT_LOOK.wear),
  };
}

/** 主題套裝：一鍵換整套外型（名字自己留著） */
export interface LookTheme {
  name: string;
  look: Look;
}

const L = (paint: string, trim: string, glow: string, head: string, pattern: string, finish: string, glove: string, face: string, shoulder: string, back: string, chest: string, wear: string): Look => ({
  paint, trim, glow, head, pattern, finish, glove, face, shoulder, back, chest, wear,
});

export const LOOK_THEMES: Record<string, LookTheme> = {
  samurai: { name: '⚔️ 武士', look: L('crimson', 'black', 'amber', 'samurai', 'plain', 'gloss', 'gold', 'slit', 'layered', 'blades', 'straps', 'scuffed') },
  racer: { name: '🏁 賽車', look: L('yellow', 'black', 'cyan', 'helmet', 'checker', 'gloss', 'black', 'visor', 'round', 'jetpack', 'number', 'clean') },
  wasteland: { name: '🏜️ 廢土', look: L('rust', 'sand', 'orange', 'skull', 'hazard', 'matte', 'olive', 'mask', 'spiked', 'pipes', 'vent', 'rusty') },
  paladin: { name: '🛡️ 聖騎士', look: L('white', 'gold', 'white', 'crest', 'stripe', 'chrome', 'gold', 'cross', 'shield', 'halo', 'emblem', 'clean') },
  commando: { name: '🎖️ 特攻隊', look: L('olive', 'forest', 'green', 'antenna', 'camo', 'matte', 'black', 'eyes', 'plate', 'tank', 'straps', 'battle') },
  neon: { name: '🌃 霓虹街頭', look: L('purple', 'black', 'magenta', 'box', 'flame', 'gloss', 'pink', 'visor', 'tall', 'cape', 'reactor', 'scuffed') },
  astro: { name: '🚀 太空人', look: L('silver', 'navy', 'ice', 'dome', 'split', 'chrome', 'white', 'visor', 'round', 'wings', 'reactor', 'clean') },
  beast: { name: '🐯 猛獸', look: L('orange', 'black', 'red', 'horns', 'tiger', 'matte', 'black', 'triple', 'spiked', 'cape', 'belt', 'battle') },
};

/** 隨機一套外觀。rand 給 0..1 的數（設定畫面用 Math.random 就好，這不影響戰鬥）。 */
export function randomLook(rand: () => number): Look {
  const any = (table: Record<string, unknown>): string => {
    const keys = Object.keys(table);
    return keys[Math.floor(rand() * keys.length) % keys.length];
  };
  const paint = any(PAINTS);
  let trim = any(PAINTS);
  if (trim === paint) trim = paint === 'black' ? 'white' : 'black';
  return {
    paint,
    trim,
    glow: any(GLOWS),
    head: any(HEADS),
    pattern: any(PATTERNS),
    finish: any(FINISHES),
    glove: any(PAINTS),
    shoulder: any(SHOULDERS),
    face: any(FACES),
    back: any(BACKS),
    chest: any(CHESTS),
    wear: any(WEARS),
  };
}
