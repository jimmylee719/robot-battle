/** 擂台幾何（邏輯層）。單位 = 1 個體素 = 低解析度緩衝區在 zoom 1 時的 1 像素。 */

/** 八角籠內切圓半徑（中心到籠邊的距離）。 */
export const ARENA_APOTHEM = 72;

export function insideArena(x: number, y: number, margin = 0): boolean {
  const a = ARENA_APOTHEM - margin;
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  return ax <= a && ay <= a && ax + ay <= a * Math.SQRT2;
}
