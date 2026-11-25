/**
 * 平衡用的關鍵數值，集中在這裡。
 * 開發工具（dev/bench.ts 的 tune）會暫時改這張表來搜尋比較平衡的組合；
 * 遊戲本身只讀不改，所以同一版程式的結果還是固定的。
 */
export const TUNE = {
  /** 擋下一拳，平衡值扣幾成 */
  blockPoise: 0.71,
  /** 砸穿防禦（街頭亂鬥的重拳被擋）：傷害、平衡值、硬直各剩幾成 */
  crushDamage: 0.7,
  crushPoise: 0.5,
  crushStun: 0.92,
  /** 霸體蓄力時挨打，平衡值只扣幾成 */
  armorPoise: 0.42,
  /** 化勁（太極擋下刺拳）讓對手踉蹌幾個 tick（實際還會乘上硬直的隨機浮動） */
  parryStun: 21.73,
  /** 化勁只對打擊距離在這以內的刺拳有用：長矛（30）從外圍戳過來，手搭不到，化不掉 */
  parryReach: 27,
  /** 每一次硬直的長短隨機浮動 ±這麼多。沒有浮動的話，誰先出手完全由固定的 tick 數決定，對戰會變成一面倒 */
  stunJitter: 0.2,
  /** 有霸體的機器人平常出重拳的機率 */
  armoredHeavy: 0.34,
  /** 每個 tick 回的能量（0.19 ≈ 每秒 11 點） */
  energyRegen: 0.19,
  /** 沒電之後要回到多少電才能再出手 */
  gassedUntil: 45,
  /** 裁判中止：連續挨幾下沒還手、而且血量低於幾成，就中止比賽（TKO） */
  tkoStreak: 8,
  tkoHp: 0.25,
  /** 被擊倒時血量低於幾成，裁判直接揮手結束 */
  tkoDownHp: 0.06,
  /** 一回合被擊倒幾次就 TKO（UFC 沒有三次倒地規則，這裡放寬到四次，多一點 K.O.） */
  tkoKnockdowns: 4,
  /** 局間休息回多少能量（缺的那部分的幾成） */
  breakEnergy: 0.5,
  /** 血量整體倍率 */
  hpScale: 1.8,
  /** 作戰計畫：這回合的戰術克制對手的，傷害和削平衡值的倍率 */
  counterBonus: 1.15,
  /** 地板追擊：踩一下的傷害（跳上去打再乘 leapDamage）、耗電、一次倒地最多追擊幾下 */
  poundDamage: 5,
  leapDamage: 1.35,
  poundEnergy: 9,
  poundMax: 2,
  /** 被追擊時掙脫的機率：基本 + 血量比例 × 這個 */
  escapeBase: 0.2,
  escapeHp: 0.35,
  /** 裁判拉住追擊者幾個 tick；躺成大字型的那台多躺（多恢復）幾個 tick，順便回多少平衡值和血 */
  refHold: 80,
  refRecover: 40,
  refHeal: 4,
};
