/** 擂台幾何（邏輯層）。單位 = 1 個體素 = 低解析度緩衝區在 zoom 1 時的 1 像素。 */

/**
 * 八角籠內切圓半徑（中心到籠邊的距離）。
 * 102 = 原本 72 的 √2 倍，場地面積剛好是原本的兩倍。
 */
export const ARENA_APOTHEM = 102;
/** 開場時兩台機器人各站在離中心多遠的地方 */
export const START_X = 60;

export function insideArena(x: number, y: number, margin = 0): boolean {
  const a = ARENA_APOTHEM - margin;
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  return ax <= a && ay <= a && ax + ay <= a * Math.SQRT2;
}
