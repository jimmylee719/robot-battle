/**
 * 規則：大腦實際執行的東西。「條件 → 動作」。
 * 卡牌（cards.ts）會編譯成規則；大腦（brain.ts）每次思考挑一條來做。
 */

export type Cond =
  | { kind: 'hp'; who: 'self' | 'foe'; op: '<' | '>'; value: number }
  | { kind: 'dist'; op: '<' | '>'; value: number }
  | { kind: 'foeState'; state: 'attack' | 'heavy' | 'down' | 'guard' | 'open' }
  | { kind: 'selfHit' }
  | { kind: 'pressured' }
  | { kind: 'landedBig' }
  | { kind: 'edge'; who: 'self' | 'foe' }
  | { kind: 'time'; value: number }
  | { kind: 'timeLeft'; value: number };

export type ActionKind =
  // 正常動作
  | 'rush'
  | 'jab'
  | 'heavy'
  | 'combo'
  | 'approach'
  | 'keepaway'
  | 'circle'
  | 'kite'
  | 'pokeKite'
  | 'guard'
  | 'slip'
  | 'counter'
  | 'dashIn'
  | 'dashOut'
  | 'center'
  | 'wait'
  | 'taunt'
  // 聽錯之後才會出現的動作
  | 'hideCorner'
  | 'spin'
  | 'shadowbox'
  | 'heavySpam'
  | 'bump'
  | 'guardBack'
  | 'dashRandom'
  | 'dashToward'
  | 'statue';

export const ACTION_TEXT: Record<ActionKind, string> = {
  rush: '衝上去猛攻',
  jab: '用刺拳打',
  heavy: '用重拳打',
  combo: '刺拳、刺拳、重拳',
  approach: '走到對手面前',
  keepaway: '跟對手保持距離',
  circle: '繞著對手轉',
  kite: '保持距離繞圈',
  pokeKite: '在外圍游走，抓時機進去戳一下',
  guard: '面對對手防禦',
  slip: '側閃躲開',
  counter: '防禦，等破綻再反擊',
  dashIn: '開推進器衝向對手',
  dashOut: '開推進器閃開',
  center: '回到擂台中央',
  wait: '發呆',
  taunt: '原地跳舞',
  hideCorner: '躲到圍網邊發呆',
  spin: '原地轉圈圈',
  shadowbox: '對著空氣連打',
  heavySpam: '原地一直揮重拳',
  bump: '用身體頂對手（不出拳）',
  guardBack: '背對對手抱頭防禦',
  dashRandom: '隨便挑個方向衝刺',
  dashToward: '往對手身上閃',
  statue: '在中央站著當雕像',
};

/** 聽錯對照表：固定的，所以玩家看得出規律 */
export const MISHEAR: Partial<Record<ActionKind, ActionKind>> = {
  rush: 'shadowbox',
  combo: 'shadowbox',
  jab: 'bump',
  approach: 'bump',
  heavy: 'heavySpam',
  keepaway: 'hideCorner',
  kite: 'hideCorner',
  pokeKite: 'spin',
  circle: 'spin',
  guard: 'guardBack',
  counter: 'statue',
  slip: 'dashToward',
  dashOut: 'dashToward',
  dashIn: 'dashRandom',
  center: 'statue',
};

export interface Rule {
  /** 這條規則來自哪張卡 */
  card: string;
  /** 全部成立才執行；空的 = 平常就做 */
  conds: Cond[];
  action: ActionKind;
  /** 要不要開推進器 */
  dash: boolean;
  /** 出手之後這條規則休息幾個 tick（反射是一瞬間，不是一種模式） */
  rest: number;
  /** 流派的規則：優先度最低，大腦的毛病影響不到（練到變本能了） */
  style: boolean;
  /** 大腦的理解，給玩家看 */
  understood: string;
  /** 被大腦的固定毛病改過（沒改就是 null）；orig 是正確理解下的條件 */
  quirk: 'noWhen' | 'noNever' | 'mixWho' | null;
  orig: Cond[] | null;
}

export function condText(c: Cond): string {
  switch (c.kind) {
    case 'hp':
      return `${c.who === 'self' ? '自己' : '對手'}血量 ${c.op} ${c.value}%`;
    case 'dist':
      return c.op === '<' ? '對手靠近' : '對手離得遠';
    case 'foeState':
      return { attack: '對手出拳', heavy: '對手出重拳', down: '對手倒地', guard: '對手防禦', open: '對手露出破綻' }[c.state];
    case 'selfHit':
      return '自己被打中';
    case 'pressured':
      return '被連續猛打';
    case 'landedBig':
      return '剛打中一記重的';
    case 'edge':
      return c.who === 'self' ? '自己在籠邊' : '對手在籠邊';
    case 'time':
      return `開場 ${c.value} 秒內`;
    case 'timeLeft':
      return `剩不到 ${c.value} 秒`;
  }
}

export function describeRule(rule: Pick<Rule, 'conds' | 'action' | 'dash'>): string {
  const when = rule.conds.length ? rule.conds.map(condText).join(' 且 ') : '平常';
  return `${when} → ${ACTION_TEXT[rule.action]}${rule.dash ? '（開推進器）' : ''}`;
}
