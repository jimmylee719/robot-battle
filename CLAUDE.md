# PROMPT CAGE

1v1 機器人格鬥網頁遊戲：玩家選裝備、選 AI 等級、寫戰術 prompt，機器人照自己的理解自動打。
世界觀見 WORLD.md（佔位）。這份文件只記技術規格和開發方式，遊戲設計不在這裡限制。

## 技術規格

- Vite + TypeScript（strict）+ 原生 Canvas 2D。不用遊戲引擎或渲染函式庫（Three.js、Phaser、Pixi 都不用）。
- 畫面是 sprite-stack 軟體渲染：物件是一疊水平切片，每層往上 1 像素，可任意旋轉；先畫進 320×180 的像素緩衝區，再整數倍、硬邊放大（`imageSmoothingEnabled = false`）。
- 模型用程式內資料定義（體素 + 調色盤），不依賴外部美術檔；渲染器只認 `StackModel`，外部切片圖走 `render/sheet.ts`。
- 攝影機可旋轉、縮放；打擊要有震動、閃白、粒子。
- 音效用 Web Audio API 即時合成，介面要能之後換成音檔。
- 輸入：鍵盤滑鼠、觸控、搖桿（Gamepad API）。
- 目標平台 CrazyGames / Poki：載入快、檔案小、手機瀏覽器能玩。之後可能移植 Godot。
- **邏輯和畫面分開**：`src/sim/`、`src/core/` 不可以 import DOM、Canvas、音效或 `render/`、`view/`、`input/` 的東西。
- **可重播**：戰鬥邏輯固定 60Hz 步進，亂數只用 `core/rng.ts` 的種子亂數，不用 `Math.random`、不用時間。純畫面特效（`view/fx.ts`）不在此限。
- 原型不串 LLM API，用本地的「指令理解器」把 prompt 解析成規則；AI 等級決定規則數、反應延遲、誤解機率。
- 戰鬥畫面要即時顯示機器人正在執行哪一條指令。

## 目錄

- `src/core/` 共用純邏輯（rng）
- `src/sim/` 戰鬥邏輯
- `src/render/` sprite-stack 渲染器與模型格式
- `src/models/` 模型資料
- `src/view/` 把 sim 狀態畫出來、特效
- `src/input/` 輸入

## 開發方式

- 分階段（P0、P1…），每個階段結束都要 `npm run dev` 打開就能玩，並說明這階段可以測什麼。
- 階段通過驗證才 commit：能執行、`npm run typecheck` 沒錯、核心功能在瀏覽器實際測過。訊息格式 `P0: 階段名稱`，回報時附 commit hash。
- 做完一個階段就停下來等確認，不自動往下做。
- 遊戲設計細節可自行決定，做完說明理由。
