/**
 * 演出專用的亂數（台詞輪替、對話框挑哪一句）。和戰鬥模擬的亂數完全分開：
 * 戰鬥用 match.rng，這裡從比賽種子加一個固定常數衍生，而且每一次挑選都只看
 * 「種子、第幾個 tick、這個 tick 裡第幾次挑」，所以畫面播快播慢、哪幾句被略過，
 * 同一個種子挑到的句子都一樣。
 */
const SALT = 0x5eedc0de;

export class ShowRng {
  private seed = SALT;
  private tick = 0;
  private n = 0;

  reset(seed: number): void {
    this.seed = (seed ^ SALT) >>> 0;
    this.tick = 0;
    this.n = 0;
  }

  /** 現在是第幾個 tick（每個邏輯 tick 先叫一次） */
  at(tick: number): void {
    if (tick !== this.tick) {
      this.tick = tick;
      this.n = 0;
    }
  }

  /** 0..1 */
  next(): number {
    let h = Math.imul(this.seed ^ Math.imul(this.tick + 1, 0x9e3779b1), 0x85ebca6b) ^ Math.imul(++this.n, 0xc2b2ae35);
    h ^= h >>> 15;
    h = Math.imul(h, 0x2c1b3c6d);
    h ^= h >>> 12;
    h = Math.imul(h, 0x297a2d39);
    h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
  }

  pick<T>(list: readonly T[]): T {
    return list[Math.floor(this.next() * list.length)];
  }
}
