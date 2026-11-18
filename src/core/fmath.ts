/**
 * 可重播的三角函數。
 * Math.sin / cos / atan2 在不同瀏覽器引擎可能差最後一個位元，累積下去重播就會分岔。
 * 這裡只用加減乘除（IEEE 754 保證結果一致），戰鬥邏輯一律用這些。
 */
export const PI = 3.141592653589793;
export const TAU = PI * 2;
const HALF_PI = PI / 2;

export function wrapAngle(a: number): number {
  return a - TAU * Math.floor((a + PI) / TAU);
}

export function fsin(a: number): number {
  let x = wrapAngle(a);
  if (x > HALF_PI) x = PI - x;
  else if (x < -HALF_PI) x = -PI - x;
  const x2 = x * x;
  return (
    x *
    (1 +
      x2 *
        (-1 / 6 + x2 * (1 / 120 + x2 * (-1 / 5040 + x2 * (1 / 362880 + x2 * (-1 / 39916800 + x2 / 6227020800))))))
  );
}

export function fcos(a: number): number {
  return fsin(a + HALF_PI);
}

/** 誤差約 1e-4 弧度，對戰鬥判定夠用 */
export function fatan2(y: number, x: number): number {
  if (x === 0 && y === 0) return 0;
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const a = Math.min(ax, ay) / Math.max(ax, ay);
  const s = a * a;
  let r = ((-0.0464964749 * s + 0.15931422) * s - 0.327622764) * s * a + a;
  if (ay > ax) r = HALF_PI - r;
  if (x < 0) r = PI - r;
  return y < 0 ? -r : r;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
