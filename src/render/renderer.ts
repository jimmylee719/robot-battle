/**
 * Sprite-stack 軟體渲染器。
 *
 * 全部畫進一個低解析度的 Uint32 像素緩衝區（外面再整數倍放大）。
 * 每個物件是一疊水平切片，每層往上偏移 1 像素 × zoom，切片可任意旋轉。
 * 另外有一個深度緩衝區，所以物件之間不用排序：
 * 機器人的手臂、圍籠、粒子互相遮擋都會自動正確。
 */
import type { StackLayer, StackModel } from './stack';
import { hexToAbgr } from './stack';

export interface Camera {
  /** 看向的世界座標 */
  x: number;
  y: number;
  /** 看向的高度：拉近時畫面才會對著機器人的身體，不是對著腳 */
  z: number;
  /** 繞垂直軸旋轉（弧度） */
  angle: number;
  zoom: number;
  /** 地面的垂直壓縮比例：1 = 正上方俯視，越小越接近平視 */
  pitch: number;
  /** 畫面震動（像素） */
  shakeX: number;
  shakeY: number;
}

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

export class Renderer {
  readonly image: ImageData;
  readonly color: Uint32Array;
  readonly depth: Float32Array;
  /** 每個像素是哪個物件畫的（0 = 場景）。描邊用 */
  readonly tags: Uint8Array;
  /** 接下來畫的東西算哪個物件 */
  tag = 0;
  private edge: Uint8Array | null = null;
  readonly cam: Camera = { x: 0, y: 0, z: 18, angle: 0, zoom: 1, pitch: 0.62, shakeX: 0, shakeY: 0 };

  private readonly bg: Uint32Array;
  private ca = 1;
  private sa = 0;
  private kY = 0;
  private kZ = 1;
  private ox = 0;
  private oy = 0;

  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.image = new ImageData(w, h);
    this.color = new Uint32Array(this.image.data.buffer);
    this.depth = new Float32Array(w * h);
    this.tags = new Uint8Array(w * h);
    this.bg = this.makeBackground();
  }

  /** 暗場 + 中央一圈抖色的聚光 */
  private makeBackground(): Uint32Array {
    const { w, h } = this;
    const steps = ['#06070b', '#0a0c14', '#0f121d', '#151929', '#1b2034'].map((c) => hexToAbgr(c));
    const bg = new Uint32Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const dx = (x - w / 2) / (w * 0.62);
        const dy = (y - h * 0.55) / (h * 0.62);
        const t = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy));
        const level = t * (steps.length - 1) + (BAYER4[(y & 3) * 4 + (x & 3)] + 0.5) / 16 - 0.5;
        bg[y * w + x] = steps[Math.max(0, Math.min(steps.length - 1, Math.round(level)))];
      }
    return bg;
  }

  /** 每幀開始：清畫面、清深度、依攝影機更新投影參數 */
  begin(): void {
    const c = this.cam;
    this.color.set(this.bg);
    this.depth.fill(-Infinity);
    this.tags.fill(0);
    this.tag = 0;
    this.ca = Math.cos(c.angle);
    this.sa = Math.sin(c.angle);
    this.kY = Math.sqrt(Math.max(0, 1 - c.pitch * c.pitch));
    this.kZ = c.pitch;
    this.ox = Math.round(this.w / 2 + c.shakeX);
    this.oy = Math.round(this.h * 0.53 + c.z * c.zoom + c.shakeY);
  }

  /** 世界座標 → 緩衝區上的像素位置（畫對話框這類 DOM 疊加層用；用上一次 begin() 的攝影機） */
  project(x: number, y: number, z: number): [number, number] {
    const c = this.cam;
    const dx = x - c.x;
    const dy = y - c.y;
    const rx = dx * this.ca - dy * this.sa;
    const ry = dx * this.sa + dy * this.ca;
    return [this.ox + rx * c.zoom, this.oy + (ry * c.pitch - z) * c.zoom];
  }

  /** 世界座標在攝影機空間裡的前後位置（越大越靠近鏡頭） */
  viewY(x: number, y: number): number {
    return (x - this.cam.x) * this.sa + (y - this.cam.y) * this.ca;
  }

  /**
   * 畫一疊切片。angle 是物件自己的朝向。
   * shx / shy：每往上一層，整層往世界座標的這個方向多偏一點（傾斜），用來做身體前傾、後仰。
   */
  drawStack(m: StackModel, x: number, y: number, z: number, angle: number, shx = 0, shy = 0): void {
    const c = this.cam;
    const zoom = c.zoom;
    const p = c.pitch;
    const dx = x - c.x;
    const dy = y - c.y;
    const rx = dx * this.ca - dy * this.sa;
    const ry = dx * this.sa + dy * this.ca;
    const srx = shx * this.ca - shy * this.sa;
    const sry = shx * this.sa + shy * this.ca;

    const a = c.angle + angle;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    // 切片 → 畫面
    const fxu = zoom * ca;
    const fxv = -zoom * sa;
    const fyu = zoom * p * sa;
    const fyv = zoom * p * ca;
    // 畫面 → 切片
    const iux = ca / zoom;
    const iuy = sa / (zoom * p);
    const ivx = -sa / zoom;
    const ivy = ca / (zoom * p);

    // 放大時一層不只 1 像素高，要多畫幾次把縫補起來
    const sub = Math.max(1, Math.ceil(zoom));
    const depth0 = z * this.kZ;
    const depthPerRow = this.kY / (zoom * p);
    const { w, h, color, depth, tags } = this;
    const tag = this.tag;

    for (let i = 0; i < m.layers.length; i++) {
      const L: StackLayer = m.layers[i];
      if (L.empty) continue;

      // 這一層在畫面上的包圍盒（相對於中心）
      const x0 = L.minX - m.pivotX;
      const x1 = L.maxX - m.pivotX;
      const y0 = L.minY - m.pivotY;
      const y1 = L.maxY - m.pivotY;
      const ax = fxu * x0 + fxv * y0;
      const bx = fxu * x1 + fxv * y0;
      const cx2 = fxu * x0 + fxv * y1;
      const dx2 = fxu * x1 + fxv * y1;
      const ay = fyu * x0 + fyv * y0;
      const by = fyu * x1 + fyv * y0;
      const cy2 = fyu * x0 + fyv * y1;
      const dy2 = fyu * x1 + fyv * y1;
      const relLeft = Math.min(ax, bx, cx2, dx2);
      const relRight = Math.max(ax, bx, cx2, dx2);
      const relTop = Math.min(ay, by, cy2, dy2);
      const relBottom = Math.max(ay, by, cy2, dy2);
      const pixels = L.pixels;
      const mw = m.w;

      for (let k = 0; k < sub; k++) {
        const zz = i + k / sub;
        const lry = ry + sry * zz;
        const cx = Math.round(this.ox + (rx + srx * zz) * zoom);
        const xStart = Math.max(0, Math.floor(cx + relLeft));
        const xEnd = Math.min(w - 1, Math.ceil(cx + relRight));
        if (xStart > xEnd) continue;
        const sy = Math.round(this.oy + (lry * p - z - zz) * zoom);
        const layerDepth = depth0 + lry * this.kY + zz * this.kZ;
        const yStart = Math.max(0, Math.floor(sy + relTop));
        const yEnd = Math.min(h - 1, Math.ceil(sy + relBottom));

        for (let py = yStart; py <= yEnd; py++) {
          const ddy = py + 0.5 - sy;
          // px = 0 時對應的切片座標
          const ub = m.pivotX + iuy * ddy + iux * (0.5 - cx);
          const vb = m.pivotY + ivy * ddy + ivx * (0.5 - cx);

          // 把這一列裁到切片的非透明範圍內，空白處完全不跑
          let lo = xStart;
          let hi = xEnd;
          if (Math.abs(iux) < 1e-9) {
            if (ub < L.minX || ub >= L.maxX) continue;
          } else {
            const t0 = (L.minX - ub) / iux;
            const t1 = (L.maxX - ub) / iux;
            lo = Math.max(lo, Math.ceil(Math.min(t0, t1)));
            hi = Math.min(hi, Math.floor(Math.max(t0, t1)));
          }
          if (Math.abs(ivx) < 1e-9) {
            if (vb < L.minY || vb >= L.maxY) continue;
          } else {
            const t0 = (L.minY - vb) / ivx;
            const t1 = (L.maxY - vb) / ivx;
            lo = Math.max(lo, Math.ceil(Math.min(t0, t1)));
            hi = Math.min(hi, Math.floor(Math.max(t0, t1)));
          }
          if (lo > hi) continue;

          const d = layerDepth + ddy * depthPerRow;
          let u = ub + iux * lo;
          let v = vb + ivx * lo;
          let idx = py * w + lo;
          for (let px = lo; px <= hi; px++, idx++, u += iux, v += ivx) {
            const ui = Math.floor(u);
            const vi = Math.floor(v);
            if (ui < L.minX || ui >= L.maxX || vi < L.minY || vi >= L.maxY) continue;
            const col = pixels[vi * mw + ui];
            if (col !== 0 && d >= depth[idx]) {
              color[idx] = col;
              depth[idx] = d;
              tags[idx] = tag;
            }
          }
        }
      }
    }
  }

  /** 畫一個小方塊（粒子用）。size 以世界單位計。 */
  drawPoint(x: number, y: number, z: number, col: number, size: number): void {
    const c = this.cam;
    const dx = x - c.x;
    const dy = y - c.y;
    const rx = dx * this.ca - dy * this.sa;
    const ry = dx * this.sa + dy * this.ca;
    const s = Math.max(1, Math.round(size * c.zoom));
    const sx = Math.round(this.ox + rx * c.zoom - s / 2);
    const sy = Math.round(this.oy + (ry * c.pitch - z) * c.zoom - s / 2);
    const d = ry * this.kY + z * this.kZ;
    for (let py = Math.max(0, sy); py < Math.min(this.h, sy + s); py++)
      for (let px = Math.max(0, sx); px < Math.min(this.w, sx + s); px++) {
        const idx = py * this.w + px;
        if (d >= this.depth[idx]) {
          this.color[idx] = col;
          this.depth[idx] = d;
        }
      }
  }

  /** 地面上的橢圓影子：把已經畫好的像素變暗。要在地板之後、其他物件之前呼叫。 */
  shadow(x: number, y: number, z: number, radius: number): void {
    const c = this.cam;
    const dx = x - c.x;
    const dy = y - c.y;
    const rx = dx * this.ca - dy * this.sa;
    const ry = dx * this.sa + dy * this.ca;
    const cx = this.ox + rx * c.zoom;
    const cy = this.oy + (ry * c.pitch - z) * c.zoom;
    const ex = radius * c.zoom;
    const ey = radius * c.zoom * c.pitch;
    for (let py = Math.max(0, Math.floor(cy - ey)); py <= Math.min(this.h - 1, Math.ceil(cy + ey)); py++)
      for (let px = Math.max(0, Math.floor(cx - ex)); px <= Math.min(this.w - 1, Math.ceil(cx + ex)); px++) {
        const nx = (px + 0.5 - cx) / ex;
        const ny = (py + 0.5 - cy) / ey;
        if (nx * nx + ny * ny > 1) continue;
        const idx = py * this.w + px;
        const col = this.color[idx];
        // 亮度 × 0.625
        this.color[idx] = (0xff000000 | (((col >>> 1) & 0x7f7f7f) + ((col >>> 3) & 0x1f1f1f))) >>> 0;
      }
  }

  /**
   * 描邊：有標記的物件（機器人、裁判）邊緣外面那一圈像素塗成深色，
   * 只在「外面那一格比較遠」的時候塗，所以被前面的東西擋住的地方不會畫錯。
   */
  outline(col: number): void {
    const { w, h, tags, depth, color } = this;
    const out = (this.edge ??= new Uint8Array(w * h));
    out.fill(0);
    for (let y = 1; y < h - 1; y++)
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const t = tags[i];
        const d = depth[i];
        for (const j of [i - 1, i + 1, i - w, i + w]) {
          const tj = tags[j];
          if (tj !== 0 && tj !== t && depth[j] > d + 2) {
            out[i] = 1;
            break;
          }
        }
      }
    for (let i = 0; i < out.length; i++) if (out[i]) color[i] = col;
  }

  /** 整個畫面往白色混合（打擊閃白）。amount 0..1 */
  flash(amount: number): void {
    const k = Math.max(0, Math.min(256, Math.round(amount * 256)));
    if (k === 0) return;
    const color = this.color;
    for (let i = 0; i < color.length; i++) {
      const col = color[i];
      let r = col & 255;
      let g = (col >>> 8) & 255;
      let b = (col >>> 16) & 255;
      r += ((255 - r) * k) >> 8;
      g += ((255 - g) * k) >> 8;
      b += ((255 - b) * k) >> 8;
      color[i] = (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
    }
  }
}
