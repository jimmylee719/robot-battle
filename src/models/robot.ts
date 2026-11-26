/**
 * 機器人模型。拆成一組零件（腳掌、大小腿、軀幹、頭、肩甲、上臂、前臂、手），
 * 畫面層（view/scene.ts）用骨架把它們接起來：手腳有關節，身體可以前傾、扭轉。
 * 模型的前方是 +x。武器決定手、裝甲決定軀幹、推進器決定背包的樣子。
 */
import { bake, hexToAbgr, makePalette, pitchGrid, VoxelGrid, type PaletteEntry, type StackModel } from '../render/stack';
import type { Loadout } from '../sim/types';
import { GLOWS, PAINTS, type Look } from '../sim/look';
import { plateOf } from '../sim/gear';

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

/** 前傾／後仰的角度間隔，從 -90° 到 +90° */
export const PITCH_STEP = Math.PI / 12;
export const PITCH_COUNT = 13;

export interface PitchedPart {
  model: StackModel;
  /** 軸心（髖、脖子）下面還有幾層 */
  below: number;
}

export interface Pitched {
  torso: PitchedPart[];
  head: PitchedPart[];
}

export interface RobotModels {
  normal: RobotParts;
  /** 全白版本：被打到的瞬間閃一下 */
  white: RobotParts;
  /** 倒地用：軀幹和頭前傾／後仰各個角度的版本（見 PITCH_STEP） */
  pitched: Pitched;
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
  /** P21：腿比原本長 1 格（站姿的髖跟著抬高這麼多），人比較修長 */
  legExtra: 1,
  thigh: 7,
  shin: 7,
  /** 肩在髖上方多高 */
  shoulderZ: 9,
  /** 頭接在髖上方多高 */
  neckZ: 11,
  /** P21：手臂加長，直拳打出去伸得更遠、看得到拳的路線 */
  upperArm: 7,
  foreArm: 7.5,
  /** 胸口高度，特效用 */
  chestZ: 19,
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
/** 贊助商的標誌：印在機器人身上的底色和字色 */
export interface Patch {
  bg: string;
  fg: string;
}

export function buildRobotModels(corner: RobotColors, gear: Loadout, look?: Look, patches: readonly Patch[] = []): RobotModels {
  const paint = look ? PAINTS[look.paint].hex : corner.team;
  const trimHex = look ? PAINTS[look.trim].hex : corner.teamDark;
  const glow = look ? GLOWS[look.glow].hex : '#5ef2ff';
  // 表面處理：亮面的亮部更亮，電鍍連金屬件都變成亮銀色
  const finish = look?.finish ?? 'matte';
  const lightT = finish === 'chrome' ? 0.55 : finish === 'gloss' ? 0.45 : 0.3;
  const darkT = finish === 'chrome' ? -0.22 : -0.38;
  const colors: RobotColors = look ? { team: paint, teamLight: tone(paint, lightT), teamDark: tone(paint, darkT) } : corner;
  const headType = look?.head ?? 'helmet';
  const pattern = look?.pattern ?? 'plain';
  const face = look?.face ?? 'visor';
  const shoulder = look?.shoulder ?? 'plate';
  const back = look?.back ?? 'none';
  const chest = look?.chest ?? 'none';
  const gloveHex = look ? PAINTS[look.glove]?.hex ?? '#e9e4d4' : '#e9e4d4';
  const wear = look?.wear ?? 'clean';
  const pal = makePalette({
    team: colors.team,
    teamLight: colors.teamLight,
    teamDark: colors.teamDark,
    trim: trimHex,
    trimLight: tone(trimHex, 0.25),
    corner: corner.team,
    bone: '#e9e4d4',
    metal: finish === 'chrome' ? '#d3dae6' : '#9aa4b8',
    metalDark: finish === 'chrome' ? '#8a94a8' : '#555e70',
    black: '#1c2029',
    glove: gloveHex,
    gloveDark: tone(gloveHex, -0.3),
    gold: '#e2b23e',
    shine: { color: '#ffffff', emissive: false },
    visor: { color: glow, emissive: true },
    core: { color: look ? tone(glow, 0.35) : '#ffe066', emissive: true },
    jet: { color: '#ff8a3c', emissive: true },
    beacon: { color: '#ff4d6d', emissive: true },
    hazard: '#e2a72e',
    glass: '#bfe9ff',
    brain: '#ff9ec7',
    strap: '#5a3a24',
    flame: '#ff7a2e',
    flameY: '#ffd24a',
    rust: '#8a4a26',
    rust2: '#b0642e',
    ember: { color: '#ff6a2a', emissive: true },
    tip: { color: glow, emissive: true },
    p0: patches[0]?.bg ?? '#000000',
    p0f: patches[0]?.fg ?? '#000000',
    p1: patches[1]?.bg ?? '#000000',
    p1f: patches[1]?.fg ?? '#000000',
    p2: patches[2]?.bg ?? '#000000',
    p2f: patches[2]?.fg ?? '#000000',
  });
  const C = pal.id;
  /** 座標雜湊：同一台機器人每次畫出來的花紋都一樣 */
  const hash = (x: number, y: number, z: number, k: number): number =>
    ((Math.imul(x + 11, 73856093) ^ Math.imul(y + 7, 19349663) ^ Math.imul(z + 3, 83492791) ^ Math.imul(k, 2654435761)) >>> 0) % 100;
  const isPaint = (c: number): boolean => c === C.team || c === C.teamLight || c === C.teamDark;
  /** 把格子裡符合條件的體素換色 */
  const recolor = (g: VoxelGrid, fn: (c: number, x: number, y: number, z: number) => number): void => {
    for (let z = 0; z < g.d; z++)
      for (let y = 0; y < g.h; y++)
        for (let x = 0; x < g.w; x++) {
          const c = g.get(x, y, z);
          if (c) g.set(x, y, z, fn(c, x, y, z));
        }
  };
  /** 戰損：刮痕、鏽斑、裂痕（裂縫裡透出熔岩一樣的光） */
  const weather = (g: VoxelGrid, k: number): void => {
    if (wear === 'clean') return;
    recolor(g, (c, x, y, z) => {
      if (c === C.visor || c === C.core || c === C.jet || c === C.tip || c === C.beacon || c === C.glove || c === C.gloveDark || c === C.corner) return c;
      const r = hash(x, y, z, k);
      if (wear === 'scuffed') return r < 12 && (isPaint(c) || c === C.trim) ? C.teamDark === c ? C.black : C.teamDark : r < 18 && c === C.metal ? C.metalDark : c;
      if (wear === 'rusty') {
        const blob = hash(x >> 1, y >> 1, z >> 1, k + 5);
        return blob < 16 ? (r < 50 ? C.rust : C.rust2) : r < 5 ? C.rust : c;
      }
      // 裂痕
      return r < 4 ? C.ember : r < 13 && c !== C.black ? C.black : r < 20 && isPaint(c) ? C.teamDark : c;
    });
  };
  const heavy = gear.armor === 'heavy';
  const turbo = gear.thruster === 'turbo';
  // 裝甲越厚，模型上掛的甲片越多、四肢越粗（純外觀，數值在 gear.weightInfo）
  const mm = plateOf(gear);

  // 腳掌：腳跟在後、腳尖在前，上面一小截腳踝
  // P21：腳掌窄一點（3 格寬），站姿看起來比較輕巧
  const foot = new VoxelGrid(7, 3, 3);
  foot.box(0, 0, 0, 6, 2, 0, C.metalDark);
  foot.box(0, 0, 1, 4, 2, 1, C.metalDark);
  foot.box(5, 0, 1, 6, 2, 1, C.corner);
  foot.box(1, 1, 2, 2, 1, 2, C.black);

  // 肢體的一節。重型骨架的腿比較粗。
  // P21：四肢整體變細（手臂 2 格、小腿 2 格、大腿 3 格），出拳的軌跡和兩台之間的空隙才看得清楚
  const seg = (size: number, color: number): VoxelGrid => {
    const g = new VoxelGrid(size, size, 3);
    g.box(0, 0, 0, size - 1, size - 1, 2, color);
    return g;
  };
  const thigh = seg(Math.min(5, (heavy ? 4 : 3) + (mm >= 30 ? 1 : 0)), C.trim);
  // 20 mm 以上：小腿加護脛；25 mm 以上：前臂加護臂
  const shin = seg((heavy ? 3 : 2) + (mm >= 20 && !heavy ? 1 : 0), mm >= 20 ? C.metalDark : C.metal);
  const upper = seg(2, C.trim);
  const fore = seg(mm >= 25 ? 3 : 2, mm >= 25 ? C.metalDark : C.metal);

  // 軀幹：骨盆、腰、胸、背包推進器（11 層高）
  // 背旗、排氣管會伸出肩膀上面，軀幹的格子要高一點
  const tall = back === 'banner' || back === 'pipes' || back === 'blades';
  const t = new VoxelGrid(16, 16, tall ? 16 : 11);
  t.box(5, 3, 0, 10, 12, 1, C.metalDark);
  t.box(6, 5, 2, 9, 10, 3, C.black);
  t.box(4, 2, 4, 11, 13, 9, C.team);
  t.box(4, 1, 8, 11, 14, 10, C.team);
  t.box(4, 1, 10, 11, 14, 10, C.teamLight);
  t.box(11, 3, 5, 11, 12, 9, C.teamLight);
  // 裝甲甲片：照厚度一層一層加上去
  if (mm >= 10) t.box(12, mm >= 20 ? 3 : 4, mm >= 20 ? 5 : 6, 12, mm >= 20 ? 12 : 11, 9, C.metal); // 胸甲
  if (mm >= 15) t.box(5, 4, 2, 10, 11, 3, C.metalDark); // 腰甲
  if (mm >= 20) t.box(4, 0, 8, 11, 15, 10, C.metal); // 寬肩、側甲
  if (mm >= 25) t.box(5, 1, 10, 10, 14, 10, C.teamDark);
  if (mm >= 30) t.box(4, 2, 0, 11, 13, 1, C.metalDark); // 護襠
  if (mm >= 40) {
    // 40 mm：胸前再加一層、背後也包起來
    t.box(13, 4, 6, 13, 11, 8, C.metalDark);
    t.box(3, 2, 4, 3, 13, 7, C.metalDark);
  }
  const armored = mm >= 20;
  // 亮面、電鍍：肩膀上一道反光
  if (finish !== 'matte') t.box(6, armored ? 1 : 2, 10, 9, armored ? 1 : 2, 10, C.shine);
  // 塗裝：畫在裝甲之後、核心之前
  const wide = armored ? 0 : 1;
  if (pattern === 'stripe') {
    // 賽車條紋：從背到胸一條
    t.box(4, 7, 10, 11, 8, 10, C.trim);
    t.box(11, 7, 4, 11, 8, 9, C.trim);
    if (mm >= 10) t.box(12, 7, 6, 12, 8, 9, C.trim);
  } else if (pattern === 'split') {
    // 左右雙色：右半邊換成第二個顏色
    t.box(4, 8, 4, 11, 13, 7, C.trim);
    t.box(4, 8, 8, 11, 15 - wide, 9, C.trim);
    t.box(armored ? 5 : 4, 8, 10, armored ? 10 : 11, 14, 10, C.trimLight);
  } else if (pattern === 'hazard') {
    // 警示腰帶：胸口一圈黃黑相間
    for (let y = wide; y <= 15 - wide; y++)
      for (let x = 4; x <= 11; x++) {
        if (x !== 4 && x !== 11 && y !== wide && y !== 15 - wide) continue;
        t.set(x, y, 8, ((x + y) >> 1) & 1 ? C.hazard : C.black);
      }
  } else if (pattern === 'camo') {
    // 迷彩：一塊一塊的第二色和深色
    recolor(t, (c, x, y, z) => {
      if (!isPaint(c)) return c;
      const b = hash(x >> 1, y >> 1, z >> 1, 31);
      return b < 30 ? C.trim : b < 52 ? C.teamDark : c;
    });
  } else if (pattern === 'flame') {
    // 火焰：從腰往上燒，每一排高度不一樣
    recolor(t, (c, x, y, z) => {
      if (!isPaint(c)) return c;
      const top = 6 + ((Math.imul(y + x, 37) >>> 0) % 4);
      return z <= top - 2 ? C.flame : z <= top ? C.flameY : c;
    });
  } else if (pattern === 'checker') {
    // 格子旗：胸口一圈黑白方格
    recolor(t, (c, x, y, z) => (isPaint(c) && z >= 5 && z <= 8 ? ((x >> 1) + (y >> 1) + (z >> 1)) & 1 ? C.black : C.bone : c));
  } else if (pattern === 'tiger') {
    // 虎紋：歪歪的黑條紋
    recolor(t, (c, x, y, z) => (isPaint(c) && (y * 2 + z + (x >> 2)) % 5 === 0 ? C.black : c));
  }
  const front = mm >= 40 ? 13 : mm >= 10 ? 12 : 11;
  t.box(front, 7, 6, front, 8, 7, C.core);
  // 胸前配件
  if (chest === 'emblem') {
    // 星形徽章
    t.box(front, 6, 9, front, 9, 9, C.gold);
    t.box(front, 7, 8, front, 8, 10, C.gold);
    t.set(front, 7, 9, C.tip);
  } else if (chest === 'vent') {
    // 散熱格柵：胸口兩排黑色縫
    for (let y = 3; y <= 12; y += 2) {
      t.set(front, y, 9, C.black);
      t.set(front, y, 4, C.black);
    }
  } else if (chest === 'number') {
    // 號碼牌
    t.box(front, 9, 7, front, 12, 9, C.bone);
    t.set(front, 10, 8, C.black);
    t.set(front, 11, 8, C.black);
    t.set(front, 11, 7, C.black);
  } else if (chest === 'belt') {
    // 冠軍腰帶：腰上一圈金，正面一塊大扣
    t.box(5, 3, 2, 10, 12, 3, C.gold);
    t.box(11, 5, 1, 11, 10, 4, C.gold);
    t.box(11, 7, 2, 11, 8, 3, C.core);
  } else if (chest === 'reactor') {
    // 反應爐：胸口一圈發光的環，中間一顆亮點
    for (let y = 4; y <= 11; y++)
      for (let z = 4; z <= 10; z++) {
        const d = Math.hypot(y - 7.5, z - 7);
        if (d >= 2 && d < 3) t.set(front, y, z, C.metalDark);
        else if (d < 2) t.set(front, y, z, d < 1 ? C.tip : C.core);
      }
  } else if (chest === 'straps') {
    // 交叉皮帶：胸前一個 X，中間一顆金扣
    for (let i = 0; i <= 6; i++) {
      t.set(front, 4 + i, 4 + i, C.strap);
      t.set(front, 11 - i, 4 + i, C.strap);
    }
    t.box(front, 7, 7, front, 8, 7, C.gold);
  }
  // 贊助商標誌（生涯模式）：第一家印在背上（從上面最看得到），第二、三家印在胸口兩側
  const logos: [number, number][] = [
    [C.p0, C.p0f],
    [C.p1, C.p1f],
    [C.p2, C.p2f],
  ];
  patches.slice(0, 3).forEach((_, i) => {
    const [bg, fg] = logos[i];
    if (i === 0) {
      t.box(4, 5, 10, 6, 10, 10, bg);
      t.box(5, 6, 10, 5, 9, 10, fg);
    } else {
      const y0 = i === 1 ? 3 : 10;
      t.box(front, y0, 8, front, y0 + 2, 9, bg);
      t.set(front, y0 + 1, 9, fg);
    }
  });
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
  // 背上配件
  if (back === 'cape') {
    // 披風：從肩膀垂到腰，蓋住背包
    t.box(0, 2, 2, 0, 13, 10, C.trim);
    t.box(0, 3, 1, 0, 12, 1, C.trimLight);
    t.box(1, 2, 10, 1, 13, 10, C.trim);
  } else if (back === 'wings') {
    // 機翼：兩側往後上方伸出去，翼尖會發光
    for (const y of [0, 15]) {
      t.box(1, y, 6, 3, y, 10, C.team);
      t.box(0, y, 8, 0, y, 10, C.teamLight);
      t.set(0, y, 10, C.tip);
    }
  } else if (back === 'banner') {
    // 背旗：一根旗桿，旗面用第二色、中間一個發光點
    t.box(1, 13, 4, 1, 13, 15, C.metalDark);
    t.box(1, 9, 11, 1, 12, 15, C.trim);
    t.set(1, 10, 13, C.tip);
  } else if (back === 'pipes') {
    // 排氣管：兩根往上冒火
    for (const y of [3, 12]) {
      t.box(1, y, 7, 2, y, 13, C.metalDark);
      t.set(1, y, 14, C.jet);
      t.set(2, y, 14, C.jet);
    }
  } else if (back === 'tank') {
    // 能源槽：背上一個大罐子，窗口透出核心的光
    t.box(0, 5, 3, 2, 10, 10, C.metal);
    t.box(0, 6, 4, 0, 9, 9, C.metalDark);
    t.box(0, 7, 5, 0, 8, 8, C.core);
    t.box(1, 5, 10, 2, 10, 10, C.metalDark);
  } else if (back === 'jetpack') {
    // 雙筒噴射：兩根粗筒子，底下噴火
    for (const y of [4, 11]) {
      t.box(0, y - 1, 3, 1, y + 1, 10, C.metal);
      t.box(0, y - 1, 10, 1, y + 1, 10, C.team);
      t.set(0, y, 2, C.jet);
      t.set(1, y, 2, C.jet);
    }
  } else if (back === 'blades') {
    // 背雙刀：交叉插在背上，刀柄從肩膀後面冒出來
    for (let z = 3; z <= 15; z++) {
      const a = Math.round(3 + (z - 3) * 0.75);
      const b = 12 - Math.round((z - 3) * 0.75);
      const part = z >= 13 ? C.black : z === 12 ? C.gold : C.metal;
      t.set(1, Math.min(15, a), z, part);
      t.set(0, Math.max(0, b), z, part);
    }
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
    if (headType === 'skull') {
      // 骷髏：骨白的臉、兩個黑眼窩裡一點光、一排牙
      h.box(6, 1, 1, 6, 6, 5, C.bone);
      h.box(6, 2, 3, 6, 2, 4, C.black);
      h.box(6, 5, 3, 6, 5, 4, C.black);
      h.set(6, 2, 3, C.visor);
      h.set(6, 5, 3, C.visor);
      for (let y = 2; y <= 5; y++) h.set(6, y, 1, y & 1 ? C.black : C.bone);
    } else if (face === 'eyes') {
      // 雙眼：黑色面板上兩顆發光的眼睛
      h.box(6, 1, 3, 6, 6, 4, C.black);
      h.set(6, 2, 4, C.visor);
      h.set(6, 5, 4, C.visor);
    } else if (face === 'slit') {
      // 細縫：一條細細的光
      h.box(6, 1, 3, 6, 6, 3, C.black);
      h.box(6, 1, 4, 6, 6, 4, C.visor);
      h.box(4, 1, 4, 6, 1, 4, C.visor);
      h.box(4, 6, 4, 6, 6, 4, C.visor);
    } else if (face === 'cross') {
      // T 字護目鏡：一橫加一豎
      h.box(6, 1, 4, 6, 6, 4, C.visor);
      h.box(6, 3, 1, 6, 4, 4, C.visor);
      h.box(6, 1, 1, 6, 2, 3, C.black);
      h.box(6, 5, 1, 6, 6, 3, C.black);
    } else if (face === 'triple') {
      // 三眼：兩顆大眼加中間一顆
      h.box(6, 1, 2, 6, 6, 4, C.black);
      h.set(6, 1, 4, C.visor);
      h.set(6, 6, 4, C.visor);
      h.box(6, 3, 3, 6, 4, 3, C.visor);
    } else {
      h.box(6, 1, 3, 6, 6, 4, C.visor);
      h.box(4, 1, 3, 6, 1, 4, C.visor);
      h.box(4, 6, 3, 6, 6, 4, C.visor);
    }
    if (face === 'mask' && headType !== 'skull') {
      // 面罩：嘴巴的位置一片格柵
      h.box(6, 2, 1, 6, 5, 2, C.metalDark);
      h.set(6, 3, 2, C.black);
      h.set(6, 5, 2, C.black);
      h.set(6, 2, 1, C.black);
      h.set(6, 4, 1, C.black);
    }
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
    } else if (headType === 'samurai') {
      // 武士盔：寬帽簷、兩側護頰、正面金色的 V 形前立
      h.box(0, 0, 5, 7, 7, 5, C.teamDark);
      h.box(1, 1, 6, 5, 6, 6, top);
      h.box(1, 0, 2, 4, 0, 4, C.teamDark);
      h.box(1, 7, 2, 4, 7, 4, C.teamDark);
      for (const [y, z] of [[1, 8], [2, 7], [3, 6], [4, 6], [5, 7], [6, 8]]) h.set(6, y, z, C.gold);
    } else if (headType === 'dome') {
      // 玻璃腦艙：透明的圓頂，裡面一顆粉紅色的腦
      h.box(1, 1, 5, 6, 6, 5, C.metalDark);
      h.box(2, 2, 6, 5, 5, 7, C.glass);
      h.box(3, 2, 8, 4, 5, 8, C.glass);
      h.box(3, 3, 6, 4, 4, 7, C.brain);
    } else if (headType === 'antenna') {
      // 雷達天線：高天線加一面小雷達盤
      h.box(2, 5, 6, 2, 5, 8, C.metalDark);
      h.set(2, 5, 8, C.beacon);
      h.box(3, 1, 6, 3, 2, 6, C.metalDark);
      h.box(2, 0, 7, 4, 3, 8, C.metal);
      h.set(3, 1, 7, C.tip);
    } else if (back !== 'halo') {
      h.box(2, 5, 6, 2, 5, 7, C.metalDark);
      h.set(2, 5, 8, C.beacon);
    }
  }
  if (back === 'halo') {
    // 光環：頭頂上一圈發光的環（雖然算「背上」配件，畫在頭上才會跟著頭動）
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 8; x++) {
        const d = Math.hypot(x - 3.5, y - 3.5);
        if (d >= 2.6 && d < 3.6 && h.get(x, y, 8) === 0) h.set(x, y, 8, C.tip);
      }
  }
  if (pattern === 'stripe' && headType !== 'crest' && headType !== 'mono') h.box(1, 3, headType === 'box' ? 6 : 5, 6, 4, headType === 'box' ? 6 : 5, C.trim);

  // 肩甲
  // 肩甲：頂上一定是角落的顏色（紅／藍），場上才分得出誰是誰
  const pad = new VoxelGrid(6, 6, 7);
  if (shoulder === 'round') {
    pad.box(1, 0, 0, 4, 5, 2, C.trim);
    pad.box(0, 1, 0, 5, 4, 2, C.trim);
    pad.box(1, 1, 3, 4, 4, 3, C.corner);
  } else if (shoulder === 'bare') {
    pad.box(1, 1, 0, 4, 4, 1, C.metalDark);
    pad.box(2, 2, 2, 3, 3, 2, C.corner);
  } else if (shoulder === 'shield') {
    // 大盾肩：又寬又厚，金邊
    pad.box(0, 0, 0, 5, 5, 3, C.trim);
    pad.box(0, 0, 3, 5, 5, 3, C.gold);
    pad.box(1, 1, 4, 4, 4, 4, C.corner);
  } else if (shoulder === 'layered') {
    // 多層甲片：一片疊一片往上收
    pad.box(0, 0, 0, 5, 5, 1, C.trim);
    pad.box(0, 1, 2, 5, 4, 2, C.teamDark);
    pad.box(1, 1, 3, 4, 4, 4, C.trim);
    pad.box(1, 1, 5, 4, 4, 5, C.corner);
  } else if (shoulder === 'tall') {
    pad.box(0, 0, 0, 5, 5, 4, C.trim);
    pad.box(0, 0, 5, 5, 5, 5, C.corner);
    pad.box(1, 2, 6, 4, 3, 6, C.teamLight);
  } else {
    pad.box(0, 0, 0, 5, 5, 2, C.trim);
    pad.box(0, 0, 3, 5, 5, 3, C.corner);
    if (shoulder === 'spiked') {
      // 尖刺：四角各一根，中間一根長的
      for (const [x, y] of [[0, 0], [5, 0], [0, 5], [5, 5]]) pad.set(x, y, 4, C.bone);
      pad.box(2, 2, 4, 3, 3, 5, C.bone);
      pad.set(2, 2, 6, C.bone);
    }
  }
  if (mm >= 25 && shoulder !== 'bare' && shoulder !== 'round' && shoulder !== 'shield' && shoulder !== 'layered') pad.box(1, 1, shoulder === 'tall' ? 5 : 3, 4, 4, shoulder === 'tall' ? 5 : 3, C.metal);
  if (mm >= 25 && shoulder === 'round') pad.box(2, 2, 3, 3, 3, 3, C.metal);

  // 手：武器不同，大小不同。握在手腕的位置是 handPivot。
  let hand: VoxelGrid;
  let handPivotX = 2;
  if (gear.weapon === 'hammer') {
    hand = new VoxelGrid(9, 8, 6);
    handPivotX = 3;
    hand.box(0, 0, 0, 8, 7, 5, C.metalDark);
    hand.box(0, 0, 2, 8, 7, 3, C.hazard);
    hand.box(0, 2, 0, 1, 5, 1, C.glove);
    hand.box(8, 1, 1, 8, 6, 4, C.metal);
    hand.box(0, 0, 5, 2, 7, 5, C.corner);
  } else if (gear.weapon === 'spear') {
    hand = new VoxelGrid(17, 5, 4);
    hand.box(0, 0, 0, 5, 4, 3, C.metalDark);
    hand.box(2, 0, 0, 4, 4, 1, C.glove);
    hand.box(0, 0, 3, 1, 4, 3, C.corner);
    hand.box(5, 2, 1, 14, 2, 2, C.metal);
    hand.box(15, 2, 1, 16, 2, 2, C.tip);
    hand.box(14, 1, 1, 14, 3, 2, C.tip);
  } else {
    // 拳套：比前臂粗一圈就好（5×4），太大會把出拳的路線整個蓋住
    hand = new VoxelGrid(5, 4, 4);
    hand.box(0, 0, 0, 4, 3, 3, C.glove);
    hand.box(4, 0, 1, 4, 3, 2, C.gloveDark);
    hand.box(0, 0, 0, 1, 3, 3, C.corner);
  }

  weather(t, 1);
  weather(h, 2);
  weather(pad, 3);
  weather(thigh, 4);
  weather(shin, 5);
  weather(upper, 6);
  weather(fore, 7);
  weather(foot, 8);

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

  // 倒地用：軀幹繞髖、頭繞脖子，前傾和後仰每 15° 各做一個
  const pitched: Pitched = { torso: [], head: [] };
  for (let i = 0; i < PITCH_COUNT; i++) {
    const a = (i - (PITCH_COUNT - 1) / 2) * PITCH_STEP;
    const pt = pitchGrid(t, a, 8, 0, 8);
    pitched.torso.push({ model: bake(pt.grid, pal.entries, { pivotX: pt.pivotX, pivotY: pt.pivotY }), below: pt.below });
    const ph = pitchGrid(h, a, 4, 0, 4);
    pitched.head.push({ model: bake(ph.grid, pal.entries, { pivotX: ph.pivotX, pivotY: ph.pivotY }), below: ph.below });
  }

  return {
    normal: bakeParts(pal.entries),
    white: bakeParts(pal.entries.map(() => ({ color: '#ffffff', emissive: true }))),
    pitched,
    shoulderSide,
    debris: [colors.team, trimHex, '#9aa4b8', '#555e70'].map((c) => hexToAbgr(c)),
  };
}
