/**
 * Sprite-stack 模型資料。
 *
 * 來源有兩種，最後都烘焙成同一個 StackModel：
 *  1. VoxelGrid：程式內用方塊／圓柱／字串格子組出來的體素，搭配調色盤（現在用的）
 *  2. 切片圖（sprite sheet）：之後換成外部美術時用 render/sheet.ts 的 modelFromSheet
 *
 * 渲染器只認 StackModel，所以換素材不用動渲染器。
 */

export interface PaletteEntry {
  color: string;
  /** 自發光：側面不變暗（眼睛、噴口、燈） */
  emissive?: boolean;
}

export interface Palette<K extends string> {
  id: Record<K, number>;
  entries: PaletteEntry[];
}

/** 調色盤索引從 1 開始，0 = 空。 */
export function makePalette<K extends string>(def: Record<K, string | PaletteEntry>): Palette<K> {
  const id = {} as Record<K, number>;
  const entries: PaletteEntry[] = [{ color: '#000000' }];
  for (const key of Object.keys(def) as K[]) {
    const e = def[key];
    id[key] = entries.length;
    entries.push(typeof e === 'string' ? { color: e } : e);
  }
  return { id, entries };
}

/** '#rrggbb' → 小端序 ABGR（可直接寫進 ImageData 的 Uint32 視圖）。 */
export function hexToAbgr(hex: string, shade = 1): number {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) * shade));
  const g = Math.min(255, Math.round(((n >> 8) & 255) * shade));
  const b = Math.min(255, Math.round((n & 255) * shade));
  return (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
}

export class VoxelGrid {
  readonly data: Uint8Array;

  /** w = x（模型的前方是 +x），h = y，d = 層數（z，往上） */
  constructor(
    readonly w: number,
    readonly h: number,
    readonly d: number,
  ) {
    this.data = new Uint8Array(w * h * d);
  }

  get(x: number, y: number, z: number): number {
    if (x < 0 || y < 0 || z < 0 || x >= this.w || y >= this.h || z >= this.d) return 0;
    return this.data[(z * this.h + y) * this.w + x];
  }

  set(x: number, y: number, z: number, c: number): void {
    if (x < 0 || y < 0 || z < 0 || x >= this.w || y >= this.h || z >= this.d) return;
    this.data[(z * this.h + y) * this.w + x] = c;
  }

  /** 兩端都包含 */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: number): void {
    for (let z = z0; z <= z1; z++)
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.set(x, y, z, c);
  }

  cylinder(cx: number, cy: number, r: number, z0: number, z1: number, c: number): void {
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        if (dx * dx + dy * dy <= r * r) for (let z = z0; z <= z1; z++) this.set(x, y, z, c);
      }
  }

  /** 把另一個體素格貼進來（空的地方不覆蓋） */
  blit(src: VoxelGrid, ox: number, oy: number, oz: number): void {
    for (let z = 0; z < src.d; z++)
      for (let y = 0; y < src.h; y++)
        for (let x = 0; x < src.w; x++) {
          const c = src.get(x, y, z);
          if (c) this.set(ox + x, oy + y, oz + z, c);
        }
  }

  /** 用函式填一整層：fn 回傳調色盤索引，0 = 不動 */
  fillLayer(z: number, fn: (x: number, y: number) => number): void {
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        const c = fn(x, y);
        if (c) this.set(x, y, z, c);
      }
  }

  /** 字串格子：每個字元查 legend，查不到就跳過。scale 可放大。 */
  stamp(
    z: number,
    ox: number,
    oy: number,
    rows: readonly string[],
    legend: Record<string, number>,
    scale = 1,
  ): void {
    rows.forEach((row, ry) => {
      for (let rx = 0; rx < row.length; rx++) {
        const c = legend[row[rx]];
        if (!c) continue;
        for (let sy = 0; sy < scale; sy++)
          for (let sx = 0; sx < scale; sx++)
            this.set(ox + rx * scale + sx, oy + ry * scale + sy, z, c);
      }
    });
  }
}

export interface StackLayer {
  /** w*h 個 ABGR，0 = 透明 */
  pixels: Uint32Array;
  /** 非透明範圍（max 不含）；渲染時用來裁切 */
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  empty: boolean;
}

export interface StackModel {
  w: number;
  h: number;
  /** 旋轉中心（切片座標） */
  pivotX: number;
  pivotY: number;
  /** 由下往上 */
  layers: StackLayer[];
}

export function makeLayer(pixels: Uint32Array, w: number, h: number): StackLayer {
  let minX = w;
  let minY = h;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (pixels[y * w + x] === 0) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x + 1 > maxX) maxX = x + 1;
      if (y + 1 > maxY) maxY = y + 1;
    }
  return { pixels, minX, minY, maxX, maxY, empty: maxX <= minX };
}

export interface BakeOptions {
  pivotX?: number;
  pivotY?: number;
  /** 側面（上面還有體素蓋住的部分）的亮度 */
  sideShade?: number;
}

/**
 * 體素 → 切片。順便做一個便宜的光影：
 * 上方沒有東西的體素算「頂面」用原色，被蓋住的算「側面」變暗。
 */
export function bake(grid: VoxelGrid, palette: readonly PaletteEntry[], opts: BakeOptions = {}): StackModel {
  const side = opts.sideShade ?? 0.7;
  const lit = palette.map((e) => hexToAbgr(e.color));
  const dark = palette.map((e) => hexToAbgr(e.color, e.emissive ? 1 : side));
  const layers: StackLayer[] = [];
  for (let z = 0; z < grid.d; z++) {
    const pixels = new Uint32Array(grid.w * grid.h);
    for (let y = 0; y < grid.h; y++)
      for (let x = 0; x < grid.w; x++) {
        const c = grid.get(x, y, z);
        if (!c) continue;
        pixels[y * grid.w + x] = grid.get(x, y, z + 1) ? dark[c] : lit[c];
      }
    layers.push(makeLayer(pixels, grid.w, grid.h));
  }
  return {
    w: grid.w,
    h: grid.h,
    pivotX: opts.pivotX ?? grid.w / 2,
    pivotY: opts.pivotY ?? grid.h / 2,
    layers,
  };
}

export interface PitchedGrid {
  grid: VoxelGrid;
  /** 軸心在新格子裡的 x、y（切片座標） */
  pivotX: number;
  pivotY: number;
  /** 軸心那一層下面還有幾層：畫的時候 z 要減掉這個數 */
  below: number;
}

/**
 * 把體素繞「左右方向的軸」前傾（angle > 0，上面往 +x 倒）或後仰（angle < 0）。
 * 軸心在 (px, 任意 y, pz)。用反向取樣，轉完不會有破洞。
 * Sprite stack 只能繞垂直軸轉，躺下、彎腰的零件要先用這個轉好再烘焙。
 */
export function pitchGrid(src: VoxelGrid, angle: number, px: number, pz: number, py = src.h / 2): PitchedGrid {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  // 原本的格子四個角轉過去之後的範圍
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const x of [0, src.w])
    for (const z of [0, src.d]) {
      const rx = (x - px) * c + (z - pz) * s;
      const rz = -(x - px) * s + (z - pz) * c;
      minX = Math.min(minX, rx);
      maxX = Math.max(maxX, rx);
      minZ = Math.min(minZ, rz);
      maxZ = Math.max(maxZ, rz);
    }
  const ox = Math.floor(minX);
  const oz = Math.floor(minZ);
  const grid = new VoxelGrid(Math.ceil(maxX) - ox, src.h, Math.ceil(maxZ) - oz);
  for (let z = 0; z < grid.d; z++)
    for (let x = 0; x < grid.w; x++) {
      const rx = x + 0.5 + ox;
      const rz = z + 0.5 + oz;
      // 反轉回原本的座標去取樣
      const sx = Math.floor(rx * c - rz * s + px);
      const sz = Math.floor(rx * s + rz * c + pz);
      if (sx < 0 || sz < 0 || sx >= src.w || sz >= src.d) continue;
      for (let y = 0; y < src.h; y++) {
        const v = src.get(sx, y, sz);
        if (v) grid.set(x, y, z, v);
      }
    }
  return { grid, pivotX: -ox, pivotY: py, below: -oz };
}
