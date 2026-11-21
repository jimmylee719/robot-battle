/**
 * 純畫面特效：粒子、震動、閃白、頓幀、鏡頭推近。
 * 不影響戰鬥結果，所以可以用 Math.random。由 view/director.ts 依戰鬥事件觸發。
 */
import type { Renderer } from '../render/renderer';
import { hexToAbgr } from '../render/stack';
import { FLOOR_Z } from '../models/arena';

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  color: number;
  size: number;
  life: number;
  /** 重力倍率：碎片 1、火花 0、煙是負的（往上飄） */
  gravity: number;
  /** 每秒速度衰減 */
  drag: number;
  bounce: boolean;
}

const GRAVITY = 170;
const MAX_PARTICLES = 500;
const SPARK = ['#ffffff', '#ffe066', '#ff8a3c'].map((c) => hexToAbgr(c));
const FLAME = ['#ffe066', '#ff8a3c', '#ff5a2a', '#5ef2ff'].map((c) => hexToAbgr(c));
const SMOKE = ['#3a4254', '#555e70', '#262b38'].map((c) => hexToAbgr(c));
const DUST = ['#5d6c8a', '#7f8aa3', '#39445a'].map((c) => hexToAbgr(c));

function pick(colors: readonly number[]): number {
  return colors[(Math.random() * colors.length) | 0];
}

export class Fx {
  private particles: Particle[] = [];
  private shakeAmp = 0;
  private flashAmt = 0;
  shakeX = 0;
  shakeY = 0;
  /** 還要凍結幾個邏輯 tick（打擊頓幀） */
  hitStop = 0;
  /** 鏡頭額外推近的比例，會自己衰減 */
  zoomKick = 0;
  /** 慢動作：戰鬥邏輯和粒子的時間倍率（1 = 正常速度）。只是播得慢，結果不變。 */
  timeScale = 1;
  private slowLeft = 0;
  private slowTo = 1;
  /** 鏡頭特寫：往 (focusX, focusY) 靠過去的比重 0..1，會自己衰減 */
  focus = 0;
  focusX = 0;
  focusY = 0;

  /** 接下來 seconds 秒（真實時間）用 scale 倍速播 */
  slow(scale: number, seconds: number): void {
    if (this.slowLeft <= 0 || scale <= this.slowTo) this.slowTo = scale;
    this.slowLeft = Math.max(this.slowLeft, seconds);
  }

  /** 正在慢動作（畫面上下會收黑邊） */
  get cinematic(): boolean {
    return this.slowLeft > 0;
  }

  /** 鏡頭特寫某一點 */
  focusOn(x: number, y: number, amount: number): void {
    if (amount < this.focus) return;
    this.focus = amount;
    this.focusX = x;
    this.focusY = y;
  }

  /** 全部歸零（新的一場開始時） */
  calm(): void {
    this.hitStop = 0;
    this.slowLeft = 0;
    this.timeScale = 1;
    this.focus = 0;
    this.zoomKick = 0;
  }

  shake(amp: number): void {
    this.shakeAmp = Math.max(this.shakeAmp, amp);
  }

  flash(amount: number): void {
    this.flashAmt = Math.max(this.flashAmt, amount);
  }

  private add(p: Particle): void {
    if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
    this.particles.push(p);
  }

  /** 零件碎片：會掉到地上彈幾下 */
  debris(x: number, y: number, z: number, colors: readonly number[], count: number, power: number): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = (15 + Math.random() * 60) * power;
      this.add({
        x,
        y,
        z: z + Math.random() * 6 - 3,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        vz: 30 + Math.random() * 90 * power,
        color: pick(colors),
        size: Math.random() < 0.3 ? 2 : 1,
        life: 0.8 + Math.random() * 1.2,
        gravity: 1,
        drag: 0,
        bounce: true,
      });
    }
  }

  sparks(x: number, y: number, z: number, count: number, power = 1): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = (50 + Math.random() * 130) * power;
      this.add({
        x,
        y,
        z,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        vz: Math.random() * 130 - 30,
        color: pick(SPARK),
        size: 1,
        life: 0.1 + Math.random() * 0.25,
        gravity: 0,
        drag: 6,
        bounce: false,
      });
    }
  }

  /** 順著拳的方向噴出去的一束火花：看得出這一拳是從哪邊打過來的 */
  cone(x: number, y: number, z: number, dx: number, dy: number, count: number, power = 1): void {
    const base = Math.atan2(dy, dx);
    for (let i = 0; i < count; i++) {
      const a = base + (Math.random() - 0.5) * 0.9;
      const s = (90 + Math.random() * 170) * power;
      this.add({
        x,
        y,
        z: z + Math.random() * 4 - 2,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        vz: Math.random() * 70 - 10,
        color: pick(SPARK),
        size: Math.random() < 0.25 ? 2 : 1,
        life: 0.12 + Math.random() * 0.3,
        gravity: 0.4,
        drag: 5,
        bounce: false,
      });
    }
  }

  /** 衝擊波：一圈往外擴的亮點 */
  ring(x: number, y: number, z: number, count: number, speed: number, color = SPARK[0]): void {
    const start = Math.random() * Math.PI * 2;
    for (let i = 0; i < count; i++) {
      const a = start + (i / count) * Math.PI * 2;
      this.add({
        x: x + Math.cos(a) * 3,
        y: y + Math.sin(a) * 3,
        z,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        vz: 0,
        color,
        size: 1,
        life: 0.22,
        gravity: 0,
        drag: 3,
        bounce: false,
      });
    }
  }

  /** 推進器噴焰：往 (dx, dy) 的反方向噴 */
  flame(x: number, y: number, z: number, dx: number, dy: number): void {
    for (let i = 0; i < 3; i++)
      this.add({
        x: x + Math.random() * 4 - 2,
        y: y + Math.random() * 4 - 2,
        z: z + Math.random() * 4 - 2,
        vx: -dx * (40 + Math.random() * 50),
        vy: -dy * (40 + Math.random() * 50),
        vz: Math.random() * 20 - 10,
        color: pick(FLAME),
        size: Math.random() < 0.5 ? 2 : 1,
        life: 0.12 + Math.random() * 0.18,
        gravity: 0,
        drag: 4,
        bounce: false,
      });
  }

  smoke(x: number, y: number, z: number, count: number): void {
    for (let i = 0; i < count; i++)
      this.add({
        x: x + Math.random() * 12 - 6,
        y: y + Math.random() * 12 - 6,
        z,
        vx: Math.random() * 8 - 4,
        vy: Math.random() * 8 - 4,
        vz: 14 + Math.random() * 16,
        color: pick(SMOKE),
        size: 2,
        life: 0.6 + Math.random() * 0.9,
        gravity: 0,
        drag: 0.5,
        bounce: false,
      });
  }

  /** 倒地時貼著地面往外散的塵土 */
  dust(x: number, y: number, count: number): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 30 + Math.random() * 50;
      this.add({
        x: x + Math.cos(a) * 8,
        y: y + Math.sin(a) * 8,
        z: FLOOR_Z + 1,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        vz: Math.random() * 12,
        color: pick(DUST),
        size: 2,
        life: 0.25 + Math.random() * 0.35,
        gravity: 0,
        drag: 5,
        bounce: false,
      });
    }
  }

  update(dt: number): void {
    this.shakeAmp *= Math.exp(-dt * 9);
    if (this.shakeAmp < 0.3) this.shakeAmp = 0;
    this.shakeX = (Math.random() * 2 - 1) * this.shakeAmp;
    this.shakeY = (Math.random() * 2 - 1) * this.shakeAmp;
    this.flashAmt = Math.max(0, this.flashAmt - dt * 5);
    this.zoomKick *= Math.exp(-dt * 7);
    // 慢動作和特寫都用真實時間倒數；粒子跟著慢動作一起變慢
    this.slowLeft = Math.max(0, this.slowLeft - dt);
    this.timeScale += ((this.slowLeft > 0 ? this.slowTo : 1) - this.timeScale) * (1 - Math.exp(-dt * 14));
    this.focus *= Math.exp(-dt * (this.slowLeft > 0 ? 0.6 : 2.2));
    if (this.focus < 0.01) this.focus = 0;
    dt *= this.timeScale;

    for (const p of this.particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.vz -= GRAVITY * p.gravity * dt;
      if (p.drag > 0) {
        const k = Math.exp(-p.drag * dt);
        p.vx *= k;
        p.vy *= k;
      }
      if (p.bounce && p.z < FLOOR_Z) {
        p.z = FLOOR_Z;
        p.vz = -p.vz * 0.45;
        p.vx *= 0.6;
        p.vy *= 0.6;
      }
    }
    this.particles = this.particles.filter((p) => p.life > 0);
  }

  draw(r: Renderer): void {
    for (const p of this.particles) {
      // 碎片快消失時閃爍
      if (p.bounce && p.life < 0.35 && ((p.life * 30) | 0) & 1) continue;
      r.drawPoint(p.x, p.y, p.z + p.size / 2, p.color, p.size);
    }
  }

  /** 最後一步：全畫面閃白 */
  post(r: Renderer): void {
    r.flash(this.flashAmt);
  }
}
