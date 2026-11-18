/**
 * 純畫面特效：粒子、震動、閃白。不影響戰鬥結果，所以可以用 Math.random。
 * P1 之後由戰鬥邏輯丟出事件（被打、擊倒），這裡負責演出來。
 */
import type { Renderer } from '../render/renderer';

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
  /** 火花：不受重力彈跳影響，很快消失 */
  spark: boolean;
}

const GRAVITY = 160;
const MAX_PARTICLES = 400;

export class Fx {
  private particles: Particle[] = [];
  private shakeAmp = 0;
  private flashAmt = 0;
  shakeX = 0;
  shakeY = 0;

  get count(): number {
    return this.particles.length;
  }

  /** 一次打擊：碎片 + 火花 + 震動 + 閃白。strength 0..1 */
  hit(x: number, y: number, z: number, floorZ: number, debris: number[], sparks: number[], strength = 1): void {
    this.shakeAmp = Math.max(this.shakeAmp, 2 + 4 * strength);
    this.flashAmt = Math.max(this.flashAmt, 0.2 + 0.3 * strength);
    const n = Math.round(14 + 22 * strength);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 15 + Math.random() * 55 * (0.5 + strength);
      this.add({
        x,
        y,
        z: z + Math.random() * 6 - 3,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        vz: 30 + Math.random() * 80,
        color: debris[(Math.random() * debris.length) | 0],
        size: Math.random() < 0.3 ? 2 : 1,
        life: 0.8 + Math.random() * 1.2,
        spark: false,
      });
    }
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 60 + Math.random() * 120;
      this.add({
        x,
        y,
        z,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        vz: Math.random() * 120 - 30,
        color: sparks[(Math.random() * sparks.length) | 0],
        size: 1,
        life: 0.12 + Math.random() * 0.25,
        spark: true,
      });
    }
    this.floorZ = floorZ;
  }

  private floorZ = 0;

  private add(p: Particle): void {
    if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
    this.particles.push(p);
  }

  update(dt: number): void {
    this.shakeAmp *= Math.exp(-dt * 9);
    if (this.shakeAmp < 0.3) this.shakeAmp = 0;
    this.shakeX = (Math.random() * 2 - 1) * this.shakeAmp;
    this.shakeY = (Math.random() * 2 - 1) * this.shakeAmp;
    this.flashAmt = Math.max(0, this.flashAmt - dt * 5);

    for (const p of this.particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.spark) {
        p.vx *= 0.9;
        p.vy *= 0.9;
        continue;
      }
      p.vz -= GRAVITY * dt;
      if (p.z < this.floorZ) {
        p.z = this.floorZ;
        p.vz = -p.vz * 0.45;
        p.vx *= 0.6;
        p.vy *= 0.6;
      }
    }
    this.particles = this.particles.filter((p) => p.life > 0);
  }

  draw(r: Renderer): void {
    for (const p of this.particles) {
      // 快消失時閃爍
      if (!p.spark && p.life < 0.35 && ((p.life * 30) | 0) & 1) continue;
      r.drawPoint(p.x, p.y, p.z + p.size / 2, p.color, p.size);
    }
  }

  /** 最後一步：全畫面閃白 */
  post(r: Renderer): void {
    r.flash(this.flashAmt);
  }
}
