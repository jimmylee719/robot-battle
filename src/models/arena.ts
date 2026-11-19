/** 擂台、圍籠的模型（純資料 + 程式產生）。之後可以整組換成外部切片圖。 */
import { bake, makePalette, VoxelGrid, type StackModel } from '../render/stack';
import { ARENA_APOTHEM, START_X } from '../sim/arena';

/** 擂台平台的層數，也就是機器人站立的高度 */
export const FLOOR_Z = 6;
/** 平台外緣（比籠子大一圈） */
const APRON = ARENA_APOTHEM + 10;
export const FENCE_HEIGHT = 24;
export const FENCE_LENGTH = Math.round(2 * ARENA_APOTHEM * Math.tan(Math.PI / 8));
/** 八個角柱到中心的距離 */
export const POST_RADIUS = ARENA_APOTHEM / Math.cos(Math.PI / 8);

const pal = makePalette({
  skirt: '#141821',
  hazard: '#e2a72e',
  apron: '#1b202b',
  edge: '#14171e',
  // 帆布墊：淺灰，像真的八角籠那樣，機器人在上面才看得清楚
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
});
const C = pal.id;

function oct(dx: number, dy: number, a: number): boolean {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  return ax <= a && ay <= a && ax + ay <= a * Math.SQRT2;
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
      if (!oct(x + 0.5 - half, y + 0.5 - half, APRON)) return 0;
      // 裡面看不到，挖空（少畫很多像素）
      if (oct(x + 0.5 - half, y + 0.5 - half, APRON - 3)) return 0;
      // 側裙：中間三層是斜向警示條
      return z >= 1 && z <= 3 && ((x + y) >> 3) & 1 ? C.hazard : C.skirt;
    });
  g.fillLayer(FLOOR_Z - 1, (x, y) => {
    const dx = x + 0.5 - half;
    const dy = y + 0.5 - half;
    if (!oct(dx, dy, APRON)) return 0;
    if (!oct(dx, dy, ARENA_APOTHEM)) return C.apron;
    // 籠邊一圈黑色護墊，裡面一條金線
    if (!oct(dx, dy, ARENA_APOTHEM - 3)) return C.edge;
    if (!oct(dx, dy, ARENA_APOTHEM - 4)) return C.gold;
    // 墊子上一圈八角形的線，和籠子同方向
    if (oct(dx, dy, 58) && !oct(dx, dy, 56.5)) return C.line;
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

export interface ArenaModels {
  floor: StackModel;
  fenceFar: StackModel;
  fenceNear: StackModel;
  post: StackModel;
  postRed: StackModel;
  postBlue: StackModel;
}

export function buildArenaModels(): ArenaModels {
  return {
    floor: buildFloor(),
    fenceFar: buildFence(4),
    fenceNear: buildFence(10),
    post: buildPost(C.pad),
    postRed: buildPost(C.red),
    postBlue: buildPost(C.blue),
  };
}
