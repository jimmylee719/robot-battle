/**
 * 機器人模型。拆成一組零件（腳掌、大小腿、軀幹、頭、肩甲、上臂、前臂、手），
 * 畫面層（view/scene.ts）用骨架把它們接起來：手腳有關節，身體可以前傾、扭轉。
 * 模型的前方是 +x。武器決定手、裝甲決定軀幹、推進器決定背包的樣子。
 */
import { bake, hexToAbgr, makePalette, VoxelGrid, type PaletteEntry, type StackModel } from '../render/stack';
import type { Loadout } from '../sim/types';
import { GLOWS, PAINTS, type Look } from '../sim/look';

export interface RobotColors {
  team: string;
  teamLight: string;
  teamDark: string;
}

export const RED_TEAM: RobotColors = { team: '#d8433a', teamLight: '#f0766a', teamDark: '#8f2a2a' };
export const BLUE_TEAM: RobotColors = { team: '#3a7bd8', teamLight: '#6fa8f0', teamDark: '#274f8f' };

export interface RobotParts {
  foot: StackModel;
  /** 大腿、上臂用的一節（沿著骨頭排幾個就是一段肢體） */
  thigh: StackModel;
  shin: StackModel;
  upper: StackModel;
  fore: StackModel;
  /** 髖到肩 */
  torso: StackModel;
  head: StackModel;
  /** 肩甲 */
  pad: StackModel;
  /** 手（拳套、錘頭或矛） */
  hand: StackModel;
}

export interface RobotModels {
  normal: RobotParts;
  /** 全白版本：被打到的瞬間閃一下 */
  white: RobotParts;
  /** 仰躺在地上的整台機器人 */
  down: StackModel;
  /** 肩關節離身體中線多遠 */
  shoulderSide: number;
  /** 被打時噴出來的碎片顏色 */
  debris: number[];
}

/** 骨架尺寸（單位 = 體素）。站直時：腳底 0、髖 12、肩 21、頭頂約 30。 */
export const ROBOT_RIG = {
  hipSide: 3,
  /** 站直時髖的高度；格鬥架式會蹲低一點 */
  hipZ: 12,
  thigh: 6.5,
  shin: 6.5,
  /** 肩在髖上方多高 */
  shoulderZ: 9,
  /** 頭接在髖上方多高 */
  neckZ: 11,
  upperArm: 6.5,
  foreArm: 6.5,
  /** 胸口高度，特效用 */
  chestZ: 18,
  /** 背包高度，噴焰用 */
  torsoZ: 12,
  shadowRadius: 11,
};

/** 把顏色調亮（t > 0，往白色靠）或調暗（t < 0，往黑色靠） */
function tone(hex: string, t: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number): number => Math.round(t >= 0 ? v + (255 - v) * t : v * (1 + t));
  const r = ch((n >> 16) & 255);
  const g = ch((n >> 8) & 255);
  const b = ch(n & 255);
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}

/**
 * corner = 紅方或藍方的顏色。沒給外觀時整台都是角落的顏色；
 * 有外觀時身體照玩家選的烤漆，只有肩甲頂、護腕、腳尖留著角落的顏色，場上才分得出誰是誰。
 */
export function buildRobotModels(corner: RobotColors, gear: Loadout, look?: Look): RobotModels {
  const paint = look ? PAINTS[look.paint].hex : corner.team;
  const trimHex = look ? PAINTS[look.trim].hex : corner.teamDark;
  const glow = look ? GLOWS[look.glow].hex : '#5ef2ff';
  const colors: RobotColors = look ? { team: paint, teamLight: tone(paint, 0.3), teamDark: tone(paint, -0.38) } : corner;
  const headType = look?.head ?? 'helmet';
  const pattern = look?.pattern ?? 'plain';
  const pal = makePalette({
    team: colors.team,
    teamLight: colors.teamLight,
    teamDark: colors.teamDark,
    trim: trimHex,
    trimLight: tone(trimHex, 0.25),
    corner: corner.team,
    bone: '#e9e4d4',
    metal: '#9aa4b8',
    metalDark: '#555e70',
    black: '#1c2029',
    glove: '#e9e4d4',
    visor: { color: glow, emissive: true },
    core: { color: look ? tone(glow, 0.35) : '#ffe066', emissive: true },
    jet: { color: '#ff8a3c', emissive: true },
    beacon: { color: '#ff4d6d', emissive: true },
    hazard: '#e2a72e',
    tip: { color: glow, emissive: true },
  });
  const C = pal.id;
  const heavy = gear.armor === 'heavy';
  const medium = gear.armor === 'medium';
  const turbo = gear.thruster === 'turbo';

  // 腳掌：腳跟在後、腳尖在前，上面一小截腳踝
  const foot = new VoxelGrid(8, 4, 3);
  foot.box(0, 0, 0, 7, 3, 0, C.metalDark);
  foot.box(0, 0, 1, 5, 3, 1, C.metalDark);
  foot.box(6, 0, 1, 7, 3, 1, C.corner);
  foot.box(1, 1, 2, 3, 2, 2, C.black);

  // 肢體的一節。重型骨架的腿比較粗。
  const seg = (size: number, color: number): VoxelGrid => {
    const g = new VoxelGrid(size, size, 3);
    g.box(0, 0, 0, size - 1, size - 1, 2, color);
    return g;
  };
  const thigh = seg(heavy ? 5 : 4, C.trim);
  const shin = seg(heavy ? 4 : 3, C.metal);
  const upper = seg(3, C.trim);
  const fore = seg(3, C.metal);

  // 軀幹：骨盆、腰、胸、背包推進器（11 層高）
  const t = new VoxelGrid(16, 16, 11);
  t.box(5, 3, 0, 10, 12, 1, C.metalDark);
  t.box(6, 5, 2, 9, 10, 3, C.black);
  t.box(4, 2, 4, 11, 13, 9, C.team);
  t.box(4, 1, 8, 11, 14, 10, C.team);
  t.box(4, 1, 10, 11, 14, 10, C.teamLight);
  t.box(11, 3, 5, 11, 12, 9, C.teamLight);
  if (heavy) {
    // 重型骨架：加厚的胸甲、腰甲、寬肩
    t.box(12, 3, 5, 12, 12, 9, C.metal);
    t.box(4, 0, 8, 11, 15, 10, C.metal);
    t.box(5, 1, 10, 10, 14, 10, C.teamDark);
    t.box(4, 2, 0, 11, 13, 1, C.metalDark);
    t.box(5, 4, 2, 10, 11, 3, C.metalDark);
  }
  if (medium) {
    // 中型骨架：只多一片胸甲和腰甲
    t.box(12, 4, 6, 12, 11, 9, C.metal);
    t.box(5, 4, 2, 10, 11, 3, C.metalDark);
  }
  // 塗裝：畫在裝甲之後、核心之前
  const wide = heavy ? 0 : 1;
  if (pattern === 'stripe') {
    // 賽車條紋：從背到胸一條
    t.box(4, 7, 10, 11, 8, 10, C.trim);
    t.box(11, 7, 4, 11, 8, 9, C.trim);
    if (heavy || medium) t.box(12, 7, 6, 12, 8, 9, C.trim);
  } else if (pattern === 'split') {
    // 左右雙色：右半邊換成第二個顏色
    t.box(4, 8, 4, 11, 13, 7, C.trim);
    t.box(4, 8, 8, 11, 15 - wide, 9, C.trim);
    t.box(heavy ? 5 : 4, 8, 10, heavy ? 10 : 11, 14, 10, C.trimLight);
  } else if (pattern === 'hazard') {
    // 警示腰帶：胸口一圈黃黑相間
    for (let y = wide; y <= 15 - wide; y++)
      for (let x = 4; x <= 11; x++) {
        if (x !== 4 && x !== 11 && y !== wide && y !== 15 - wide) continue;
        t.set(x, y, 8, ((x + y) >> 1) & 1 ? C.hazard : C.black);
      }
  }
  const front = heavy || medium ? 12 : 11;
  t.box(front, 7, 6, front, 8, 7, C.core);
  if (turbo) {
    // 渦輪推進器：大背包、三個噴口、兩片尾翼
    t.box(0, 3, 3, 3, 12, 9, C.metalDark);
    t.box(0, 4, 5, 0, 5, 7, C.jet);
    t.box(0, 7, 5, 0, 8, 7, C.jet);
    t.box(0, 10, 5, 0, 11, 7, C.jet);
    t.box(1, 2, 7, 2, 2, 10, C.team);
    t.box(1, 13, 7, 2, 13, 10, C.team);
  } else {
    t.box(1, 4, 4, 3, 11, 9, C.metalDark);
    t.box(1, 5, 5, 1, 6, 6, C.jet);
    t.box(1, 9, 5, 1, 10, 6, C.jet);
  }

  // 頭：脖子、頭盔、護目鏡、天線
  const h = new VoxelGrid(8, 8, 9);
  h.box(3, 3, 0, 4, 4, 0, C.black);
  const top = heavy ? C.teamDark : C.metal;
  if (headType === 'mono') {
    // 獨眼：圓頂，正面一顆大眼睛
    h.box(1, 1, 1, 6, 6, 4, C.metal);
    h.box(2, 2, 5, 5, 5, 6, top);
    h.box(6, 2, 1, 6, 5, 4, C.black);
    h.box(6, 3, 2, 6, 4, 3, C.visor);
    h.set(3, 3, 7, C.beacon);
  } else if (headType === 'box') {
    // 螢幕頭：一台舊螢幕，兩根天線
    h.box(1, 0, 1, 6, 7, 6, C.metalDark);
    h.box(1, 0, 6, 6, 7, 6, top);
    h.box(7, 1, 2, 7, 6, 5, C.visor);
    h.set(7, 2, 4, C.black);
    h.set(7, 5, 4, C.black);
    h.box(7, 3, 2, 7, 4, 2, C.black);
    h.box(3, 1, 7, 3, 1, 7, C.metalDark);
    h.box(3, 6, 7, 3, 6, 7, C.metalDark);
    h.set(3, 1, 8, C.beacon);
    h.set(3, 6, 8, C.beacon);
  } else {
    h.box(1, 1, 1, 6, 6, 5, C.metal);
    h.box(1, 1, 5, 6, 6, 5, top);
    h.box(6, 1, 3, 6, 6, 4, C.visor);
    h.box(4, 1, 3, 6, 1, 4, C.visor);
    h.box(4, 6, 3, 6, 6, 4, C.visor);
    if (headType === 'crest') {
      // 鬥雞冠：頭頂一片鰭
      h.box(1, 3, 6, 5, 4, 7, C.team);
      h.box(2, 3, 8, 4, 4, 8, C.teamLight);
    } else if (headType === 'horns') {
      // 雙角：兩側往上、往前彎
      for (const y of [0, 7]) {
        h.box(3, y, 4, 3, y, 7, C.bone);
        h.box(4, y, 7, 5, y, 8, C.bone);
      }
    } else {
      h.box(2, 5, 6, 2, 5, 7, C.metalDark);
      h.set(2, 5, 8, C.beacon);
    }
  }
  if (pattern === 'stripe' && headType !== 'crest' && headType !== 'mono') h.box(1, 3, headType === 'box' ? 6 : 5, 6, 4, headType === 'box' ? 6 : 5, C.trim);

  // 肩甲
  const pad = new VoxelGrid(6, 6, 4);
  pad.box(0, 0, 0, 5, 5, 2, C.trim);
  pad.box(0, 0, 3, 5, 5, 3, C.corner);
  if (heavy) pad.box(1, 1, 3, 4, 4, 3, C.metal);

  // 手：武器不同，大小不同。握在手腕的位置是 handPivot。
  let hand: VoxelGrid;
  let handPivotX = 2;
  if (gear.weapon === 'hammer') {
    hand = new VoxelGrid(9, 8, 6);
    handPivotX = 3;
    hand.box(0, 0, 0, 8, 7, 5, C.metalDark);
    hand.box(0, 0, 2, 8, 7, 3, C.hazard);
    hand.box(8, 1, 1, 8, 6, 4, C.metal);
    hand.box(0, 0, 5, 2, 7, 5, C.corner);
  } else if (gear.weapon === 'spear') {
    hand = new VoxelGrid(17, 5, 4);
    hand.box(0, 0, 0, 5, 4, 3, C.metalDark);
    hand.box(0, 0, 3, 1, 4, 3, C.corner);
    hand.box(5, 2, 1, 14, 2, 2, C.metal);
    hand.box(15, 2, 1, 16, 2, 2, C.tip);
    hand.box(14, 1, 1, 14, 3, 2, C.tip);
  } else {
    hand = new VoxelGrid(6, 5, 4);
    hand.box(0, 0, 0, 5, 4, 3, C.glove);
    hand.box(0, 0, 0, 1, 4, 3, C.corner);
  }

  const shoulderSide = heavy ? 9.5 : 8.5;
  const bakeParts = (entries: readonly PaletteEntry[]): RobotParts => ({
    foot: bake(foot, entries, { pivotX: 3 }),
    thigh: bake(thigh, entries),
    shin: bake(shin, entries),
    upper: bake(upper, entries),
    fore: bake(fore, entries),
    torso: bake(t, entries),
    head: bake(h, entries),
    pad: bake(pad, entries),
    hand: bake(hand, entries, { pivotX: handPivotX }),
  });

  // 倒地：先把零件組成一台站直的機器人，再整台往後放倒
  // （站姿的「上」變成躺姿的「後」，「前」變成「上」）
  const R = ROBOT_RIG;
  const standing = new VoxelGrid(22, 32, 32);
  const cy = 16;
  for (const side of [-1, 1]) {
    const ly = cy + side * R.hipSide;
    standing.blit(foot, 5, Math.round(ly - 2), 0);
    standing.box(8, Math.round(ly - 1.5), 2, 10, Math.round(ly + 0.5), 6, C.metal);
    standing.box(7, Math.round(ly - 2), 7, 10, Math.round(ly + 1), R.hipZ - 1, C.trim);
    // 手臂攤開一點
    const ay = Math.round(cy + side * (shoulderSide + 3));
    standing.box(8, ay - 1, R.hipZ + 1, 10, ay + 1, R.hipZ + 8, C.metal);
    standing.blit(pad, 6, ay - 3, R.hipZ + R.shoulderZ - 1);
    standing.blit(hand, 7, ay - 2, R.hipZ - 4);
  }
  standing.blit(t, 1, cy - 8, R.hipZ);
  standing.blit(h, 5, cy - 4, R.hipZ + R.neckZ);
  const lying = new VoxelGrid(standing.d, standing.h, standing.w);
  for (let z = 0; z < standing.d; z++)
    for (let y = 0; y < standing.h; y++)
      for (let x = 0; x < standing.w; x++) lying.set(standing.d - 1 - z, y, x, standing.get(x, y, z));

  return {
    normal: bakeParts(pal.entries),
    white: bakeParts(pal.entries.map(() => ({ color: '#ffffff', emissive: true }))),
    down: bake(lying, pal.entries, { pivotX: standing.d - 6 }),
    shoulderSide,
    debris: [colors.team, trimHex, '#9aa4b8', '#555e70'].map((c) => hexToAbgr(c)),
  };
}
