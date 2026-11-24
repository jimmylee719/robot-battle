/**
 * 失誤演出（純畫面）：讀模擬送出的 misfire 事件，在機器人頭上冒出對話框寫它「以為」的指令，
 * 配上慢動作特寫、球評吐槽、觀眾反應。全部只讀事件和狀態，不回頭影響模擬。
 * 挑哪一句用演出專用的亂數（showRng.ts），同一個種子每次一樣。
 *
 * 頻率控制：同一方 3 秒內不重複演出、兩邊的對話框至少隔 1.5 秒。
 * 慢動作特寫只給「好笑分數」最高的失誤：開打時用同一個種子無畫面先跑完整場（plan），
 * 算出每次失誤持續多久、期間挨了幾下、有沒有被打倒，給分（固定毛病 > 聽錯 > 慢半拍），
 * 每回合最多 2 次、兩次至少隔 5 秒；其他失誤只冒對話框加球評，不減速、不動鏡頭。快轉時都不做慢動作。
 * 回合開始的 FIGHT! / ROUND N 還在畫面上時，對話框先排隊，字樣消失再出來。
 * 不管有沒有演出，每一次失誤都記在 records 裡（賽後「本場最佳失誤」、挑精華片段用）。
 */
import { BRAINS, CARDS } from '../sim/cards';
import { createMatch, stepMatch, TICK_HZ, type Match, type RobotSetup } from '../sim/match';
import { ACTION_TEXT, type ActionKind } from '../sim/rules';
import type { MisfireEvent, MisfireKind } from '../sim/types';
import type { SoundPlayer } from '../audio/sound';
import type { Renderer } from '../render/renderer';
import type { Commentator } from './commentary';
import type { Fx } from './fx';
import { ShowRng } from './showRng';

/** 演出用的分類：聽錯的再依實際做出的動作細分 */
export type ShowKind = 'air' | 'spam' | 'turtle' | 'wrongway' | 'statue' | 'noWhen' | 'noNever' | 'mixWho' | 'slow';

export function showKind(kind: MisfireKind, actual: ActionKind): ShowKind {
  if (kind !== 'mishear') return kind;
  switch (actual) {
    case 'heavySpam':
      return 'spam';
    case 'guardBack':
      return 'turtle';
    case 'statue':
      return 'statue';
    case 'dashToward':
    case 'dashRandom':
    case 'hideCorner':
      return 'wrongway';
    default:
      return 'air';
  }
}

/** 一次失誤：事件本身 + 持續了多久（tick） */
export interface MisfireRecord extends MisfireEvent {
  show: ShowKind;
  ticks: number;
  /** 有沒有演出（對話框） */
  shown: boolean;
  /** 好笑分數（plan 算的，越高越值得慢動作） */
  score: number;
  /** 失誤期間揮空幾拳、挨了幾下、有沒有被打倒 */
  whiffs: number;
  taken: number;
  downed: boolean;
}

/** plan 算出來的一次失誤 */
interface Planned {
  ticks: number;
  score: number;
  whiffs: number;
  taken: number;
  downed: boolean;
}

const key = (tick: number, robot: number): string => `${tick}:${robot}`;

/**
 * 好笑分數：固定毛病 > 聽錯 > 慢半拍；持續越久越高（最多算 5 秒）；
 * 失誤期間挨打、被打倒、被 K.O. 加分。
 */
function funnyScore(kind: MisfireKind, p: Omit<Planned, 'score'>, ko: boolean): number {
  const base = kind === 'slow' ? 15 : kind === 'mishear' ? 35 : 55;
  return base + Math.min(5, p.ticks / TICK_HZ) * 8 + p.whiffs * 2 + p.taken * 7 + (p.downed ? 30 : 0) + (ko ? 45 : 0);
}

type Lines = Partial<Record<ShowKind, string[]>>;

/**
 * 對話框：大腦「以為」的指令。{do} = 該做的、{got} = 實際做的、{card} = 卡名。
 * 語氣依大腦：Potato 短又笨、Autofill 自動補完、Parrot 學你講話但講反、Chatter 話多、
 * Nerd 囉嗦地解釋自己為什麼對、Mama 很少出錯，一出錯就嚴肅道歉。
 */
const BUBBLE: Record<string, Lines> = {
  potato: {
    air: ['打！打什麼？打就對了', '收到：攻擊！……目標：空氣', '拳頭，出去！（對手在哪）'],
    spam: ['重拳！重拳！重拳！還要更多重拳！', '大力！再大力！一直大力！', '重……重……重拳停不下來'],
    turtle: ['躲起來！（轉身）', '防禦＝背對對手，對吧？', '看不到它，它就看不到我'],
    wrongway: ['閃！往……那邊！', '跑！跑哪？跑就對了', '衝！（方向隨便）'],
    statue: ['我是雕像。', '……（當機中）', '指令太長，先站著'],
    noWhen: ['什麼時候？現在就是時候！', '「當……的時候」？不管，做！', '{card}！現在！一直！'],
    slow: ['它出拳了？什麼時候？', '等一下我在想……痛', '收到，防禦——（已經被打了）'],
  },
  autofill: {
    air: ['打對手……的……空氣。好的！', '揮拳＋揮拳＋揮拳（自動補完）', '攻擊目標：〔建議：空氣〕'],
    spam: ['重拳→重拳重拳重拳（為您補完）', '您是不是想說：一直重拳？', '重拳×∞（已自動填入）'],
    turtle: ['防禦→防禦背面（自動補完）', '「舉手」您是指「轉身」吧', '抱頭（推薦用法）'],
    wrongway: ['閃開→閃向對手（建議字詞）', '衝刺方向：〔自動〕', '後退→往前退（已更正）'],
    statue: ['反擊→反……（等待輸入）', '正在補完指令……', '〔游標閃爍中〕'],
    noNever: ['絕不……後退！好的，後退！', '「絕不」？沒看到。後退！', '絕不___ → 補完：一直後退'],
    slow: ['防禦（輸入中……）', '正在載入「躲開」……', '建議：剛剛就該擋'],
  },
  parrot: {
    air: ['打對手！打對手！……對手在哪？', '「出拳！」「出拳！」（對著空氣）', '你說打，我就打！打！打！'],
    spam: ['重拳！重拳！重拳！還要更多重拳！', '重拳重拳！你說的！你說的！', '「再一拳」×20'],
    turtle: ['「保護自己！」……背面也算自己吧', '擋！擋！擋哪邊？', '你說防守！我背對它防守！'],
    wrongway: ['「閃開它」……閃向它！', '跑開！跑開！（衝過去）', '「離遠一點」→ 離近一點！'],
    statue: ['等等！等等！一直等！', '「別動」！我不動！', '反擊……反擊……（站著複誦）'],
    mixWho: ['對手快沒血了！……我是說我', '「它在籠邊」——咦，我才在籠邊', '「自己」「對手」……哪個是我？'],
    slow: ['「看到出拳就閃」！看到了！……痛', '閃！閃！（已經被打到）', '你剛剛說什麼？'],
  },
  chatter: {
    air: ['好的！我現在要用最大熱情攻擊——呃，那裡沒人對吧？', '收到收到！全力出拳！效果……嗯，空氣受到重創', '我覺得這是一個很棒的出拳時機！雖然沒有對象'],
    spam: ['重拳很棒對吧？我再來一拳！再一拳！我可以整天這樣！', '我真心覺得重拳就是答案，第十二次也是', '您的重拳需求我完全理解，持續提供中！'],
    turtle: ['我先轉過去保護一下核心，這很合理對吧？', '防禦模式啟動！面向哪邊？細節不重要', '我把背交給你了！……這樣講好像不太對'],
    wrongway: ['我有個新點子：直接衝進它懷裡！', '閃避路線規劃完成！目的地：對手正前方', '往這邊！不對，那邊！反正很有活力！'],
    statue: ['讓我想一下這個指令的深層意涵……', '我正在思考最佳反擊策略，請稍候（很久）', '站著也是一種戰術喔！'],
    slow: ['喔！它剛剛出拳了嗎？我在講話沒注意到', '要閃對吧？我記得！我馬上——好痛', '這一拳我本來可以躲的，真的'],
  },
  nerd: {
    air: ['根據我的計算，對手應該就在這裡。數據不會說謊。', '嚴格來說，我打中的是對手「可能存在」的位置', '這不是揮空，這是預判。差別很細微。'],
    spam: ['重拳期望值最高，所以連出十次在數學上完全合理', '我知道看起來像亂揮。請參閱附錄 B。', '邊際效益遞減？那是保守派的說法。'],
    turtle: ['背對對手可以減少正面受擊面積——理論上', '我採用的是一種非傳統防禦姿態，文獻支持', '技術上來說，我的背部裝甲比較厚'],
    wrongway: ['往對手方向閃避可以縮短它的反應時間。我是對的。', '這叫逆向閃避。教科書第七章。', '我故意的，請不要評論我的路線'],
    statue: ['我正在等最佳時機。目前時機仍不是最佳。', '不動也是一種輸出：0 傷害，但 0 失誤', '我在運算。請勿打擾。'],
    slow: ['我的反應時間在誤差範圍內。只是這一拳在範圍外。', '理論上我已經閃開了。實際上沒有。', '這次延遲是取樣頻率的問題，不是我'],
  },
  mama: {
    air: ['……抱歉。我打錯地方了。這不該發生。', '我向你道歉。那一拳沒有對象。', '這是我的錯。我會修正。'],
    spam: ['抱歉，我出了太多重拳。這不是你要的。', '我失控了。對不起。', '我承認，那不是好判斷。'],
    turtle: ['……我轉錯方向了。非常抱歉。', '對不起，我不該背對它。', '這是嚴重失誤。我道歉。'],
    wrongway: ['抱歉。我走錯方向了。', '我向你道歉，這個閃避很糟。', '……不會有下次。'],
    statue: ['對不起，我剛剛停住了。', '抱歉讓你等了。', '我在那一刻失去了判斷。對不起。'],
    slow: ['……我慢了。對不起。', '這一拳我該擋住的。抱歉。', '我會記住這一下。'],
  },
  trained: {
    air: ['照練習的打！（練習時沒有對手）', '我練過這招！……對著沙包', '習慣性出拳！'],
    spam: ['我最會的就是這個！重拳！重拳！', '熟練度最高的動作：重拳×很多', '練了這麼久，不用白不用'],
    turtle: ['訓練場上就是這樣擋的', '這招我練過，應該是這樣……吧', '肌肉記憶：轉身'],
    wrongway: ['腳自己動了！', '練習的時候是往這邊閃', '這個方向我比較熟'],
    statue: ['這招還沒練到……先站著', '熟練度不足，等待中', '我還在學'],
    slow: ['這種情況我還沒練過', '慢了一點，下次會更熟', '訓練場沒教這個'],
  },
};

/** 球評的吐槽。{n} = 機器人名字、{b} = 大腦、{do}、{got}、{card} */
const CALL: Record<ShowKind, string[]> = {
  air: [
    '{n} 正在跟空氣打一場非常激烈的比賽，目前空氣領先。',
    '{b} 把「{do}」聽成了「{got}」。我相信空氣也嚇到了。',
    '這一套組合拳很漂亮——如果對手站在那裡的話。',
    '{n} 的大腦聽錯了！它打得很認真，但打的是空氣。',
    '觀眾朋友，這不是熱身，這是 {b} 聽錯指令了。',
  ],
  spam: [
    '叫它出重拳，它就一直出、一直出、一直出……這叫過度執行。',
    '{n} 的重拳像打地鼠一樣停不下來，電池要哭了。',
    '{b} 把「{do}」理解成「無限重拳」，非常有誠意。',
    '一拳、兩拳、三拳……我已經數不完了，對手也還沒被打到。',
    '過度執行！{n} 決定用數量彌補準度。',
  ],
  turtle: [
    '{n} 轉過身去抱頭防守……它防的是背後那片空氣。',
    '{b} 對「{do}」有自己的見解：背對對手最安全。',
    '這個防守姿勢我第一次看到，很前衛，也很危險。',
    '{n} 把背整個送給對手了！這是信任還是誤會？',
    '聽錯了！{n} 以為防守就是不要看對手。',
  ],
  wrongway: [
    '{n} 往反方向衝了！或者說，往完全錯的方向。',
    '叫它閃開，它閃進了對手懷裡。{b} 今天很熱情。',
    '{b} 把「{do}」聽成「{got}」，路線規劃大師。',
    '這個走位……我猜連 {n} 自己都不知道要去哪。',
    '方向錯了！{n} 的導航顯然需要更新。',
  ],
  statue: [
    '{n} 站住不動了。是在等時機，還是當機？',
    '{b} 把「{do}」聽成「站著當雕像」，非常有藝術感。',
    '觀眾朋友，{n} 正在進行一段行為藝術。',
    '{n} 停住了！裁判都想去戳它一下確認還活著。',
    '這段時間 {n} 的貢獻是：很穩定地站著。',
  ],
  noWhen: [
    '{b} 看不懂「什麼時候」，所以「{card}」現在就做、隨時都做。',
    '條件？什麼條件？{n} 直接「{got}」再說。',
    '卡片上寫的是「某某時候才做」，{b} 只讀到後半句。',
    '{n} 又在不該的時候「{got}」了，Potato 果然是 Potato。',
    '時機這種東西，{b} 認為是給有錢的大腦用的。',
  ],
  noNever: [
    '「絕不後退」少了「絕不」兩個字，{n} 就一直後退了。',
    '{b} 看不到「絕不」，把禁止事項當成待辦事項。',
    '{n} 正在認真執行一條你沒下的指令：後退。',
    '這就是 {b} 自動補完的威力：把「別做」補成「快做」。',
    '你寫的是絕不，它讀到的是一定要。經典 Autofill。',
  ],
  mixWho: [
    '{b} 把「自己」和「對手」搞混了，現在在替對手緊張。',
    '{n} 以為快沒血的是自己——其實是對手！',
    '「它在籠邊」被聽成「我在籠邊」，{n} 開始自救了。',
    'Parrot 系列的經典問題：主詞是誰？{n} 不確定。',
    '{n} 該「{do}」卻「{got}」，因為它以為狀況說的是自己。',
  ],
  slow: [
    '{n} 有一張卡就是要應付這一拳，但 {b} 慢了半拍。',
    '看到了、想到了、還沒做到，就被打到了。',
    '{b} 的反應時間就是這一拳的長度——剛好慢一點。',
    '「看到出拳就{do}」——{n} 看到了，但大腦還在載入。',
    '慢半拍！{n} 的卡寫得很好，大腦跟不上。',
  ],
};

/** 觀眾的反應 */
const CROWD: Record<ShowKind, 'boo' | 'laugh' | 'ooh'> = {
  air: 'laugh',
  spam: 'laugh',
  turtle: 'boo',
  wrongway: 'ooh',
  statue: 'boo',
  noWhen: 'laugh',
  noNever: 'boo',
  mixWho: 'ooh',
  slow: 'ooh',
};

/** 左上角小字 */
const STATUS: Record<ShowKind, string> = {
  air: '聽錯了',
  spam: '過度執行',
  turtle: '聽錯了',
  wrongway: '聽錯了',
  statue: '聽錯了',
  noWhen: '沒看懂「什麼時候」',
  noNever: '看不到「絕不」',
  mixWho: '搞混自己和對手',
  slow: '慢半拍',
};

/** 同一方多久內不重複演出（tick） */
const SIDE_GAP = 3 * TICK_HZ;
/** 兩邊的對話框至少隔多久（tick） */
const ANY_GAP = 1.5 * TICK_HZ;
/** 慢動作特寫：每回合最多幾次、兩次至少隔多久（tick）、分數至少要多少 */
const SLOW_PER_ROUND = 2;
const SLOW_GAP = 5 * TICK_HZ;
const SLOW_MIN_SCORE = 60;
/** 對話框顯示幾秒：至少 1.5 秒，字越多越久 */
const bubbleSec = (text: string): number => Math.min(3.6, Math.max(1.8, 1.2 + text.length * 0.07));
/** 排隊中的對話框最多等多久（秒），太晚就不演了 */
const QUEUE_MAX = 2.5;

function fill(t: string, v: Record<string, string>): string {
  return t.replace(/\{(\w+)\}/g, (_, k: string) => v[k] ?? '');
}

/** 對話框、球評、字幕共用的替換值 */
export function misfireVars(rec: MisfireEvent, robotName: string): Record<string, string> {
  return {
    n: shortName(robotName),
    b: BRAINS[rec.brain as keyof typeof BRAINS]?.name ?? rec.brain,
    do: ACTION_TEXT[rec.intended],
    got: ACTION_TEXT[rec.actual],
    card: CARDS[rec.card]?.name ?? '流派',
  };
}

/** 這次失誤頭上的對話框要講哪一句（rng 用演出亂數） */
export function bubbleLine(rec: MisfireEvent, robotName: string, rng: ShowRng): string {
  const table = BUBBLE[rec.brain] ?? BUBBLE.chatter;
  const show = showKind(rec.kind, rec.actual);
  const lines = table[show] ?? table.air ?? BUBBLE.chatter.air!;
  return fill(rng.pick(lines), misfireVars(rec, robotName));
}

function shortName(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts[parts.length - 1];
}

export class MisfireShow {
  /** 這場所有的失誤（雙方），照時間排 */
  records: MisfireRecord[] = [];
  private rng = new ShowRng();
  private lastShown = [-1e9, -1e9];
  private lastAny = -1e9;
  private open: (MisfireRecord | null)[] = [null, null];
  /** 固定毛病的失誤：發生時是哪一條規則（還在用同一條就算還在持續） */
  private openRule = [-1, -1];
  /** plan：每次失誤（tick:robot）的結果，和要做慢動作的那幾次 */
  private planned = new Map<string, Planned>();
  private cine = new Set<string>();
  /** 等開場字樣消失的演出 */
  private queue: { rec: MisfireRecord; bubble: string; call: string; status: string; age: number }[] = [];
  private bubbleEls: HTMLElement[];
  private bubbleLeft = [0, 0];
  private bubbleClear = [0, 0];
  private statusText = ['', ''];
  private statusLeft = [0, 0];
  /** 可以做慢動作（快轉時 main 會關掉） */
  cinematic = true;

  constructor(
    private fx: Fx,
    private audio: SoundPlayer,
    private commentator: Commentator,
    private renderer: Renderer,
    private canvas: HTMLCanvasElement,
    /** 開場字樣（FIGHT! / ROUND N）還在畫面上 */
    private blocked: () => boolean = () => false,
  ) {
    const layer = document.getElementById('bubbles')!;
    this.bubbleEls = [0, 1].map((i) => {
      const b = document.createElement('div');
      b.className = `bubble-say side${i}`;
      layer.append(b);
      return b;
    });
  }

  reset(seed: number): void {
    this.rng.reset(seed);
    this.records = [];
    this.lastShown = [-1e9, -1e9];
    this.lastAny = -1e9;
    this.open = [null, null];
    this.openRule = [-1, -1];
    this.planned.clear();
    this.cine.clear();
    this.queue = [];
    this.bubbleLeft = [0, 0];
    this.statusLeft = [0, 0];
    this.statusText = ['', ''];
    this.hideAll();
  }

  /** 把頭上的對話框全部收掉，連文字一起清掉（賽後畫面不會留著上一句） */
  hideAll(): void {
    this.bubbleLeft = [0, 0];
    this.bubbleClear = [0, 0];
    for (const b of this.bubbleEls) {
      b.classList.remove('show');
      b.textContent = '';
    }
  }

  /**
   * 開打前（和角落指示改了計畫之後）用同一個種子無畫面先跑完整場，
   * 算出每次失誤的好笑分數，挑出要慢動作的那幾次。只讀結果，不影響正在打的那一場。
   */
  plan(seed: number, setups: [RobotSetup, RobotSetup]): void {
    const m = createMatch(seed, setups);
    type Open = { e: MisfireEvent; rule: number; p: Omit<Planned, 'score'>; until: number; round: number };
    const open: (Open | null)[] = [null, null];
    const all: { e: MisfireEvent; p: Omit<Planned, 'score'>; round: number; ko: boolean }[] = [];
    // 失誤期間 + 之後一小段（挨的那一拳常常晚一點才到）都算「結果」
    const TAIL = 45;
    const tails: (Open | null)[] = [null, null];
    let guard = 0;
    while (!m.done && guard++ < 20000) {
      stepMatch(m);
      for (const side of [0, 1]) {
        const o = open[side];
        if (!o) continue;
        const brain = m.brains[side];
        const going = m.phase === 'fight' && (o.e.kind === 'mishear' ? m.robots[side].fumbling : brain.active === o.rule && brain.quirkDiff);
        if (going) {
          o.p.ticks++;
          o.until = m.tick + TAIL;
        } else open[side] = null;
      }
      for (const e of m.events) {
        if (e.type === 'misfire' && m.phase === 'fight') {
          const o: Open = { e, rule: m.brains[e.robot].active, p: { ticks: e.kind === 'slow' ? 0 : 1, whiffs: 0, taken: 0, downed: false }, until: m.tick + TAIL, round: m.round };
          all.push({ e, p: o.p, round: m.round, ko: false });
          if (e.kind !== 'slow') open[e.robot] = o;
          tails[e.robot] = o;
          // 慢半拍：觸發它的那一拳本身就算挨打
          if (e.kind === 'slow') o.p.taken++;
        }
      }
      for (const e of m.events) {
        const hit = (side: number): Open | null => {
          const t = tails[side];
          return t && m.tick <= t.until ? t : null;
        };
        if (e.type === 'whiff') {
          const t = hit(e.robot);
          if (t && t.e.kind !== 'slow') t.p.whiffs++;
        } else if (e.type === 'hit' && !e.blocked) {
          const t = hit(e.target);
          if (t && !(t.e.kind === 'slow' && t.e.tick === m.tick)) t.p.taken += e.kind === 'heavy' ? 2 : 1;
        } else if (e.type === 'down' || e.type === 'ko') {
          const t = hit(e.robot);
          if (t) t.p.downed = true;
        } else if (e.type === 'end' && (e.method === 'KO' || e.method === 'TKO') && e.winner >= 0) {
          const t = hit(1 - e.winner);
          const a = t && all.find((x) => x.p === t.p);
          if (a) a.ko = true;
        }
      }
    }
    this.planned.clear();
    this.cine.clear();
    const scored = all.map((a) => ({ ...a, score: funnyScore(a.e.kind, a.p, a.ko) }));
    for (const a of scored) this.planned.set(key(a.e.tick, a.e.robot), { ...a.p, score: a.score });
    // 每回合挑分數最高的，最多 2 次、彼此至少隔 5 秒
    const picked: { tick: number; round: number }[] = [];
    for (const a of scored.slice().sort((x, y) => y.score - x.score || x.e.tick - y.e.tick)) {
      if (a.score < SLOW_MIN_SCORE) break;
      const same = picked.filter((p) => p.round === a.round);
      if (same.length >= SLOW_PER_ROUND) continue;
      if (picked.some((p) => Math.abs(p.tick - a.e.tick) < SLOW_GAP)) continue;
      picked.push({ tick: a.e.tick, round: a.round });
      this.cine.add(key(a.e.tick, a.e.robot));
    }
  }

  /** 這次失誤會不會用慢動作（測試、精華片段用） */
  isCinematic(tick: number, robot: number): boolean {
    return this.cine.has(key(tick, robot));
  }

  /** 每個邏輯 tick 之後呼叫（只給正在打的那一場，不給 K.O. 重播） */
  onTick(m: Match): void {
    this.rng.at(m.tick);
    // 持續中的失誤：還在聽錯、還在用被毛病改過的同一條規則，就繼續算時間
    for (const side of [0, 1]) {
      const rec = this.open[side];
      if (!rec) continue;
      const r = m.robots[side];
      const brain = m.brains[side];
      const going =
        m.phase === 'fight' &&
        (rec.kind === 'mishear' ? r.fumbling : rec.kind !== 'slow' && brain.active === this.openRule[side] && brain.quirkDiff);
      if (going) rec.ticks++;
      else this.open[side] = null;
    }
    for (const e of m.events) {
      if (e.type !== 'misfire') continue;
      const p = this.planned.get(key(e.tick, e.robot));
      const rec: MisfireRecord = {
        ...e,
        show: showKind(e.kind, e.actual),
        ticks: e.kind === 'slow' ? 0 : 1,
        shown: false,
        score: p?.score ?? 0,
        whiffs: p?.whiffs ?? 0,
        taken: p?.taken ?? 0,
        downed: p?.downed ?? false,
      };
      this.records.push(rec);
      if (e.kind !== 'slow') {
        this.open[e.robot] = rec;
        this.openRule[e.robot] = m.brains[e.robot].active;
      }
      // 挑中要慢動作的那幾次一定演；其他的照間隔規則
      const top = this.cine.has(key(e.tick, e.robot));
      if (m.phase === 'fight' && (top || (e.tick - this.lastShown[e.robot] >= SIDE_GAP && e.tick - this.lastAny >= ANY_GAP))) this.perform(m, rec);
    }
  }

  /** 決定這次要演什麼（台詞在這個 tick 挑好，排隊晚一點出來也是同一句） */
  private perform(m: Match, rec: MisfireRecord): void {
    const side = rec.robot;
    const r = m.robots[side];
    rec.shown = true;
    this.lastShown[side] = rec.tick;
    this.lastAny = rec.tick;
    const vars = misfireVars(rec, r.spec.name);
    const bubble = bubbleLine(rec, r.spec.name, this.rng);
    const call = fill(this.rng.pick(CALL[rec.show]), vars);
    const status = `${STATUS[rec.show]} → ${rec.kind === 'slow' ? `該「${vars.do}」卻挨了一拳` : vars.got}`;
    // 同一方還在排隊的舊演出就不要了
    this.queue = this.queue.filter((q) => q.rec.robot !== side);
    this.queue.push({ rec, bubble, call, status, age: 0 });
  }

  /** 真的把演出放出來：對話框、球評、觀眾，分數最高的那幾次加慢動作特寫 */
  private release(m: Match, q: MisfireShow['queue'][number], late: boolean): void {
    const { rec } = q;
    const side = rec.robot;
    const r = m.robots[side];
    const b = this.bubbleEls[side];
    b.textContent = q.bubble;
    b.classList.toggle('mama', rec.brain === 'mama');
    b.classList.add('show');
    const sec = bubbleSec(q.bubble);
    this.bubbleLeft[side] = sec;
    this.bubbleClear[side] = 0;
    this.statusText[side] = q.status;
    this.statusLeft[side] = sec;
    this.commentator.comment('球評', q.call, 6, 3);
    this.audio.play(CROWD[rec.show], { volume: 0.8, pan: side === 0 ? -0.3 : 0.3 });
    // 慢動作特寫：只有挑中的那幾次；排隊太久（失誤已經結束）就不做了。慢動作只是播得慢，不影響模擬
    if (this.cinematic && this.cine.has(key(rec.tick, side)) && (!late || this.open[side] === rec)) {
      this.fx.slow(0.4, 0.65);
      this.fx.focusOn(r.x, r.y, 0.45);
    }
  }

  /** 每一幀：放出排隊的演出、對話框跟著機器人頭頂走 */
  onFrame(m: Match, dt: number, visible: boolean): void {
    if (!visible || m.phase === 'over') {
      this.queue = [];
      if (this.bubbleEls.some((b) => b.textContent)) this.hideAll();
      return;
    }
    if (this.queue.length) {
      for (const q of this.queue) q.age += dt;
      this.queue = this.queue.filter((q) => q.age <= QUEUE_MAX && m.phase === 'fight');
      if (!this.blocked()) {
        const ready = this.queue;
        this.queue = [];
        for (const q of ready) this.release(m, q, q.age > 0.05);
      }
    }
    const rect = this.canvas.getBoundingClientRect();
    const sx = rect.width / this.renderer.w;
    const sy = rect.height / this.renderer.h;
    for (const side of [0, 1]) {
      this.statusLeft[side] = Math.max(0, this.statusLeft[side] - dt);
      const b = this.bubbleEls[side];
      if (this.bubbleClear[side] > 0) {
        // 淡出動畫播完再清文字
        this.bubbleClear[side] -= dt;
        if (this.bubbleClear[side] <= 0) b.textContent = '';
      }
      if (this.bubbleLeft[side] <= 0) continue;
      this.bubbleLeft[side] -= dt;
      if (this.bubbleLeft[side] <= 0) {
        b.classList.remove('show');
        this.bubbleClear[side] = 0.2;
        continue;
      }
      const r = m.robots[side];
      const [px, py] = this.renderer.project(r.x, r.y, 46);
      b.style.left = `${rect.left + px * sx}px`;
      b.style.top = `${rect.top + py * sy}px`;
    }
  }

  /** 左上角小字：這一方正在出的包（沒有就是空字串） */
  status(side: number, m: Match): string {
    if (m.phase !== 'fight') return '';
    if (this.statusLeft[side] > 0) return this.statusText[side];
    const r = m.robots[side];
    return r.fumbling ? `聽錯了 → ${r.label}` : '';
  }

  /** 每一方、每張卡的固定毛病觸發了幾次（賽後解讀用） */
  quirkCounts(): Record<string, number>[] {
    const out: Record<string, number>[] = [{}, {}];
    for (const r of this.records) if (r.kind === 'noWhen' || r.kind === 'noNever' || r.kind === 'mixWho') out[r.robot][r.card] = (out[r.robot][r.card] ?? 0) + 1;
    return out;
  }

  /** 本場最佳失誤：好笑分數最高的那一次（沒有 plan 時：固定毛病 > 聽錯 > 慢半拍，同類比持續時間） */
  best(): MisfireRecord | null {
    const rank = (r: MisfireRecord): number => r.score * 1e6 + (r.kind === 'slow' ? 0 : r.kind === 'mishear' ? 1 : 2) * 1e4 + r.ticks;
    let top: MisfireRecord | null = null;
    for (const r of this.records) if (!top || rank(r) > rank(top)) top = r;
    return top;
  }

  /**
   * 賽後那一行，沿用對話框的語氣：「它以為的指令」和「實際做了什麼」。
   * owner：「你的」「對手的」或「名字 的」。句型用演出亂數挑，同一場每次一樣。
   */
  static describe(rec: MisfireRecord, owner: string, seed: number): string {
    const rng = new ShowRng();
    rng.reset(seed);
    rng.at(rec.tick * 2 + rec.robot + 7_000_000);
    const v: Record<string, string> = {
      own: owner,
      b: BRAINS[rec.brain as keyof typeof BRAINS]?.name ?? rec.brain,
      do: ACTION_TEXT[rec.intended],
      got: ACTION_TEXT[rec.actual],
      card: CARDS[rec.card]?.name ?? '流派',
      sec: (rec.ticks / TICK_HZ).toFixed(1),
    };
    const kind = rec.kind === 'mishear' && rec.show === 'spam' ? 'spam' : rec.kind;
    let line = fill(rng.pick(DESC[kind]), v);
    // 後果：被打倒 > 挨了幾下 > 揮空幾拳
    if (rec.kind !== 'slow') {
      if (rec.downed) line += '，最後被打倒在地';
      else if (rec.taken >= 2) line += `，順便挨了 ${rec.taken} 下`;
      else if (rec.whiffs >= 3) line += `，揮空 ${rec.whiffs} 拳`;
    } else if (rec.downed) line += '，直接倒地';
    return line;
  }
}

/** 賽後「本場最佳失誤」的句型。{own}{b}{do}{got}{card}{sec} */
const DESC: Record<MisfireKind | 'spam', string[]> = {
  mishear: [
    '{own} {b} 把「{do}」聽成「{got}」，很有自信地做了 {sec} 秒',
    '叫{own} {b}「{do}」，它回你「收到：{got}」，持續 {sec} 秒',
    '{own} {b} 以為你說的是「{got}」，認真執行了 {sec} 秒',
  ],
  spam: [
    '叫{own} {b}「{do}」，它過度執行：原地揮了 {sec} 秒重拳',
    '{own} {b} 把「{do}」補成「重拳×∞」，一路揮了 {sec} 秒',
    '{own} {b} 聽到「{do}」，決定用數量取勝：重拳連發 {sec} 秒',
  ],
  noWhen: [
    '{own} {b} 以為「{card}」是「現在就做」，不分時機地「{got}」了 {sec} 秒',
    '「{card}」本來只在某些時候用，{own} {b} 決定隨時都用：{got} {sec} 秒',
    '{own} {b} 跳過「什麼時候」，把「{card}」讀成「一直{got}」，持續 {sec} 秒',
  ],
  noNever: [
    '{own} {b} 把「{card}」補完成「一直{got}」，持續了 {sec} 秒',
    '{own} {b} 讀「{card}」時漏了「絕不」兩個字，認真地「{got}」了 {sec} 秒',
    '「{card}」？{own} {b} 看成「快點{got}」，堅持了 {sec} 秒',
  ],
  mixWho: [
    '{own} {b} 以為狀況說的是自己，該「{do}」卻「{got}」了 {sec} 秒',
    '{own} {b} 把「對手」聽成「我」，替對手緊張地「{got}」了 {sec} 秒',
    '{own} {b} 搞不清楚誰是誰，「{do}」變成「{got}」，持續 {sec} 秒',
  ],
  slow: [
    '{own} {b} 慢了半拍：「{card}」本來會「{do}」，結果硬吃了一拳',
    '{own} {b} 看到出拳、想到「{do}」，然後才發現已經被打到了',
    '「{card}」寫好了「{do}」，{own} {b} 還在載入，先挨了一拳',
  ],
};
