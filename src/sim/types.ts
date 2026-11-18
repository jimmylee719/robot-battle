/** 戰鬥邏輯的資料型別。全部是純資料，方便之後序列化、重播、移植。 */

export type AttackKind = 'jab' | 'heavy';

export type RobotAction =
  | 'idle'
  | 'windup' // 出拳前搖
  | 'recover' // 出拳後收招
  | 'guard'
  | 'stagger' // 被打到硬直
  | 'down' // 被擊倒躺在地上
  | 'getup' // 爬起來（無敵）
  | 'ko'
  | 'win';

/** 時間單位都是 tick（1/60 秒），距離單位是體素 */
export interface AttackSpec {
  windup: number;
  recover: number;
  /** 兩台機器人中心的最大距離 */
  reach: number;
  /** 正前方左右各幾弧度內打得到 */
  arc: number;
  damage: number;
  /** 削減對手的平衡值，歸零就擊倒 */
  poise: number;
  knockback: number;
  stun: number;
  /** 出拳瞬間往前踏的距離 */
  lunge: number;
}

/** 裝了哪些零件（定義在 gear.ts） */
export interface Loadout {
  weapon: 'fists' | 'spear' | 'hammer';
  armor: 'light' | 'heavy';
  thruster: 'standard' | 'turbo';
}

/** 機器人的數值：由裝備（gear.ts）算出來，再疊上卡牌的影響（cards.ts）。 */
export interface RobotSpec {
  name: string;
  /** 外觀要照這個畫 */
  loadout: Loadout;
  maxHp: number;
  maxPoise: number;
  walkSpeed: number;
  turnSpeed: number;
  radius: number;
  /** 受到傷害的倍率（裝甲） */
  damageTaken: number;
  /** 被擊退的倍率 */
  knockbackTaken: number;
  /** 重拳蓄力時不會被刺拳打斷 */
  heavyArmor: boolean;
  /** 擋下對手的拳時，對手會踉蹌 */
  parry: boolean;
  dashSpeed: number;
  dashTicks: number;
  dashCooldown: number;
  jab: AttackSpec;
  heavy: AttackSpec;
}

/**
 * 「大腦」每個 tick 交給身體的指令。
 * 由 brain.ts 依卡組編譯出來的規則產生。
 */
export interface Intent {
  /** 世界座標的移動方向，長度 0..1 */
  moveX: number;
  moveY: number;
  /** 想面對的方向（弧度） */
  face: number;
  attack: AttackKind | null;
  guard: boolean;
  dash: boolean;
  /** 給玩家看的「目前正在做什麼」 */
  label: string;
  /** 正在執行第幾條規則，-1 = 沒有規則符合 */
  rule: number;
  /** 這一刻是不是聽錯了 */
  fumble: boolean;
}

export interface Robot {
  id: number;
  spec: RobotSpec;
  x: number;
  y: number;
  heading: number;
  /** 被擊退的速度 */
  kx: number;
  ky: number;
  hp: number;
  poise: number;
  action: RobotAction;
  actionTicks: number;
  attack: AttackKind;
  /** 這一拳用哪隻手：0 左 1 右 */
  arm: 0 | 1;
  strikeNow: boolean;
  stunTicks: number;
  dashTicks: number;
  dashCd: number;
  dashX: number;
  dashY: number;
  moving: boolean;
  walkPhase: number;
  /** 剛被打到，畫面閃白用 */
  hitFlash: number;
  /** 格擋硬直：擋下一拳之後還要僵幾個 tick */
  blockStun: number;
  /** 距離上次被打中過了幾個 tick */
  sinceHit: number;
  /** 短時間內連續被打中幾下（隔 2.5 秒沒被打就歸零） */
  hitStreak: number;
  label: string;
  /** 距離上次打中一記重拳過了幾個 tick */
  sinceLandedBig: number;
  /** 正在執行第幾條規則，-1 = 沒有規則符合 */
  ruleIndex: number;
  /** 這一刻是不是聽錯了 */
  fumbling: boolean;
}

/** 邏輯層丟給畫面／音效的事件。畫面只能讀，不能回頭影響邏輯。 */
export type SimEvent =
  | { type: 'count'; n: number }
  | { type: 'start' }
  | { type: 'swing'; robot: number; kind: AttackKind }
  | { type: 'whiff'; robot: number; kind: AttackKind }
  | {
      type: 'hit';
      attacker: number;
      target: number;
      kind: AttackKind;
      x: number;
      y: number;
      blocked: boolean;
      counter: boolean;
      damage: number;
    }
  | { type: 'down'; robot: number }
  | { type: 'getup'; robot: number }
  | { type: 'ko'; robot: number }
  | { type: 'dash'; robot: number }
  | { type: 'cage'; robot: number; x: number; y: number }
  | { type: 'end'; winner: number };
