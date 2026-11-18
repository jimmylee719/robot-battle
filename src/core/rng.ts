/**
 * 可重播的亂數（mulberry32）。戰鬥邏輯只能用這個，不能用 Math.random。
 * state 是唯一狀態，存下來就能還原。
 */
export class Rng {
  state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** [0, 1) */
  next(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** 整數 [0, n) */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }
}
