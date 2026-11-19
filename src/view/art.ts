/**
 * 插圖。`src/art/` 裡的 .webp 會自動被收進來：檔名就是 id（卡牌用卡的 id，對手用 `foe_` 加對手 id）。
 * 沒有圖的就不顯示，所以圖可以一張一張補。圖很小（72×72、約 1.5 KB），打包時直接內嵌，不多發請求。
 */
const files = import.meta.glob('../art/*.webp', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

const ART: Record<string, string> = {};
for (const path of Object.keys(files)) ART[path.slice(path.lastIndexOf('/') + 1, -5)] = files[path];

/** 這個 id 的插圖；沒有就回傳 null */
export function artFor(id: string): HTMLImageElement | null {
  const url = ART[id];
  if (!url) return null;
  const img = new Image();
  img.src = url;
  img.className = 'art';
  img.alt = '';
  img.loading = 'lazy';
  return img;
}
