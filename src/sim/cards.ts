/**
 * 卡牌大腦：玩家不打字，而是把卡插進機器人的大腦。
 * 設計跟隨 Godot 版（~/Documents/prompt-cage 的 scripts/data/cards.gd），這裡是精簡版。
 *
 *  - 大腦決定卡槽數（Potato 2 格 … Mama 8 格）、反應速度、準確率，以及它固定的毛病。
 *  - 每張卡都佔注意力：第一張之後每多一張，反應慢 8%、準確率少 2%。
 *    三張互相配合的卡，勝過八張亂放。
 *  - 四種卡：流派（最多一張，決定平常怎麼打）、反射（什麼時候 → 做什麼）、
 *    個性（數值和習慣）、招牌（收尾的一招）。每張卡都有代價。
 *
 * 全部是純資料 + 純函式，結果只由卡組和大腦決定，可重播。
 */
import { START, type ModelSnapshot } from './model';
import { describeRule, type ActionKind, type Cond, type Rule } from './rules';
import type { RobotSpec } from './types';

export const ATTN_REACT = 0.08;
export const ATTN_ACC = 0.02;

export type BrainId = 'potato' | 'autofill' | 'parrot' | 'chatter' | 'nerd' | 'mama' | 'trained';
type Quirk = 'noWhen' | 'noNever' | 'mixWho' | null;

export interface BrainSpec {
  id: BrainId;
  name: string;
  slots: number;
  /** 每隔幾個 tick 才重新判斷一次該做什麼 */
  reaction: number;
  /** 每次下決定時，照原意執行的機率；沒中就會「聽錯」一下子 */
  accuracy: number;
  quirk: Quirk;
  /** 這顆大腦固定的毛病，給玩家看 */
  quirkText: string;
}

/** 名稱、卡槽數、反應時間照 Godot 版；準確率網頁版自己調過（招式少，聽錯的代價比較大） */
export const BRAINS: Record<BrainId, BrainSpec> = {
  potato: { id: 'potato', name: 'Potato 0.5B', slots: 2, reaction: 36, accuracy: 0.55, quirk: 'noWhen', quirkText: '看不懂「什麼時候」，反射卡會隨時亂發動' },
  autofill: { id: 'autofill', name: 'Autofill 1.0', slots: 3, reaction: 30, accuracy: 0.64, quirk: 'noNever', quirkText: '看不到「絕不」，會做出相反的事' },
  parrot: { id: 'parrot', name: 'Parrot 3', slots: 4, reaction: 23, accuracy: 0.72, quirk: 'mixWho', quirkText: '常搞混「自己」和「對手」' },
  chatter: { id: 'chatter', name: 'Chatter 4 Turbo', slots: 5, reaction: 17, accuracy: 0.8, quirk: null, quirkText: '' },
  nerd: { id: 'nerd', name: 'Nerd 5 Pro', slots: 6, reaction: 12, accuracy: 0.87, quirk: null, quirkText: '' },
  mama: { id: 'mama', name: 'Mama 2.7', slots: 8, reaction: 7, accuracy: 0.93, quirk: null, quirkText: '' },
  // 自訓模型：沒有固定準確率，每個動作各看熟練度（model.ts）
  trained: { id: 'trained', name: '自訓模型', slots: 6, reaction: 18, accuracy: START, quirk: null, quirkText: '' },
};

export type CardKind = 'style' | 'reflex' | 'trait' | 'signature';
export const KIND_NAME: Record<CardKind, string> = { style: '流派', reflex: '反射', trait: '個性', signature: '招牌' };

/** 卡牌對數值的影響，全部是倍率 */
export interface Mods {
  dmg?: number;
  taken?: number;
  speed?: number;
  poise?: number;
  kbTaken?: number;
  heavyDmg?: number;
  heavyWindup?: number;
  react?: number;
  acc?: number;
}

interface RuleDef {
  when?: Cond[];
  do: ActionKind;
  dash?: boolean;
  rest?: number;
}

export interface CardDef {
  id: string;
  kind: CardKind;
  name: string;
  text: string;
  /** 代價：這張卡讓你放棄什麼 */
  cost: string;
  rules: RuleDef[];
  mods?: Mods;
  /** 重拳蓄力時不會被刺拳打斷 */
  heavyArmor?: boolean;
  /** 擋下對手的拳時，對手會踉蹌 */
  parry?: boolean;
  /** 後退不會變慢 */
  footwork?: boolean;
  /** 這張卡是一句「絕不…」：禁止這些動作 */
  never?: ActionKind[];
}

const RETREATS: ActionKind[] = ['keepaway', 'kite', 'pokeKite', 'dashOut', 'slip'];

const LIST: CardDef[] = [
  // ---- 流派：沒有反射卡發動時，機器人就照流派打 ----
  {
    id: 'boxing',
    kind: 'style',
    name: '拳擊',
    text: '往前壓，用刺拳一直打；對手露出破綻才補重拳。看到重拳會舉手擋。',
    cost: '只會直直往前走，單發傷害低 12%。',
    rules: [
      { when: [{ kind: 'foeState', state: 'heavy' }], do: 'guard' },
      { when: [{ kind: 'foeState', state: 'open' }], do: 'heavy', rest: 60 },
      { do: 'jab' },
    ],
    mods: { dmg: 0.88 },
  },
  {
    id: 'outfighter',
    kind: 'style',
    name: '閃躲流',
    text: '在外圍游走，抓時機進去戳一下就走。步法好，後退不會變慢，走路追不上它。',
    cost: '不耐纏鬥，被黏住就很難脫身；會衝刺的對手追得上。',
    rules: [
      { when: [{ kind: 'foeState', state: 'attack' }, { kind: 'dist', op: '<', value: 34 }], do: 'dashOut' },
      { when: [{ kind: 'foeState', state: 'open' }, { kind: 'dist', op: '<', value: 40 }], do: 'jab' },
      { do: 'pokeKite' },
    ],
    mods: { speed: 1.12, dmg: 1.2 },
    footwork: true,
  },
  {
    id: 'brawler',
    kind: 'style',
    name: '街頭亂鬥',
    text: '衝上去猛攻，愛用重拳。重拳蓄力時刺拳打不斷它。',
    cost: '完全不防守，挨打痛 20%。',
    rules: [{ do: 'rush', dash: true }],
    mods: { taken: 1.2 },
    heavyArmor: true,
  },
  {
    id: 'taichi',
    kind: 'style',
    name: '太極',
    text: '站穩、防禦。擋下來的拳會被化掉，對手踉蹌露出破綻，再一拳打回去。',
    cost: '自己幾乎不先出手，腳步慢，拳頭輕 8%。很吃大腦的反應速度。',
    rules: [{ when: [{ kind: 'foeState', state: 'open' }], do: 'heavy' }, { do: 'counter' }],
    mods: { speed: 0.9, dmg: 0.92 },
    parry: true,
  },

  // ---- 反射：什麼時候 → 做什麼 ----
  {
    id: 'slip_counter',
    kind: 'reflex',
    name: '閃開就還手',
    text: '對手出招時：側閃，然後反擊。',
    cost: '自己從不先出手。',
    rules: [{ when: [{ kind: 'foeState', state: 'attack' }], do: 'slip' }, { when: [{ kind: 'foeState', state: 'open' }], do: 'heavy', rest: 40 }],
  },
  {
    id: 'punish',
    kind: 'reflex',
    name: '揮空就罰',
    text: '對手露出破綻時：當場用重拳讓它付出代價。',
    cost: '對手沒破綻就沒事做。',
    rules: [{ when: [{ kind: 'foeState', state: 'open' }], do: 'heavy', rest: 30 }],
  },
  {
    id: 'cage_press',
    kind: 'reflex',
    name: '壓上圍網',
    text: '對手靠網時：猛攻，把它釘在網邊。',
    cost: '在網邊就忘了防守。',
    rules: [{ when: [{ kind: 'edge', who: 'foe' }], do: 'rush' }],
  },
  {
    id: 'blitz',
    kind: 'reflex',
    name: '開場突襲',
    text: '一開場：開推進器衝上去猛攻。',
    cost: '開場那幾秒完全不防守。',
    rules: [{ when: [{ kind: 'time', value: 6 }], do: 'rush', dash: true }],
  },
  {
    id: 'second_wind',
    kind: 'reflex',
    name: '喘口氣',
    text: '自己血很少時：改成防禦，等對手露出破綻才出手。站得比較穩。',
    cost: '血少之後幾乎不主動進攻。',
    rules: [{ when: [{ kind: 'hp', who: 'self', op: '<', value: 25 }], do: 'counter' }],
    mods: { poise: 1.1 },
  },
  {
    id: 'smell_blood',
    kind: 'reflex',
    name: '見血就上',
    text: '對手血少時：開推進器衝上去猛攻。',
    cost: '想收尾就忘了防守。',
    rules: [{ when: [{ kind: 'hp', who: 'foe', op: '<', value: 35 }], do: 'rush', dash: true }],
  },
  {
    id: 'off_the_wall',
    kind: 'reflex',
    name: '離開網邊',
    text: '自己靠網時：走回擂台中央。',
    cost: '走回去的路上不會還手。',
    rules: [{ when: [{ kind: 'edge', who: 'self' }], do: 'center' }],
  },
  {
    id: 'shell_up',
    kind: 'reflex',
    name: '抱頭防守',
    text: '被連續猛打時：舉手格擋、站穩。平常也比較耐打（受傷 −10%）。',
    cost: '擋的時候不會還手。',
    rules: [{ when: [{ kind: 'pressured' }], do: 'guard' }],
    mods: { kbTaken: 0.9, taken: 0.9 },
  },
  {
    id: 'read_heavy',
    kind: 'reflex',
    name: '看穿重拳',
    text: '對手蓄力出重拳時：舉手格擋。',
    cost: '刺拳照樣吃。',
    rules: [{ when: [{ kind: 'foeState', state: 'heavy' }], do: 'guard' }],
  },
  {
    id: 'jab_jab',
    kind: 'reflex',
    name: '刺拳騷擾',
    text: '靠近時：不時戳一記刺拳，讓對手不敢亂來。腳步快 4%。',
    cost: '會蓋過流派本來的反應，例如來不及擋重拳。',
    rules: [{ when: [{ kind: 'dist', op: '<', value: 32 }], do: 'jab', rest: 90 }],
    mods: { speed: 1.04 },
  },
  {
    id: 'chase',
    kind: 'reflex',
    name: '追著打',
    text: '對手退到打不到的地方時：開推進器追上去。',
    cost: '會衝進對手的反擊。',
    rules: [{ when: [{ kind: 'dist', op: '>', value: 50 }], do: 'dashIn' }],
  },
  {
    id: 'hit_and_run',
    kind: 'reflex',
    name: '打了就跑',
    text: '腳步輕快。重重打中一下：馬上開推進器退開。',
    cost: '從不留下來收尾。',
    rules: [{ when: [{ kind: 'landedBig' }], do: 'dashOut' }],
    mods: { speed: 1.06 },
  },

  // ---- 個性：數值和習慣 ----
  {
    id: 'hothead',
    kind: 'trait',
    name: '暴躁',
    text: '被打中就抓狂衝上去猛攻。拳頭重 10%。',
    cost: '抓狂時不防守，挨打也痛 10%。',
    rules: [{ when: [{ kind: 'selfHit' }], do: 'rush' }],
    mods: { dmg: 1.1, taken: 1.1 },
  },
  {
    id: 'zen',
    kind: 'trait',
    name: '禪定',
    text: '心如止水：比較不會聽錯（準確率 +12%）。',
    cost: '腳步慢 8%。',
    rules: [],
    mods: { acc: 1.12, speed: 0.92 },
  },
  {
    id: 'overclocked',
    kind: 'trait',
    name: '超頻',
    text: '反應快 30%。',
    cost: '比較容易聽錯（準確率 −10%）。',
    rules: [],
    mods: { react: 0.7, acc: 0.9 },
  },
  {
    id: 'never_back',
    kind: 'trait',
    name: '絕不後退',
    text: '絕不後退、絕不閃躲。站得很穩，不容易被打飛、被擊倒。',
    cost: '所有要後退或閃開的動作都不做了。',
    rules: [],
    mods: { kbTaken: 0.6, poise: 1.2 },
    never: RETREATS,
  },

  // ---- 招牌：收尾的一招 ----
  {
    id: 'haymaker',
    kind: 'signature',
    name: '大擺拳',
    text: '對手露出破綻時：一記特別重的重拳（重拳傷害 +35%）。',
    cost: '重拳蓄力慢 10%。',
    rules: [{ when: [{ kind: 'foeState', state: 'open' }], do: 'heavy', rest: 40 }],
    mods: { heavyDmg: 1.35, heavyWindup: 1.1 },
  },
  {
    id: 'buzzer',
    kind: 'signature',
    name: '讀秒絕殺',
    text: '最後 10 秒：開推進器衝上去拚了。',
    cost: '最後 10 秒完全不防守。',
    rules: [{ when: [{ kind: 'timeLeft', value: 10 }], do: 'rush', dash: true }],
  },
];

export const CARDS: Record<string, CardDef> = Object.fromEntries(LIST.map((c) => [c.id, c]));
export const CARD_LIST: readonly CardDef[] = LIST;

/** 把卡組整理成合法的：只留認得的卡、不重複、最多一張流派、不超過卡槽數 */
export function legalDeck(deck: readonly string[], brain: BrainId): string[] {
  const out: string[] = [];
  let style = false;
  for (const id of deck) {
    const card = CARDS[id];
    if (!card || out.includes(id)) continue;
    if (card.kind === 'style') {
      if (style) continue;
      style = true;
    }
    if (out.length >= BRAINS[brain].slots) break;
    out.push(id);
  }
  return out;
}

export interface Program {
  brain: BrainSpec;
  deck: string[];
  /** 照優先度排好：招牌 → 流派自己的反射 → 反射和個性（照卡組順序）→ 流派的預設打法 */
  rules: Rule[];
  /** 「絕不…」禁止的動作 */
  bans: ActionKind[];
  mods: Required<Mods>;
  heavyArmor: boolean;
  parry: boolean;
  footwork: boolean;
  /** 算進注意力和卡牌之後的實際反應時間（tick）與準確率 */
  reaction: number;
  accuracy: number;
  /** 自訓模型才有：每個動作的熟練度（還要乘上 accScale）和習慣動作 */
  prof: Record<string, number> | null;
  habit: ActionKind | null;
  /** 注意力和卡牌對準確率的倍率 */
  accScale: number;
  /** 這顆大腦對每張卡的誤會，給玩家看 */
  notes: Record<string, string>;
}

/** 沒有流派卡時的打法：走過去，偶爾戳一下 */
const FREESTYLE: RuleDef = { do: 'jab', rest: 70 };
export const FREESTYLE_ID = 'freestyle';

/** 卡組 + 大腦 → 大腦實際執行的程式 */
export function compile(deckIn: readonly string[], brainId: BrainId, model: ModelSnapshot | null = null): Program {
  const brain = BRAINS[brainId];
  const deck = legalDeck(deckIn, brainId);
  const mods: Required<Mods> = { dmg: 1, taken: 1, speed: 1, poise: 1, kbTaken: 1, heavyDmg: 1, heavyWindup: 1, react: 1, acc: 1 };
  const notes: Record<string, string> = {};
  const bans: ActionKind[] = [];
  let heavyArmor = false;
  let parry = false;
  let footwork = false;
  const signature: Rule[] = [];
  const reflex: Rule[] = [];
  const style: Rule[] = [];

  const make = (card: string, def: RuleDef, isStyle: boolean): Rule => {
    const rule: Rule = {
      card,
      conds: (def.when ?? []).map((c) => ({ ...c })),
      action: def.do,
      dash: def.dash ?? false,
      rest: def.rest ?? 0,
      style: isStyle,
      understood: '',
    };
    // 大腦的固定毛病（流派是練到變本能的東西，不受影響）
    if (!isStyle && rule.conds.length) {
      if (brain.quirk === 'noWhen') {
        rule.conds = [];
        notes[card] = '沒看懂「什麼時候」，變成隨時都會做';
      } else if (brain.quirk === 'mixWho') {
        for (const c of rule.conds) {
          if (c.kind === 'hp' || c.kind === 'edge') {
            c.who = c.who === 'self' ? 'foe' : 'self';
            notes[card] = '搞混了「自己」和「對手」';
          }
        }
      }
    }
    rule.understood = describeRule(rule);
    return rule;
  };

  for (const id of deck) {
    const card = CARDS[id];
    for (const key of Object.keys(card.mods ?? {}) as (keyof Mods)[]) mods[key] *= card.mods![key]!;
    if (card.heavyArmor) heavyArmor = true;
    if (card.parry) parry = true;
    if (card.footwork) footwork = true;
    if (card.never) {
      if (brain.quirk === 'noNever') {
        // 看不到「絕不」：把禁止的事當成要做的事
        const rule = make(id, { do: 'keepaway' }, false);
        reflex.push(rule);
        notes[id] = '沒看到「絕不」，以為是叫它一直後退';
      } else bans.push(...card.never);
    }
    const bucket = card.kind === 'style' ? style : card.kind === 'signature' ? signature : reflex;
    for (const def of card.rules) bucket.push(make(id, def, card.kind === 'style'));
  }
  if (style.length === 0) style.push(make(FREESTYLE_ID, FREESTYLE, true));

  const extra = Math.max(0, deck.length - 1);
  return {
    brain,
    deck,
    // 流派自己的反射（有條件的那幾條）排在反射卡前面：插卡是幫流派「多學幾招」，不該蓋掉它本來會的
    rules: [...signature, ...style.filter((r) => r.conds.length > 0), ...reflex, ...style.filter((r) => r.conds.length === 0)],
    bans,
    mods,
    heavyArmor,
    parry,
    footwork,
    reaction: Math.max(2, Math.round(brain.reaction * mods.react * (1 + ATTN_REACT * extra))),
    accuracy: Math.max(0.05, Math.min(0.99, brain.accuracy * mods.acc * (1 - ATTN_ACC * extra))),
    prof: brainId === 'trained' ? { ...(model?.prof ?? {}) } : null,
    habit: brainId === 'trained' ? (model?.habit ?? null) : null,
    accScale: mods.acc * (1 - ATTN_ACC * extra),
    notes,
  };
}

/** 把卡牌的數值影響套到機器人身上 */
export function applyMods(spec: RobotSpec, program: Program): RobotSpec {
  const m = program.mods;
  return {
    ...spec,
    heavyArmor: spec.heavyArmor || program.heavyArmor,
    parry: spec.parry || program.parry,
    footwork: spec.footwork || program.footwork,
    walkSpeed: spec.walkSpeed * m.speed,
    damageTaken: spec.damageTaken * m.taken,
    maxPoise: spec.maxPoise * m.poise,
    knockbackTaken: spec.knockbackTaken * m.kbTaken,
    jab: { ...spec.jab, damage: spec.jab.damage * m.dmg },
    heavy: {
      ...spec.heavy,
      damage: spec.heavy.damage * m.dmg * m.heavyDmg,
      windup: Math.round(spec.heavy.windup * m.heavyWindup),
    },
  };
}
