/**
 * 指令理解器：把玩家寫的戰術 prompt 變成機器人的規則清單。
 * 原型階段不串 LLM，用關鍵字 + 條件句解析。純邏輯、可重播：
 * 同樣的 prompt、AI 等級、亂數種子，一定得到同一份規則（包含誤解）。
 *
 * 流程：切句 → 每一段找「條件」和「動作」→ 依 AI 等級刪減、誤解 → Program
 */
import type { Rng } from '../core/rng';

export const PROMPT_MAX = 120;

export type Tier = 'lite' | 'pro' | 'ultra';

export interface TierSpec {
  id: Tier;
  name: string;
  /** 最多記得住幾條規則，多的直接丟掉 */
  maxRules: number;
  /** 每隔幾個 tick 才重新判斷一次該執行哪條規則（反應延遲） */
  reaction: number;
  /** 每條規則被誤解的機率 */
  misread: number;
  blurb: string;
}

export const TIERS: Record<Tier, TierSpec> = {
  lite: { id: 'lite', name: 'Lite', maxRules: 2, reaction: 24, misread: 0.4, blurb: '記得住 2 條・反應慢・常常誤解' },
  pro: { id: 'pro', name: 'Pro', maxRules: 4, reaction: 11, misread: 0.1, blurb: '記得住 4 條・反應普通・偶爾誤解' },
  ultra: { id: 'ultra', name: 'Ultra', maxRules: 8, reaction: 5, misread: 0, blurb: '記得住 8 條・反應快・不會誤解' },
};

export type Cond =
  | { kind: 'hp'; who: 'self' | 'foe'; op: '<' | '>'; value: number }
  | { kind: 'dist'; op: '<' | '>'; value: number }
  | { kind: 'foeState'; state: 'attack' | 'heavy' | 'down' | 'guard' | 'open' }
  | { kind: 'selfHit' }
  | { kind: 'edge'; who: 'self' | 'foe' }
  | { kind: 'time'; value: number }
  | { kind: 'timeLeft'; value: number }
  | { kind: 'dashReady' };

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
  | 'guard'
  | 'counter'
  | 'dashIn'
  | 'dashOut'
  | 'corner'
  | 'center'
  | 'wait'
  | 'taunt'
  // 誤解之後才會出現的動作
  | 'hideCorner'
  | 'spin'
  | 'shadowbox'
  | 'heavySpam'
  | 'bump'
  | 'guardBack'
  | 'dashRandom'
  | 'dashToward'
  | 'selfCorner'
  | 'statue'
  | 'waitForever';

export const ACTION_TEXT: Record<ActionKind, string> = {
  rush: '衝上去連打',
  jab: '用刺拳打',
  heavy: '用重拳打',
  combo: '刺拳接重拳',
  approach: '走到對手面前',
  keepaway: '跟對手保持距離',
  circle: '繞著對手轉',
  kite: '保持距離繞圈',
  guard: '面對對手防禦',
  counter: '防禦，等破綻再反擊',
  dashIn: '開推進器衝向對手',
  dashOut: '開推進器閃開',
  corner: '把對手逼向籠邊',
  center: '佔住擂台中央',
  wait: '原地觀察',
  taunt: '原地跳舞',
  hideCorner: '躲到角落發呆',
  spin: '原地轉圈圈',
  shadowbox: '對著空氣連打',
  heavySpam: '原地一直揮重拳',
  bump: '用身體頂對手（不出拳）',
  guardBack: '背對對手抱頭防禦',
  dashRandom: '隨便挑個方向衝刺',
  dashToward: '往對手身上閃避',
  selfCorner: '自己走去角落站好',
  statue: '在中央站著當雕像',
  waitForever: '一直等，等到天荒地老',
};

/** 誤解對照表：固定的，所以玩家看得出規律 */
const MISREAD: Partial<Record<ActionKind, { to: ActionKind; why: string }>> = {
  keepaway: { to: 'hideCorner', why: '把「保持距離」理解成離得越遠越好' },
  kite: { to: 'hideCorner', why: '把「保持距離」理解成離得越遠越好' },
  circle: { to: 'spin', why: '把「繞圈」理解成自己轉圈' },
  rush: { to: 'shadowbox', why: '只聽到「連打」，沒聽到要打誰' },
  combo: { to: 'shadowbox', why: '只聽到「連打」，沒聽到要打誰' },
  heavy: { to: 'heavySpam', why: '只記得「重拳」，忘了要先走過去' },
  jab: { to: 'bump', why: '把「刺」理解成用身體頂' },
  approach: { to: 'bump', why: '靠近之後不知道要停' },
  guard: { to: 'guardBack', why: '搞錯防禦的方向' },
  counter: { to: 'waitForever', why: '只記得「等」，忘了要反擊' },
  dashIn: { to: 'dashRandom', why: '知道要衝，不知道往哪衝' },
  dashOut: { to: 'dashToward', why: '搞反了閃避的方向' },
  corner: { to: 'selfCorner', why: '搞錯是誰要去角落' },
  center: { to: 'statue', why: '佔住中央之後就不動了' },
};

export interface Rule {
  /** 玩家寫的原文 */
  source: string;
  /** 全部成立才執行；空的 = 平常就做 */
  conds: Cond[];
  action: ActionKind;
  /** 要不要開推進器 */
  dash: boolean;
  /** 機器人的理解，給玩家看 */
  understood: string;
  misread: boolean;
  /** 誤解的原因 */
  note: string;
}

export interface Program {
  tier: TierSpec;
  prompt: string;
  rules: Rule[];
  /** 沒變成規則的句子，以及原因 */
  ignored: { source: string; reason: string }[];
  /** 有「然後／接著」：沒有條件的規則照順序做，而不是輪流做 */
  sequential: boolean;
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
    case 'edge':
      return c.who === 'self' ? '自己在籠邊' : '對手在籠邊';
    case 'time':
      return `開場 ${c.value} 秒內`;
    case 'timeLeft':
      return `剩不到 ${c.value} 秒`;
    case 'dashReady':
      return '推進器可用';
  }
}

function describe(rule: Pick<Rule, 'conds' | 'action' | 'dash'>): string {
  const when = rule.conds.length ? rule.conds.map(condText).join(' 且 ') : '平常';
  return `${when} → ${ACTION_TEXT[rule.action]}${rule.dash ? '（開推進器）' : ''}`;
}

// ---------- 關鍵字 ----------

const FOE = '(?:對手|敵人|對方|敵方|他|它)';
/** 條件裡主詞和動詞之間可以夾的字（不能跨過「就／時／則」） */
const GAP = '[^，,。；;就時則便]';

/** 找到一段就把它塗掉，後面的規則才不會重複比對到同一段字 */
class Scanner {
  constructor(public text: string) {}

  take(pattern: string): RegExpExecArray | null {
    const m = new RegExp(pattern, 'i').exec(this.text);
    if (!m) return null;
    this.text = this.text.slice(0, m.index) + '＿'.repeat(m[0].length) + this.text.slice(m.index + m[0].length);
    return m;
  }
}

function isFoe(word: string | undefined): boolean {
  return !!word && new RegExp(FOE).test(word);
}

/** 要先比對的動作：這些詞裡面有「對手」「角落」之類的字，會被條件誤認 */
const STRONG_ACTIONS: [ActionKind, string][] = [
  ['corner', `(?:逼|壓|推|趕|擠)(?:到|進|向|去|往)?${GAP}{0,2}(?:角落|籠邊|邊緣|牆|角)`],
  ['keepaway', `保持${GAP}{0,2}距離|拉開${GAP}{0,2}距離|遠離${FOE}?|離${FOE}遠`],
  ['approach', `(?:靠近|接近|逼近|貼近)${FOE}`],
  ['center', `(?:佔|占|站|守|回|待在|搶)${GAP}{0,3}(?:中間|中央|中心|中場)`],
  ['counter', `等${GAP}{0,4}(?:出手|出拳|攻擊|破綻)`],
];

const ACTIONS: [ActionKind, string][] = [
  ['counter', '反擊|後發制人|抓破綻'],
  ['combo', '連段|組合拳|連招|combo'],
  ['rush', '連打|猛攻|狂攻|狂打|全力|進攻|攻擊|打他|揍|打爆|輸出|壓制|rush|attack'],
  ['heavy', '重拳|重擊|大招|蓄力|heavy'],
  ['jab', '刺拳|輕拳|快拳|戳|jab'],
  ['guard', '防禦|格擋|防守|擋|guard|block'],
  ['circle', '繞圈|繞|游走|側移|周旋|走位|circle'],
  ['dashOut', '後撤|閃避|閃開|迴避|躲開'],
  ['keepaway', '撤退|後退|逃跑|逃|躲|退開'],
  ['dashIn', '衝刺|突進|衝過去|衝上去|衝鋒|推進器|dash'],
  ['approach', '靠近|接近|逼近|貼近|貼身|近身|上前'],
  ['wait', '等待|待機|不要動|別動|觀察|站著|休息|wait'],
  ['taunt', '嘲諷|挑釁|跳舞|嘲笑|taunt'],
];

const NEGATION = /不要|不准|禁止|不可以|不能|不可|避免|別/;
const SEQUENCER = /然後|接著|之後|再來|最後|再/;

interface Parsed {
  conds: Cond[];
  action: ActionKind | null;
  dash: boolean;
}

function parseSegment(seg: string): Parsed {
  const s = new Scanner(seg);
  const found: { kind: ActionKind; at: number }[] = [];
  const conds: Cond[] = [];
  let m: RegExpExecArray | null;

  for (const [kind, pattern] of STRONG_ACTIONS) if ((m = s.take(pattern))) found.push({ kind, at: m.index });

  // 血量：有數字
  const who = `(${FOE}|自己|我方|我)?的?`;
  while ((m = s.take(`${who}(?:血量|血條|血|HP|生命值|生命|體力)${GAP}{0,8}?(\\d+|一半|半)\\s*[%％]?(?:以下|以上)?`))) {
    const n = /\d/.test(m[2]) ? Math.max(1, Math.min(99, parseInt(m[2], 10))) : 50;
    conds.push({
      kind: 'hp',
      who: isFoe(m[1]) ? 'foe' : 'self',
      op: /高於|大於|多於|超過|以上|>|＞/.test(m[0]) ? '>' : '<',
      value: n,
    });
  }
  // 血量：沒數字
  if ((m = s.take(`${who}(?:殘血|快死|快沒血|沒血|血量?${GAP}{0,2}[低少])`)))
    conds.push({ kind: 'hp', who: isFoe(m[1]) ? 'foe' : 'self', op: '<', value: 30 });
  if ((m = s.take(`${who}(?:滿血|血量?${GAP}{0,2}[高多])`)))
    conds.push({ kind: 'hp', who: isFoe(m[1]) ? 'foe' : 'self', op: '>', value: 70 });

  // 對手的狀態
  if (s.take(`${FOE}${GAP}{0,2}(?:出重拳|重拳|重擊|蓄力)`)) conds.push({ kind: 'foeState', state: 'heavy' });
  if (s.take(`${FOE}${GAP}{0,2}(?:出拳|出手|攻擊|進攻|揮拳|打過來|打我|刺拳)`)) conds.push({ kind: 'foeState', state: 'attack' });
  if (s.take(`${FOE}${GAP}{0,2}(?:倒地|倒下|被擊倒|躺)`)) conds.push({ kind: 'foeState', state: 'down' });
  if (s.take(`${FOE}${GAP}{0,1}(?:防禦|格擋|防守|擋)`)) conds.push({ kind: 'foeState', state: 'guard' });
  if (s.take(`${FOE}${GAP}{0,3}(?:收招|破綻|硬直|揮空|打空|落空)`)) conds.push({ kind: 'foeState', state: 'open' });

  // 距離
  if (s.take(`${FOE}${GAP}{0,2}(?:靠近|接近|近身|貼身|逼近|衝過來|太近|很近|過來)|(?:距離|離)${GAP}{0,3}(?:太近|很近|近)`))
    conds.push({ kind: 'dist', op: '<', value: 32 });
  if (s.take(`${FOE}${GAP}{0,2}(?:遠離|很遠|太遠|拉開|逃跑|逃|後退|跑掉|跑)|(?:距離|離)${GAP}{0,3}(?:太遠|很遠|遠)`))
    conds.push({ kind: 'dist', op: '>', value: 50 });

  // 位置、受傷、推進器、時間
  if (s.take(`${FOE}${GAP}{0,4}(?:角落|籠邊|邊緣|牆)`)) conds.push({ kind: 'edge', who: 'foe' });
  if (s.take(`(?:被逼到|我在|自己在|退到|靠)${GAP}{0,3}(?:角落|籠邊|邊緣|牆)`)) conds.push({ kind: 'edge', who: 'self' });
  if (s.take('被打中?|挨打|被擊中|受傷|中拳|挨揍')) conds.push({ kind: 'selfHit' });
  if (s.take(`推進器${GAP}{0,3}(?:好了|冷卻完|可用|能用|充能完)`)) conds.push({ kind: 'dashReady' });
  if ((m = s.take('前\\s*(\\d+)\\s*秒|開場|一開始|開局|剛開始')))
    conds.push({ kind: 'time', value: m[1] ? Math.max(1, Math.min(59, parseInt(m[1], 10))) : 6 });
  if ((m = s.take('(?:最後|剩下?|剩餘|倒數)\\s*(\\d+)\\s*秒|時間快到|快結束|讀秒')))
    conds.push({ kind: 'timeLeft', value: m[1] ? Math.max(1, Math.min(59, parseInt(m[1], 10))) : 10 });

  for (const [kind, pattern] of ACTIONS) if ((m = s.take(pattern))) found.push({ kind, at: m.index });
  if (found.length === 0) return { conds, action: null, dash: false };

  found.sort((a, b) => a.at - b.at);
  const has = (k: ActionKind): boolean => found.some((f) => f.kind === k);
  // 「衝刺」和別的動作寫在一起時，當成「做那個動作時開推進器」
  const others = found.filter((f) => f.kind !== 'dashIn' && f.kind !== 'dashOut');
  if (has('circle') && has('keepaway')) return { conds, action: 'kite', dash: false };
  if (others.length === 0) return { conds, action: found[0].kind, dash: false };
  return { conds, action: others[0].kind, dash: has('dashIn') || has('dashOut') };
}

/** prompt → 規則清單。rng 只用來決定誤解，每條規則固定抽兩次，結果才穩定。 */
export function interpret(prompt: string, tier: TierSpec, rng: Rng): Program {
  const text = prompt.slice(0, PROMPT_MAX);
  const program: Program = { tier, prompt: text, rules: [], ignored: [], sequential: false };
  const lite = tier.id === 'lite';
  const draft: Rule[] = [];

  for (const sentence of text.split(/[。.；;！!？?\n]+/)) {
    // 只有條件、沒有動作的那一段（例如「如果對手靠近，」）留給下一段用
    let pending: { conds: Cond[]; source: string } | null = null;
    for (const raw of sentence.split(/[，,、]+/)) {
      const seg = raw.trim();
      if (!seg) continue;
      const p = parseSegment(seg);
      if (!p.action) {
        if (p.conds.length) pending = { conds: p.conds, source: seg };
        else if (lite)
          draft.push({ source: seg, conds: [], action: 'taunt', dash: false, understood: '', misread: true, note: '聽不懂，先跳舞再說' });
        else program.ignored.push({ source: seg, reason: '聽不懂，略過' });
        continue;
      }
      const source: string = pending ? `${pending.source}，${seg}` : seg;
      const rule: Rule = {
        source,
        conds: pending ? [...pending.conds, ...p.conds] : p.conds,
        action: p.action,
        dash: p.dash,
        understood: '',
        misread: false,
        note: '',
      };
      pending = null;
      if (NEGATION.test(seg)) {
        if (!lite) {
          program.ignored.push({ source, reason: '收到，不會主動做這件事' });
          continue;
        }
        rule.misread = true;
        rule.note = '沒注意到「不要」';
      }
      if (rule.conds.length === 0 && SEQUENCER.test(seg)) program.sequential = true;
      draft.push(rule);
    }
    if (pending) program.ignored.push({ source: pending.source, reason: '只有條件，不知道要做什麼' });
  }

  for (const rule of draft) {
    if (program.rules.length >= tier.maxRules) {
      program.ignored.push({ source: rule.source, reason: `記不住（${tier.name} 最多 ${tier.maxRules} 條）` });
      continue;
    }
    const notes: string[] = rule.note ? [rule.note] : [];

    // Lite 的固定毛病：只看得懂一個條件、看不懂百分比
    if (lite) {
      if (rule.conds.length > 1) {
        rule.conds = [rule.conds[0]];
        notes.push('只看懂第一個條件');
      }
      const c = rule.conds[0];
      if (c && c.kind === 'hp' && c.value !== 50) {
        c.value = 50;
        notes.push('看不懂百分比，當成一半');
      }
    }

    const roll = rng.next();
    const pick = rng.next();
    if (roll < tier.misread) {
      const c = rule.conds[0];
      const swap = MISREAD[rule.action];
      if (c && (pick < 0.4 || !swap)) {
        if (c.kind === 'hp' && pick < 0.2) {
          c.who = c.who === 'self' ? 'foe' : 'self';
          notes.push('搞錯是誰的血量');
        } else if (c.kind === 'hp') {
          c.op = c.op === '<' ? '>' : '<';
          notes.push('把「低於」和「高於」搞反');
        } else {
          rule.conds = [];
          notes.push('忽略條件，隨時都這樣做');
        }
      } else if (swap) {
        rule.action = swap.to;
        rule.dash = false;
        notes.push(swap.why);
      }
    }

    rule.misread = notes.length > 0;
    rule.note = notes.join('；');
    rule.understood = describe(rule);
    program.rules.push(rule);
  }
  return program;
}
