/** 擂台、圍籠的模型（純資料 + 程式產生）。之後可以整組換成外部切片圖。 */
import { bake, makePalette, VoxelGrid, type StackModel } from '../render/stack';
import { ARENA_RADIUS, START_X } from '../sim/arena';

/** 擂台平台的層數，也就是機器人站立的高度 */
export const FLOOR_Z = 6;
/** 平台外緣（比籠子大一圈） */
export const APRON = ARENA_RADIUS + 10;
/** 觀眾席：一排一排往外、往上 */
export const STAND_ROWS = 6;
export const STAND_DEPTH = STAND_ROWS * 5 + 2;
/** 觀眾席分成幾段圍一圈 */
export const STAND_COUNT = 12;
export const STAND_LENGTH = Math.round(2 * (APRON + 10) * Math.tan(Math.PI / STAND_COUNT)) - 6;
export const FENCE_HEIGHT = 24;
/** 圍網用幾片直的拼成一圈（片數夠多，看起來就是圓的） */
export const FENCE_COUNT = 24;
export const FENCE_LENGTH = Math.ceil(2 * ARENA_RADIUS * Math.tan(Math.PI / FENCE_COUNT)) + 1;
/** 圍網外的柱子：幾根、離中心多遠 */
export const POST_COUNT = 8;
export const POST_RADIUS = ARENA_RADIUS + 2;

const pal = makePalette({
  skirt: '#141821',
  hazard: '#e2a72e',
  apron: '#1b202b',
  edge: '#14171e',
  // 帆布墊：淺灰，機器人在上面才看得清楚
  mat: '#bfc4ce',
  mat2: '#b5bbc6',
  line: '#8d95a5',
  logo: '#20242e',
  gold: '#e2a72e',
  ad: '#3a4254',
  ad2: '#8d95a5',
  red: '#d8433a',
  blue: '#3a7bd8',
  mesh: '#2c3340',
  rail: '#10131a',
  trim: '#e2a72e',
  pad: '#1b202b',
  cap: '#cfd6e6',
  // 觀眾席在暗處：顏色都壓暗
  seat: '#12151c',
  step: '#1a1e28',
  skin1: '#8a6f5c',
  skin2: '#5e4a3f',
  shirt1: '#5a2c30',
  shirt2: '#2c3f66',
  shirt3: '#4a4a52',
  shirt4: '#5c5330',
  shirt5: '#2f4a3c',
  shirt6: '#6b6f7a',
  desk: '#2a3040',
  screen: { color: '#5ef2ff', emissive: true },
  mic: { color: '#ff4d6d', emissive: true },
  suit: '#30364a',
});
const C = pal.id;

/** 在半徑 a 的圓裡面 */
function disc(dx: number, dy: number, a: number): boolean {
  return dx * dx + dy * dy <= a * a;
}

/** 點到線段的距離 */
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const vx = bx - ax;
  const vy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy)));
  return Math.hypot(px - ax - vx * t, py - ay - vy * t);
}

function buildFloor(): StackModel {
  const size = (APRON + 2) * 2;
  const half = size / 2;
  const g = new VoxelGrid(size, size, FLOOR_Z);
  for (let z = 0; z < FLOOR_Z - 1; z++)
    g.fillLayer(z, (x, y) => {
      if (!disc(x + 0.5 - half, y + 0.5 - half, APRON)) return 0;
      // 裡面看不到，挖空（少畫很多像素）
      if (disc(x + 0.5 - half, y + 0.5 - half, APRON - 3)) return 0;
      // 側裙：中間三層是斜向警示條
      return z >= 1 && z <= 3 && ((x + y) >> 3) & 1 ? C.hazard : C.skirt;
    });
  g.fillLayer(FLOOR_Z - 1, (x, y) => {
    const dx = x + 0.5 - half;
    const dy = y + 0.5 - half;
    if (!disc(dx, dy, APRON)) return 0;
    if (!disc(dx, dy, ARENA_RADIUS)) return C.apron;
    // 籠邊一圈黑色護墊，裡面一條金線
    if (!disc(dx, dy, ARENA_RADIUS - 3)) return C.edge;
    if (!disc(dx, dy, ARENA_RADIUS - 4)) return C.gold;
    // 墊子上一圈圓形的線
    if (disc(dx, dy, 58) && !disc(dx, dy, 56.5)) return C.line;
    // 紅藍兩方的角落：開場站的位置
    if (Math.abs(dy) < 10 && Math.abs(dx + START_X + 12) < 2) return C.red;
    if (Math.abs(dy) < 10 && Math.abs(dx - START_X - 12) < 2) return C.blue;
    // 像贊助商標誌的色塊，繞中央一圈（不是任何真實商標）
    const ang = Math.atan2(dy, dx);
    const rr = Math.hypot(dx, dy);
    const sector = Math.round(ang / (Math.PI / 4));
    const off = Math.abs(ang - sector * (Math.PI / 4)) * rr;
    if (sector % 2 !== 0 && rr > 70 && rr < 84 && off < 15) return rr > 75 && rr < 79 && off < 12 ? C.ad2 : C.ad;
    // 中央的大標誌：命令提示字元 >_
    if (Math.min(segDist(dx, dy, -20, -13, -4, 0), segDist(dx, dy, -4, 0, -20, 13)) < 2.6) return C.logo;
    if (dx > 2 && dx < 22 && dy > 9 && dy < 14) return C.gold;
    // 帆布一塊一塊接起來的接縫
    return Math.abs(dx % 34) < 0.6 || Math.abs(dy % 34) < 0.6 ? C.mat2 : C.mat;
  });
  return bake(g, pal.entries);
}

/**
 * 一片圍網。沿著 y 軸延伸，法線朝 +x。
 * spacing 是菱形網目的間距：靠近鏡頭那幾片用稀疏版，才不會擋住機器人。
 */
function buildFence(spacing: number): StackModel {
  const g = new VoxelGrid(2, FENCE_LENGTH, FENCE_HEIGHT);
  g.box(0, 0, 0, 1, FENCE_LENGTH - 1, 1, C.pad);
  // 上緣是包了護墊的粗橫桿
  g.box(0, 0, FENCE_HEIGHT - 3, 1, FENCE_LENGTH - 1, FENCE_HEIGHT - 1, C.rail);
  g.box(0, 0, FENCE_HEIGHT - 1, 1, FENCE_LENGTH - 1, FENCE_HEIGHT - 1, C.trim);
  for (let z = 2; z < FENCE_HEIGHT - 3; z++)
    for (let y = 0; y < FENCE_LENGTH; y++)
      if ((y + z) % spacing === 0 || (((y - z) % spacing) + spacing) % spacing === 0) g.set(0, y, z, C.mesh);
  return bake(g, pal.entries, { sideShade: 1 });
}

function buildPost(color: number): StackModel {
  const h = FENCE_HEIGHT + 3;
  const g = new VoxelGrid(8, 8, h);
  g.cylinder(4, 4, 4, 0, h - 3, color);
  g.cylinder(4, 4, 4, h - 6, h - 5, C.rail);
  g.cylinder(4, 4, 3, h - 2, h - 1, C.cap);
  return bake(g, pal.entries);
}

/** 便宜的雜湊：同一個位置永遠得到同一個數，觀眾才不會每次重建都換人 */
function hash(a: number, b: number): number {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * 一段觀眾席。沿著 y 軸延伸，x 越大離擂台越遠、越高。
 * cheer = 歡呼的版本：一部分人站起來舉手。平常和歡呼兩個版本輪流畫，就是觀眾在動。
 */
function buildStand(cheer: boolean): StackModel {
  const height = STAND_ROWS * 3 + 6;
  const g = new VoxelGrid(STAND_DEPTH, STAND_LENGTH, height);
  const shirts = [C.shirt1, C.shirt2, C.shirt3, C.shirt4, C.shirt5, C.shirt6];
  for (let row = 0; row < STAND_ROWS; row++) {
    const x0 = 1 + row * 5;
    const base = row * 3;
    // 台階只畫正面和頂面那一圈，裡面不填（看不到）
    g.box(x0, 0, base, x0 + 4, STAND_LENGTH - 1, base, C.step);
    g.box(x0, 0, 0, x0, STAND_LENGTH - 1, base, C.seat);
    for (let y = 1; y + 2 < STAND_LENGTH; y += 3) {
      const r = hash(row * 31 + 7, y);
      if (r < 0.08) continue; // 空位
      const up = cheer && hash(y, row * 17 + 3) < 0.45 ? 1 : 0;
      const shirt = shirts[Math.floor(hash(row + 99, y * 5) * shirts.length)];
      const skin = hash(y * 3, row) < 0.5 ? C.skin1 : C.skin2;
      g.box(x0 + 1, y, base + 1, x0 + 2, y + 1, base + 2 + up, shirt);
      g.box(x0 + 1, y, base + 3 + up, x0 + 2, y + 1, base + 3 + up, skin);
      // 舉手
      if (up) {
        g.set(x0 + 1, y - 1 < 0 ? 0 : y - 1, base + 4, skin);
        g.set(x0 + 1, y + 2, base + 4, skin);
      }
    }
  }
  return bake(g, pal.entries, { pivotX: 0 });
}

/** 場邊的轉播台：一張長桌、兩台螢幕、兩位主持人 */
function buildDesk(): StackModel {
  const g = new VoxelGrid(9, 26, 9);
  g.box(0, 0, 0, 4, 25, 4, C.desk);
  g.box(0, 0, 4, 4, 25, 4, C.rail);
  for (const y of [5, 16]) {
    // 螢幕朝外（朝主持人）
    g.box(3, y, 5, 3, y + 4, 7, C.screen);
    g.box(2, y, 5, 2, y + 4, 7, C.rail);
    // 主持人坐在桌子外側
    g.box(6, y + 1, 0, 8, y + 3, 5, C.suit);
    g.box(6, y + 1, 6, 8, y + 3, 7, y === 5 ? C.skin1 : C.skin2);
    g.set(5, y + 2, 6, C.mic);
  }
  return bake(g, pal.entries, { pivotX: 0 });
}

export interface ArenaModels {
  floor: StackModel;
  fenceFar: StackModel;
  fenceNear: StackModel;
  post: StackModel;
  postRed: StackModel;
  postBlue: StackModel;
  stand: StackModel;
  standCheer: StackModel;
  desk: StackModel;
}

export function buildArenaModels(): ArenaModels {
  return {
    floor: buildFloor(),
    fenceFar: buildFence(4),
    fenceNear: buildFence(10),
    post: buildPost(C.pad),
    postRed: buildPost(C.red),
    postBlue: buildPost(C.blue),
    stand: buildStand(false),
    standCheer: buildStand(true),
    desk: buildDesk(),
  };
}
