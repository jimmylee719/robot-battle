/**
 * 音效介面。遊戲其他部分只認這個介面，不知道聲音是怎麼來的。
 * 現在的實作是 audio/synth.ts（Web Audio 即時合成）；
 * 之後換成音檔，只要再寫一個實作同樣介面的 SamplePlayer。
 */
export type SoundId =
  | 'jab'
  | 'heavy'
  | 'block'
  | 'whiff'
  | 'down'
  | 'ko'
  | 'dash'
  | 'cage'
  | 'count'
  | 'bell'
  | 'end'
  /** 觀眾的歡呼（音量 = 多激動） */
  | 'crowd'
  /** 扭蛋：轉把手、蛋殼打開、抽到稀有 */
  | 'crank'
  | 'pop'
  | 'rare';

export interface SoundOptions {
  /** 0..1，預設 1 */
  volume?: number;
  /** -1（左）.. 1（右），預設 0 */
  pan?: number;
}

export interface SoundPlayer {
  /** 瀏覽器規定要有使用者操作才能出聲，第一次點擊時呼叫 */
  unlock(): void;
  play(id: SoundId, opts?: SoundOptions): void;
  setMuted(muted: boolean): void;
  readonly muted: boolean;
}
