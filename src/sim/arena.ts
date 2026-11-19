/** 擂台幾何（邏輯層）。單位 = 1 個體素 = 低解析度緩衝區在 zoom 1 時的 1 像素。 */

/** 圓形鐵籠的半徑（中心到圍網）。105 的面積和原本的場地差不多。 */
export const ARENA_RADIUS = 105;
/** 開場時兩台機器人各站在離中心多遠的地方 */
export const START_X = 60;

export function insideArena(x: number, y: number, margin = 0): boolean {
  const a = ARENA_RADIUS - margin;
  return x * x + y * y <= a * a;
}
