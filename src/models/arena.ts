/** 擂台、圍籠的模型（純資料 + 程式產生）。之後可以整組換成外部切片圖。 */
import { bake, makePalette, VoxelGrid, type StackModel } from '../render/stack';
import { ARENA_APOTHEM } from '../sim/arena';

/** 擂台平台的層數，也就是機器人站立的高度 */
export const FLOOR_Z = 6;
/** 平台外緣（比籠子大一圈） */
const APRON = ARENA_APOTHEM + 10;
export const FENCE_HEIGHT = 20;
export const FENCE_LENGTH = Math.round(2 * ARENA_APOTHEM * Math.tan(Math.PI / 8));
/** 八個角柱到中心的距離 */
export const POST_RADIUS = ARENA_APOTHEM / Math.cos(Math.PI / 8);

const pal = makePalette({
  skirt: '#141821',
  hazard: '#e2a72e',
  apron: '#242b3a',
  edge: '#f2c14e',
  mat: '#39445a',
  mat2: '#344054',
  line: '#5d6c8a',
  logo: '#f2c14e',
  red: '#d8433a',
  blue: '#3a7bd8',
  mesh: '#8f9bb3',
  rail: '#10131a',
  pad: '#2a3040',
  cap: '#cfd6e6',
});
const C = pal.id;

function oct(dx: number, dy: number, a: number): boolean {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  return ax <= a && ay <= a && ax + ay <= a * Math.SQRT2;
}

// 擂台中央的標誌：命令提示字元 >_
const LOGO = ['#.........', '.#........', '..#.......', '.#........', '#....#####'];

function buildFloor(): StackModel {
  const size = (APRON + 2) * 2;
  const half = size / 2;
  const g = new VoxelGrid(size, size, FLOOR_Z);
  for (let z = 0; z < FLOOR_Z - 1; z++)
    g.fillLayer(z, (x, y) => {
      if (!oct(x + 0.5 - half, y + 0.5 - half, APRON)) return 0;
      // 側裙：中間三層是斜向警示條
      return z >= 1 && z <= 3 && ((x + y) >> 3) & 1 ? C.hazard : C.skirt;
    });
  g.fillLayer(FLOOR_Z - 1, (x, y) => {
    const dx = x + 0.5 - half;
    const dy = y + 0.5 - half;
    if (!oct(dx, dy, APRON)) return 0;
    if (!oct(dx, dy, ARENA_APOTHEM)) return C.apron;
    if (!oct(dx, dy, ARENA_APOTHEM - 2)) return C.edge;
    const r = Math.hypot(dx, dy);
    if (r >= 21 && r < 23) return C.line;
    // 紅藍兩方的起始線
    if (Math.abs(dy) < 9 && Math.abs(dx + 42) < 1.5) return C.red;
    if (Math.abs(dy) < 9 && Math.abs(dx - 42) < 1.5) return C.blue;
    return (Math.floor(dx / 12) + Math.floor(dy / 12)) & 1 ? C.mat : C.mat2;
  });
  g.stamp(FLOOR_Z - 1, half - 10, half - 5, LOGO, { '#': C.logo }, 2);
  return bake(g, pal.entries);
}

/**
 * 一片圍網。沿著 y 軸延伸，法線朝 +x。
 * spacing 是菱形網目的間距：靠近鏡頭那幾片用稀疏版，才不會擋住機器人。
 */
function buildFence(spacing: number): StackModel {
  const g = new VoxelGrid(2, FENCE_LENGTH, FENCE_HEIGHT);
  g.box(0, 0, 0, 1, FENCE_LENGTH - 1, 1, C.pad);
  g.box(0, 0, FENCE_HEIGHT - 2, 1, FENCE_LENGTH - 1, FENCE_HEIGHT - 1, C.rail);
  for (let z = 2; z < FENCE_HEIGHT - 2; z++)
    for (let y = 0; y < FENCE_LENGTH; y++)
      if ((y + z) % spacing === 0 || (((y - z) % spacing) + spacing) % spacing === 0) g.set(0, y, z, C.mesh);
  return bake(g, pal.entries, { sideShade: 1 });
}

function buildPost(color: number): StackModel {
  const h = FENCE_HEIGHT + 3;
  const g = new VoxelGrid(6, 6, h);
  g.cylinder(3, 3, 3, 0, h - 3, color);
  g.cylinder(3, 3, 2.2, h - 2, h - 1, C.cap);
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
