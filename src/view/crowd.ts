/**
 * 觀眾的情緒（純畫面狀態）。導播在重拳、擊倒、K.O. 時加熱，之後自己慢慢冷下來。
 * 畫面依 level 決定觀眾站起來多少、閃光燈多不多。
 */
export class Crowd {
  /** 0 = 安靜看，1 = 全場站起來 */
  level = 0.15;
  /** 觀眾上下跳的節拍 */
  beat = 0;

  cheer(amount: number): void {
    this.level = Math.min(1, Math.max(this.level, amount));
  }

  update(dt: number): void {
    // 平常也有一點底噪，不會完全靜止
    this.level += (0.12 - this.level) * Math.min(1, dt * 0.5);
    this.beat += dt * (5 + this.level * 9);
  }
}
