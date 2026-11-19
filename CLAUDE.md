# PROMPT CAGE

1v1 機器人格鬥網頁遊戲：玩家選裝備、選大腦、把卡牌插進大腦（之後還有訓練模型），機器人照自己的理解自動打。
設計以 Godot 版 `~/Documents/prompt-cage` 的 `README.md` 為準（那邊的 CLAUDE.md 還停在「打字下指令」，已過時）；網頁版是同一套規則的精簡版，做新系統前先看那邊怎麼做。
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
- **可重播**：戰鬥邏輯固定 60Hz 步進，亂數只用 `core/rng.ts` 的種子亂數，三角函數只用 `core/fmath.ts`（`Math.sin/cos/atan2` 跨瀏覽器不保證一致），不用 `Math.random`、不用時間。純畫面特效（`view/fx.ts`）不在此限。
- 不串 LLM API。卡牌編譯成「條件 → 動作」規則；大腦等級決定卡槽數、反應延遲、準確率和固定的毛病；每多一張卡都要付注意力成本。
- 戰鬥畫面要即時顯示機器人正在用哪張卡、哪一條規則，以及什麼時候聽錯。

## 目錄

- `src/core/` 共用純邏輯（rng、fmath）
- `src/sim/` 戰鬥邏輯：`gear.ts`（裝備、預算、裝備 → 數值）、`cards.ts`（卡牌、大腦、卡組 → 規則）、`rules.ts`（條件與動作）、`brain.ts`（規則 → 每個 tick 的 Intent，含聽錯）、`match.ts`（身體、判定、勝負）、`model.ts`（自訓模型的熟練度）、`temper.ts`（性格）、`camp.ts`（訓練營、賽後成長、隨機機器人）、`roster.ts`（單人模式的五個對手）、`album.ts`（卡牌怎麼贏來）、`share.ts`（重播 ↔ 分享連結，解開後一律清洗；戰鬥規則改到舊連結會重跑出不同結果時，`VERSION` 要加一）。一場對戰完全由「種子 + 兩邊的 RobotSetup（名字、裝備、大腦、卡組、模型快照、性格）」決定；玩家的進度存在 localStorage（`view/save.ts`），開打時凍結成快照；每個 tick 丟出事件（`SimEvent`），畫面和音效只能讀事件，不能回頭影響邏輯
- `src/render/` sprite-stack 渲染器與模型格式
- `src/models/` 模型資料
- `src/view/` 把 sim 狀態畫出來、特效、HUD；`director.ts` 把事件變成特效和音效
- `src/audio/` 音效介面（`sound.ts`）與 Web Audio 合成實作（`synth.ts`）
- `src/input/` 輸入
- `src/dev/` 開發工具，不會打包進遊戲。`bench.ts` 是平衡基準測試：`npm run dev` 後在瀏覽器主控台跑 `(await import('/src/dev/bench.ts')).runBench()`。改戰鬥數值、卡牌或對手之後要重跑，並把 `sim/share.ts` 的 `VERSION` 加一

## 開發方式

- 分階段（P0、P1…），每個階段結束都要 `npm run dev` 打開就能玩，並說明這階段可以測什麼。
- 階段通過驗證才 commit：能執行、`npm run typecheck` 沒錯、核心功能在瀏覽器實際測過。訊息格式 `P0: 階段名稱`，回報時附 commit hash。
- 做完一個階段就停下來等確認，不自動往下做。
- 遊戲設計細節可自行決定，做完說明理由。
