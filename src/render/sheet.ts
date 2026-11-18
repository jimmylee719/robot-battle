/**
 * 外部素材的入口（預留）：把「切片橫向排成一列」的 sprite sheet 轉成 StackModel。
 * 這是 sprite-stack 素材最常見的格式（MagicaVoxel 匯出切片、SpriteStack 等工具）。
 * 最左邊是最底層。P0 還沒有外部素材，這個函式尚未用真實圖檔測過。
 */
import { makeLayer, type StackLayer, type StackModel } from './stack';

export function modelFromSheet(
  sheet: ImageData,
  sliceW: number,
  sliceH: number,
  pivotX = sliceW / 2,
  pivotY = sliceH / 2,
): StackModel {
  const src = new Uint32Array(sheet.data.buffer, sheet.data.byteOffset, sheet.width * sheet.height);
  const count = Math.floor(sheet.width / sliceW);
  const layers: StackLayer[] = [];
  for (let i = 0; i < count; i++) {
    const pixels = new Uint32Array(sliceW * sliceH);
    for (let y = 0; y < sliceH; y++)
      for (let x = 0; x < sliceW; x++) {
        const c = src[y * sheet.width + i * sliceW + x];
        // alpha < 128 視為透明，其餘變成不透明
        pixels[y * sliceW + x] = c >>> 24 < 128 ? 0 : (c | 0xff000000) >>> 0;
      }
    layers.push(makeLayer(pixels, sliceW, sliceH));
  }
  return { w: sliceW, h: sliceH, pivotX, pivotY, layers };
}
