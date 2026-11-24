/** 賽前設定畫面：選裝備、大腦、流派和卡（全部花同一筆出場額度）、把卡插進卡槽、看養成進度、進訓練營。 */
import type { Patch } from '../models/robot';
import { BRAINS, CARD_LIST, CARDS, compile, KIND_NAME, legalDeck, type BrainId, type CardKind } from '../sim/cards';
import { ARMORS, BRAIN_COST, BUDGET, cleanGear, deckCost, DEFAULT_GEAR, PLATE_DENSITY, PLATE_HALF, PLATE_STEP, plateCost, REF_MASS, THRUSTERS, totalCost, weightInfo, WEAPONS, type GearItem } from '../sim/gear';
import { FOCUS, runCamp, SPARS } from '../sim/camp';
import { TICK_HZ, type RobotSetup } from '../sim/match';
import { newModel, snapshot, TRAINING_DAILY_XP } from '../sim/model';
import { ACTION_TEXT } from '../sim/rules';
import { AXES, AXIS_TEXT, NEUTRAL } from '../sim/temper';
import { campXpLeft, saveProgress, unlockedCount, type Progress } from './save';
import { howToGet } from '../sim/album';
import { gearText } from '../sim/gear';
import { LADDER, PRIZE_FROM } from '../sim/roster';
import type { Loadout } from '../sim/types';
import { buildFor, PRESETS } from '../sim/presets';
import { BACKS, CHESTS, cleanLook, DEFAULT_LOOK, FACES, FINISHES, GLOWS, HEADS, LOOK_THEMES, PAINTS, PATTERNS, randomLook, SHOULDERS, WEARS, type Look, type Swatch } from '../sim/look';
import { cleanName } from '../sim/share';
import { Preview } from './preview';
import { artFor } from './art';
import type { Daily } from '../sim/daily';
import { better, candidates, trial, TRIAL_FIGHTS, type Trial } from '../sim/coach';
import { BEATS, cleanPlan, DEFAULT_PLAN, TACTIC_LIST, TACTICS, type Plan, type Tactic } from '../sim/tactics';

/** 一個戰術的小圖示（作戰計畫、對手情報、比賽中都用） */
export function tacticChip(t: Tactic, cls = ''): HTMLElement {
  const n = document.createElement('span');
  n.className = `tac t-${t} ${cls}`.trim();
  n.textContent = `${TACTICS[t].icon} ${TACTICS[t].name}`;
  return n;
}

export interface PlayerChoice {
  gear: Loadout;
  brain: BrainId;
  deck: string[];
  name: string;
  look: Look;
  plan: Plan;
}

const DEFAULT_NAME = 'PLAYER-01';
const STORAGE_KEY = 'prompt-cage.deck';
const DEFAULT: PlayerChoice = { gear: DEFAULT_GEAR, brain: 'parrot', deck: ['boxing', 'read_heavy', 'smell_blood'], name: DEFAULT_NAME, look: DEFAULT_LOOK, plan: DEFAULT_PLAN };
/** 外型的五個選項：前兩個是文字按鈕，後三個是色塊 */
const LOOK_ROWS: { key: keyof Look; title: string; names?: Record<string, string>; colors?: Record<string, Swatch> }[] = [
  { key: 'head', title: '頭型', names: HEADS },
  { key: 'pattern', title: '塗裝', names: PATTERNS },
  { key: 'paint', title: '烤漆', colors: PAINTS },
  { key: 'trim', title: '第二色（手腳、塗裝）', colors: PAINTS },
  { key: 'glow', title: '發光（護目鏡、核心）', colors: GLOWS },
  { key: 'finish', title: '表面處理', names: FINISHES },
  { key: 'glove', title: '拳套、握把', colors: PAINTS },
  { key: 'face', title: '臉', names: FACES },
  { key: 'shoulder', title: '肩甲', names: SHOULDERS },
  { key: 'back', title: '背上', names: BACKS },
  { key: 'chest', title: '胸前', names: CHESTS },
  { key: 'wear', title: '戰損', names: WEARS },
];
const GEAR_SLOTS: { slot: keyof Loadout; title: string; items: Record<string, GearItem> }[] = [
  { slot: 'weapon', title: '武器', items: WEAPONS },
  { slot: 'armor', title: '骨架', items: ARMORS },
  { slot: 'thruster', title: '推進器', items: THRUSTERS },
];
/** 細調裡的卡表（流派改在最上面選） */
const KINDS: CardKind[] = ['reflex', 'trait', 'signature'];
export type Tab = 'camp' | 'build' | 'train' | 'look' | 'league';
/** 從大廳進來的入口：單人遊玩、對戰世界、我的角色（改裝廠、AI 訓練場、外型） */
export type Mode = 'solo' | 'world' | 'garage' | 'career';
export const MODE_TABS: Record<Mode, Tab[]> = { solo: ['camp'], world: ['league'], garage: ['build', 'train', 'look'], career: ['build', 'train', 'look'] };
const MODE_TITLE: Record<Mode, string> = { solo: '🥊 快速對戰', world: '🌐 對戰世界', garage: '🤖 我的角色', career: '🌟 生涯・整備' };
function modeOf(tab: Tab): Mode {
  return (Object.keys(MODE_TABS) as Mode[]).find((m) => MODE_TABS[m].includes(tab))!;
}
/** AI 教練一次試幾套配法 */
const COACH_BUILDS = 48;

/** 排名：五個對手是第 5 名到冠軍；玩家每打贏一台就往上一名 */
export function rankText(beaten: number): string {
  if (beaten >= LADDER.length) return '👑 冠軍';
  return beaten === 0 ? '新秀（還沒有排名）' : `排名第 ${LADDER.length - beaten + 1}`;
}

function load(): PlayerChoice {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const v = JSON.parse(raw) as Partial<PlayerChoice>;
      if (v.brain && v.brain in BRAINS && Array.isArray(v.deck))
        return {
          gear: cleanGear(v.gear),
          brain: v.brain,
          deck: legalDeck(v.deck.map(String), v.brain),
          name: cleanName(v.name, DEFAULT_NAME),
          look: cleanLook(v.look) ?? { ...DEFAULT_LOOK },
          plan: cleanPlan(v.plan),
        };
    }
  } catch {
    // 無痕模式之類的情況下 localStorage 可能不能用，忽略
  }
  return { gear: { ...DEFAULT.gear }, brain: DEFAULT.brain, deck: [...DEFAULT.deck], name: DEFAULT_NAME, look: { ...DEFAULT_LOOK }, plan: [...DEFAULT_PLAN] };
}

/** 點一下（或滑鼠移過去）會在下面跳出完整說明的元素：畫面上只留名字和數字 */
function tip(n: HTMLElement, title: string, ...lines: string[]): HTMLElement {
  n.dataset.tip = JSON.stringify([title, ...lines.filter(Boolean)]);
  return n;
}

function node(tag: string, cls: string, text = ''): HTMLElement {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text) n.textContent = text;
  return n;
}

/** 只列出四捨五入之後看得出差別的熟練度變化 */
export function shownChanges(changes: Record<string, [number, number]>): string[] {
  return Object.keys(changes).filter((k) => pct(changes[k][0]) !== pct(changes[k][1]));
}

export function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

/** 一條橫條：左標籤、右標籤、0..1 的值 */
export function bar(left: string, right: string, value: number, text: string): HTMLElement {
  const row = node('div', 'meter');
  row.append(node('span', 'ml', left));
  const track = node('div', 'mt');
  const fill = node('i', right ? 'dot' : '');
  if (right) fill.style.left = `${value * 100}%`;
  else fill.style.width = `${value * 100}%`;
  track.append(fill);
  row.append(track);
  row.append(node('span', 'mr', right || text));
  return row;
}

export function seconds(ticks: number): string {
  return `${(ticks / TICK_HZ).toFixed(2)} 秒`;
}

export class SetupScreen {
  private root = document.getElementById('setup')!;
  private brainBox = document.getElementById('brains')!;
  private slotBox = document.getElementById('slots')!;
  private readout = document.getElementById('readout')!;
  private table = document.getElementById('cards')!;
  private budgetEl = document.getElementById('budget')!;
  private startBtn = document.getElementById('startBtn') as HTMLButtonElement;
  private gear: Loadout;
  private brain: BrainId;
  private deck: string[];
  private name: string;
  private look: Look;
  private plan: Plan;
  private planBox = document.getElementById('planBox')!;
  /** 作戰計畫正在改第幾回合（-1 = 沒有在改） */
  private planPick = -1;
  private lookButtons: { key: keyof Look; id: string; btn: HTMLElement }[] = [];
  private nameInput = document.getElementById('botName') as HTMLInputElement;
  /** 機器人預覽（主迴圈每幀叫它畫） */
  readonly preview = new Preview(document.getElementById('preview') as HTMLCanvasElement);
  private gearButtons: { slot: keyof Loadout; id: string; btn: HTMLElement }[] = [];
  private plateRange: HTMLInputElement | null = null;
  private plateLabel: HTMLElement | null = null;
  private weightBox: HTMLElement | null = null;
  private brainButtons = new Map<BrainId, HTMLElement>();
  private cardButtons = new Map<string, HTMLElement>();
  private styleButtons = new Map<string, HTMLElement>();
  private moreStyles = node('button', 'chip moreStyles');
  private deckRow = document.getElementById('deckRow')!;
  private modelBox = document.getElementById('modelBox')!;
  private temperBox = document.getElementById('temperBox')!;
  private campBox = document.getElementById('campBox')!;
  private campReport = document.getElementById('campReport')!;
  private campButtons: HTMLButtonElement[] = [];
  private foeBox = document.getElementById('foes')!;
  /** 選了第幾個對手；-1 = 每日挑戰 */
  foe = 0;
  /** 今天的每日挑戰（main 給） */
  daily: Daily | null = null;
  private coachBox = document.getElementById('coachBox')!;
  private coachBusy = false;
  private coachDone = 0;
  private coachNote = '';
  private coachNow: Trial | null = null;
  private coachPlans: Trial[] = [];

  constructor(
    private progress: Progress,
    onStart: (choice: PlayerChoice) => void,
  ) {
    const saved = load();
    this.gear = saved.gear;
    this.brain = saved.brain;
    this.deck = saved.deck.filter((id) => this.progress.owned.includes(id));
    this.name = saved.name;
    this.look = saved.look;
    this.plan = saved.plan;
    this.foe = unlockedCount(this.progress) - 1;

    // 外型：名字、頭型、塗裝、三個顏色
    this.nameInput.value = this.name;
    this.nameInput.addEventListener('input', () => {
      this.name = cleanName(this.nameInput.value, DEFAULT_NAME);
      document.getElementById('fighterName')!.textContent = this.name;
      this.store();
    });
    this.nameInput.addEventListener('blur', () => (this.nameInput.value = this.name));
    document.getElementById('lookRandom')!.addEventListener('click', () => {
      this.look = randomLook(Math.random);
      this.refresh();
    });
    const lookBox = document.getElementById('lookBox')!;
    // 主題套裝：一鍵換整套
    lookBox.append(node('div', 'kind', '主題套裝'));
    const themes = node('div', 'chips');
    for (const th of Object.values(LOOK_THEMES)) {
      const btn = node('button', 'chip', th.name);
      btn.addEventListener('click', () => {
        this.look = { ...th.look };
        this.refresh();
      });
      themes.append(btn);
    }
    lookBox.append(themes);
    for (const row of LOOK_ROWS) {
      lookBox.append(node('div', 'kind', row.title));
      const line = node('div', 'chips');
      for (const id of Object.keys(row.names ?? row.colors ?? {})) {
        const btn = node('button', row.colors ? 'sw' : 'chip', row.names ? row.names[id] : '');
        if (row.colors) {
          btn.style.background = row.colors[id].hex;
          btn.title = row.colors[id].name;
          btn.setAttribute('aria-label', row.colors[id].name);
        }
        btn.addEventListener('click', () => {
          this.look = { ...this.look, [row.key]: id };
          this.refresh();
        });
        this.lookButtons.push({ key: row.key, id, btn });
        line.append(btn);
      }
      lookBox.append(line);
    }

    const gearBox = document.getElementById('gear')!;
    for (const { slot, title, items } of GEAR_SLOTS) {
      gearBox.append(node('div', 'kind', title));
      const grid = node('div', 'cardgrid');
      for (const item of Object.values(items)) {
        const btn = node('button', 'card gear');
        btn.append(node('b', '', item.name), node('span', 'pts', `${item.cost} 點`));
        tip(btn, `${title}・${item.name}`, item.text);
        btn.addEventListener('click', () => {
          this.gear = { ...this.gear, [slot]: item.id };
          // 換骨架：裝甲厚度換成新骨架的預設值
          if (slot === 'armor') this.gear.plate = ARMORS[item.id as Loadout['armor']].plate;
          this.refresh();
        });
        this.gearButtons.push({ slot, id: item.id, btn });
        grid.append(btn);
      }
      gearBox.append(grid);
      if (slot === 'armor') {
        // 裝甲厚度：越厚越耐打，但越重越慢
        gearBox.append(node('div', 'kind', '裝甲厚度'));
        const row = node('div', 'plateRow');
        const range = document.createElement('input');
        range.type = 'range';
        range.min = '0';
        range.step = String(PLATE_STEP);
        range.className = 'plateRange';
        range.addEventListener('input', () => {
          this.gear = { ...this.gear, plate: Number(range.value) };
          this.refresh();
        });
        const label = node('b', 'plateMm', '');
        row.append(range, label);
        gearBox.append(row);
        this.plateRange = range;
        this.plateLabel = label;
        this.weightBox = node('div', 'weightBox');
        gearBox.append(this.weightBox);
      }
    }

    for (const b of Object.values(BRAINS)) {
      const btn = node('button', 'brain');
      const art = artFor('brain_' + b.id);
      if (art) btn.append(art);
      btn.append(node('b', '', b.name + '　' + BRAIN_COST[b.id] + ' 點'));
      // 一眼看的數字：卡槽、反應、準確率；毛病只留一個 ⚠，點了才看說明
      const mini = node('div', 'mini');
      mini.append(node('span', '', `🃏${b.slots}`), node('span', '', `⚡${(b.reaction / TICK_HZ).toFixed(2)}s`));
      mini.append(node('span', '', b.id === 'trained' ? '🎯養成' : `🎯${Math.round(b.accuracy * 100)}%`));
      if (b.quirkText) mini.append(node('span', 'warn', '⚠'));
      btn.append(mini);
      tip(
        btn,
        b.name,
        `${b.slots} 個卡槽・反應 ${seconds(b.reaction)}・${b.id === 'trained' ? '每個動作各看熟練度' : `準確率 ${Math.round(b.accuracy * 100)}%`}`,
        b.id === 'trained' ? '你自己養的：越打越強，也越來越貴' : b.quirkText ? `⚠ ${b.quirkText}` : '',
      );
      btn.addEventListener('click', () => {
        this.brain = b.id;
        this.deck = legalDeck(this.deck, b.id);
        this.refresh();
      });
      this.brainButtons.set(b.id, btn);
      this.brainBox.append(btn);
    }

    // 最上面：武術流派。點一張就整台配好
    const styleBox = document.getElementById('styles')!;
    for (const card of CARD_LIST.filter((c) => c.kind === 'style')) {
      const btn = node('button', 'card k-style');
      const art = artFor(card.id);
      if (art) btn.append(art);
      btn.append(node('b', '', card.name), node('small', '', PRESETS[card.id]?.blurb ?? ''), node('span', 'lock', '🔒'));
      btn.addEventListener('click', () => this.pickStyle(card.id));
      this.styleButtons.set(card.id, btn);
      styleBox.append(btn);
    }
    this.moreStyles.addEventListener('click', () => {
      styleBox.classList.toggle('showLocked');
      this.refresh();
    });

    for (const kind of KINDS) {
      this.table.append(node('div', 'kind', KIND_NAME[kind]));
      const grid = node('div', 'cardgrid');
      for (const card of CARD_LIST.filter((c) => c.kind === kind)) {
        const btn = node('button', `card k-${kind}`);
        const art = artFor(card.id);
        if (art) btn.append(art);
        btn.append(node('b', '', card.name), node('span', 'pts', `${card.price} 點`));
        btn.append(node('span', 'lock', '🔒'));

        btn.addEventListener('click', () => this.toggle(card.id));
        this.cardButtons.set(card.id, btn);
        grid.append(btn);
      }
      this.table.append(grid);
    }

    // 訓練營：六個方向
    FOCUS.forEach((focus, i) => {
      const btn = node('button', 'card camp') as HTMLButtonElement;
      btn.append(node('b', '', focus.name));
      tip(btn, focus.name, focus.tip);
      btn.addEventListener('click', () => this.camp(i));
      this.campButtons.push(btn);
      this.campBox.append(btn);
    });
    document.getElementById('resetModel')!.addEventListener('click', () => {
      if (!window.confirm('把自訓模型和性格都清空重來？這個動作不能復原。')) return;
      this.progress.model = newModel();
      this.progress.temper = { ...NEUTRAL };
      saveProgress(this.progress);
      this.campReport.textContent = '';
      this.refresh();
    });

    this.startBtn.addEventListener('click', () => {
      if (this.legal) onStart(this.value);
    });
    for (const btn of Array.from(document.querySelectorAll<HTMLElement>('#tabs button')))
      btn.addEventListener('click', () => this.tab(btn.dataset.tab as Tab));
    // 說明泡泡：點一下（滑鼠移過去也行）就在下面跳出完整說明
    const tipBox = document.getElementById('tipBox')!;
    let tipTimer = 0;
    const showTip = (e: Event, sticky: boolean): void => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-tip]');
      if (!t) return;
      const [title, ...lines] = JSON.parse(t.dataset.tip!) as string[];
      tipBox.replaceChildren(node('b', '', title), ...lines.map((l) => node('div', '', l)));
      tipBox.classList.add('show');
      clearTimeout(tipTimer);
      tipTimer = window.setTimeout(() => tipBox.classList.remove('show'), sticky ? 5000 : 2500);
    };
    this.root.addEventListener('click', (e) => showTip(e, true));
    this.root.addEventListener('pointerover', (e) => {
      if ((e as PointerEvent).pointerType === 'mouse') showTip(e, false);
    });
    tipBox.addEventListener('click', () => tipBox.classList.remove('show'));

    this.tab('camp');
    this.refreshPlan();
    this.refresh();
  }

  /** 切分頁：選手營（預設）、改裝、訓練、外型、聯盟 */
  tab(name: Tab): void {
    // 只顯示這個入口底下的分頁；只有一頁就不顯示分頁列
    // 生涯和我的角色共用改裝分頁：還在同一個入口裡就不換
    const mode = MODE_TABS[this.mode].includes(name) ? this.mode : modeOf(name);
    this.mode = mode;
    const tabs = MODE_TABS[mode];
    for (const sec of Array.from(document.querySelectorAll<HTMLElement>('#setup section')))
      sec.classList.toggle('hidden', sec.dataset.tab !== name);
    for (const btn of Array.from(document.querySelectorAll<HTMLElement>('#tabs button'))) {
      btn.classList.toggle('on', btn.dataset.tab === name);
      btn.classList.toggle('hidden', !tabs.includes(btn.dataset.tab as Tab));
    }
    document.getElementById('tabs')!.classList.toggle('hidden', tabs.length < 2);
    document.getElementById('modeTitle')!.textContent = MODE_TITLE[mode];
    // 對戰世界有自己的挑戰按鈕
    this.startBtn.classList.toggle('hidden', mode === 'world');
    document.getElementById('planWrap')!.classList.toggle('hidden', mode === 'garage');
    // 出場額度只在改裝時看；超出額度時到處都要看得到
    this.budgetEl.classList.toggle('hidden', mode !== 'garage' && mode !== 'career' && this.legal);
    this.refresh();
  }

  /** 現在是從哪個入口進來的 */
  mode: Mode = 'solo';
  /** 出場額度上限（生涯的低級別比較少） */
  cap = BUDGET;
  /** 生涯這週接的對手（開打按鈕顯示用）；不是生涯就是 null */
  careerFoe: string | null = null;
  /** 生涯：身上的贊助商標誌（改裝廠的預覽也印上去） */
  patches: Patch[] = [];

  /** 現在選的對手的設定 */
  private foeSetup(): RobotSetup {
    return this.foe < 0 && this.daily ? this.daily.foe : LADDER[Math.max(0, this.foe)].setup;
  }

  /**
   * AI 教練的陪練模擬：拿現在這台和一批別的配法，各和選的對手無畫面打幾場，挑出勝率比現在高的前三套。
   * 一套一套跑、中間讓出時間給畫面，才不會整頁卡住。
   */
  async runCoach(): Promise<void> {
    if (this.coachBusy || !this.legal) return;
    this.coachBusy = true;
    this.coachDone = 0;
    this.coachNote = '';
    this.coachPlans = [];
    this.coachNow = null;
    const me = this.robot();
    const foe = this.foeSetup();
    const seed = (0xc0ac4 + this.progress.fights * 977 + (this.foe + 2) * 131) >>> 0;
    const list = candidates(me, this.progress.owned, seed, COACH_BUILDS);
    const trials: Trial[] = [];
    for (const c of list) {
      trials.push(trial(me, c, foe, seed));
      this.coachDone = trials.length;
      this.refreshCoach(list.length);
      await new Promise((done) => setTimeout(done, 0));
    }
    this.coachNow = trials[0];
    this.coachPlans = trials
      .slice(1)
      .filter((t) => better(t, trials[0]) < 0)
      // 勝場一樣多的話，改得越少的排越前面：玩家比較看得懂為什麼變強
      .sort((a, b) => b.wins - a.wins || a.diff.length - b.diff.length || b.margin - a.margin)
      .slice(0, 3);
    this.coachBusy = false;
    this.refreshCoach();
  }

  private refreshCoach(total = 0): void {
    const foe = this.foeSetup().name;
    const out: HTMLElement[] = [];
    if (this.coachBusy) out.push(node('div', 'now', `🤖 陪練模擬中… ${this.coachDone} / ${total} 套配法，每套打 ${TRIAL_FIGHTS} 場`));
    else {
      out.push(tip(node('div', 'hint', `🤖 讓教練幫你找打得贏「${foe}」的配法`), 'AI 教練', `教練會拿幾十套配法，各和「${foe}」的陪練機實際打 ${TRIAL_FIGHTS} 場，把勝率最高的挑出來給你選。`, '只會用你手上有的卡。'));
      const run = node('button', 'chip', this.coachNow ? '🤖 再模擬一次' : '🤖 跑陪練模擬') as HTMLButtonElement;
      run.disabled = !this.legal;
      run.addEventListener('click', () => void this.runCoach());
      out.push(run);
    }
    if (this.coachNote) out.push(node('div', 'now', this.coachNote));
    const now = this.coachNow;
    if (now && !this.coachBusy) {
      out.push(node('div', 'now', `現在這台：${now.fights} 場贏 ${now.wins} 場`));
      if (this.coachPlans.length === 0) out.push(node('div', 'now', '試過的配法裡沒有比現在這套更好的。去「訓練」調整打法，或先打別的對手拿新卡。'));
      this.coachPlans.forEach((t, i) => {
        const row = node('div', 'plan');
        const text = node('div', '');
        text.append(node('b', '', `方案 ${'ABC'[i]}：${t.fights} 場贏 ${t.wins} 場・花 ${t.cost} 點`));
        text.append(document.createTextNode(t.diff.join('；')));
        const use = node('button', 'primary', '換成這套');
        use.addEventListener('click', () => {
          this.apply(t.setup.gear, t.setup.brain, t.setup.deck);
          this.coachNote = `已經換成方案 ${'ABC'[i]}。想看換了什麼，到「改裝」分頁。`;
          this.coachNow = null;
          this.coachPlans = [];
          this.refreshCoach();
        });
        row.append(text, use);
        out.push(row);
      });
    }
    this.coachBox.replaceChildren(...out);
  }

  /** 目前選的這台機器人（訓練營和開打都用它） */
  robot(): RobotSetup {
    return {
      name: this.name,
      look: { ...this.look },
      gear: { ...this.gear },
      brain: this.brain,
      deck: [...this.deck],
      model: snapshot(this.progress.model),
      temper: { ...this.progress.temper },
      plan: [...this.plan],
    };
  }

  /** 作戰計畫：三個回合各一格，點一格再從下面挑戰術；旁邊是克制關係 */
  private refreshPlan(): void {
    const slots = node('div', 'planSlots');
    this.plan.forEach((t, i) => {
      const b = node('button', 'planSlot' + (this.planPick === i ? ' on' : ''));
      b.append(node('small', '', `第 ${i + 1} 回合`), node('i', '', TACTICS[t].icon), node('b', '', TACTICS[t].name));
      b.addEventListener('click', () => {
        this.planPick = this.planPick === i ? -1 : i;
        this.refreshPlan();
      });
      slots.append(b);
    });
    const out: HTMLElement[] = [slots];
    if (this.planPick >= 0) {
      const pick = node('div', 'planPick');
      for (const t of TACTIC_LIST) {
        const b = node('button', `tacBtn t-${t}` + (this.plan[this.planPick] === t ? ' on' : ''));
        b.append(node('b', '', `${TACTICS[t].icon} ${TACTICS[t].name}`), node('span', '', TACTICS[t].text));
        b.addEventListener('click', () => {
          this.plan[this.planPick] = t;
          this.planPick = this.planPick < 2 ? this.planPick + 1 : -1;
          this.store();
          this.refreshPlan();
        });
        pick.append(b);
      }
      out.push(pick);
    }
    const wheel = node('div', 'planWheel');
    // 克制一圈：猛攻 剋 技巧 剋 破防 剋 防守 剋 猛攻
    let t: Tactic = 'rush';
    for (let k = 0; k < 4; k++) {
      wheel.append(tacticChip(t), node('span', 'arrow', '剋'));
      t = BEATS[t]!;
    }
    wheel.append(tacticChip(t));
    out.push(wheel);
    this.planBox.replaceChildren(...out);
  }

  /** 進訓練營：三場沒人看的練習賽，然後往選的方向推一把 */
  private camp(i: number): void {
    if (!this.legal) return;
    const p = this.progress;
    const seed = (0x51ed270b + p.campRuns * 2654435761) >>> 0;
    const report = runCamp(this.robot(), p.model, p.temper, FOCUS[i], seed, campXpLeft(p));
    p.model = report.model;
    p.temper = report.temper;
    p.campXp += report.gained;
    p.campRuns++;
    saveProgress(p);

    const lines = report.spars.map((s) => `${s.foe}：${s.result > 0 ? '贏' : s.result < 0 ? '輸' : '平手'}${s.ko ? '（K.O.）' : ''}`);
    const gains = shownChanges(report.changes).map(
      (k) => `${ACTION_TEXT[k as keyof typeof ACTION_TEXT]} ${pct(report.changes[k][0])} → ${pct(report.changes[k][1])}`,
    );
    if (this.brain !== 'trained') lines.push('（大腦不是自訓模型，所以只有性格會變）');
    else if (gains.length) lines.push('模型：' + gains.join('、'));
    if (report.capped) lines.push(`今天訓練營的經驗已經到上限（每天 ${TRAINING_DAILY_XP}）。實戰不受限制。`);
    this.campReport.replaceChildren(node('b', '', `${FOCUS[i].name}：${SPARS} 場練習賽`), ...lines.map((l) => node('div', '', l)));
    this.refresh();
  }

  private toggle(id: string): void {
    if (!this.progress.owned.includes(id)) return;
    if (this.deck.includes(id)) this.deck = this.deck.filter((c) => c !== id);
    else {
      // 流派只能有一張：選新的就換掉舊的
      if (CARDS[id].kind === 'style') this.deck = this.deck.filter((c) => CARDS[c].kind !== 'style');
      if (this.deck.length >= BRAINS[this.brain].slots) return;
      this.deck = [...this.deck, id];
    }
    this.refresh();
  }

  /** 選一種武術：照這個流派的預設配法湊好整台（只用有的卡、不超過額度） */
  pickStyle(id: string): void {
    if (!this.progress.owned.includes(id)) return;
    const b = buildFor(id, this.progress.owned, this.cap);
    this.gear = b.gear;
    this.brain = b.brain;
    this.deck = b.deck;
    this.refresh();
  }

  /** 這台機器人的全部組成，排成一排卡（點一下打開細調） */
  private showDeckRow(): void {
    const wi = weightInfo(this.gear);
    const piece = (cls: string, title: string, sub: string, ...why: string[]): HTMLElement => {
      const n = node('button', 'piece ' + cls);
      n.append(node('span', '', title), node('small', '', sub));
      tip(n, title, ...why);
      n.addEventListener('click', () => ((document.getElementById('tune') as HTMLDetailsElement).open = true));
      return n;
    };
    const style = this.deck.find((c) => CARDS[c].kind === 'style');
    const brain = BRAINS[this.brain];
    this.deckRow.replaceChildren(
      style ? piece('k-style', CARDS[style].name, '流派', CARDS[style].text) : piece('k-style', '沒有流派', '⚠', '選上面一張流派卡'),
      piece('p-gear', ARMORS[this.gear.armor].name, `${wi.plateMm} mm・${Math.round(wi.mass)} kg・${wi.cls}`, ARMORS[this.gear.armor].text),
      piece('p-gear', WEAPONS[this.gear.weapon].name, '武器', WEAPONS[this.gear.weapon].text),
      piece('p-gear', THRUSTERS[this.gear.thruster].name, '推進器', THRUSTERS[this.gear.thruster].text),
      piece('p-brain', brain.name, `🃏${brain.slots} 張卡`, brain.quirkText ? `⚠ ${brain.quirkText}` : '沒有固定毛病'),
      ...this.deck.filter((c) => CARDS[c].kind !== 'style').map((c) => piece(`k-${CARDS[c].kind}`, CARDS[c].name, KIND_NAME[CARDS[c].kind], CARDS[c].text)),
    );
  }

  /** 直接換成一套配法（新手引導選流派用） */
  apply(gear: Loadout, brain: BrainId, deck: string[]): void {
    this.gear = { ...gear };
    this.brain = brain;
    this.deck = legalDeck(deck, brain).filter((id) => this.progress.owned.includes(id));
    this.refresh();
  }

  get value(): PlayerChoice {
    return { gear: { ...this.gear }, brain: this.brain, deck: [...this.deck], name: this.name, look: { ...this.look }, plan: [...this.plan] };
  }

  /** 有沒有在出場額度內 */
  get legal(): boolean {
    return totalCost(this.gear, this.brain, this.deck, snapshot(this.progress.model)) <= this.cap;
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  show(): void {
    // 選手預覽的 canvas 在大廳時會被搬過去，搬回來
    document.getElementById('campHead')!.prepend(document.getElementById('lookView')!);
    this.root.classList.remove('hidden');
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  /** 每次改選擇都存，重新整理頁面不會掉 */
  private store(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.value));
    } catch {
      // 存不了就算了
    }
  }

  /** 裝甲厚度和重量的換算：每一項都是 weightInfo 的公式算出來的 */
  private showWeight(): void {
    if (!this.plateRange || !this.plateLabel || !this.weightBox) return;
    const frame = ARMORS[this.gear.armor];
    const wi = weightInfo(this.gear);
    this.plateRange.max = String(frame.maxPlate);
    this.plateRange.value = String(wi.plateMm);
    this.plateLabel.textContent = `${wi.plateMm} mm・${plateCost(this.gear)} 點`;
    tip(this.plateLabel, '裝甲厚度', `每 5 mm ${frame.platePrice * PLATE_STEP} 點・${frame.name}最多 ${frame.maxPlate} mm`, `防護率 = 厚度 ÷ (厚度 + ${PLATE_HALF})`);
    const pct = (v: number): string => {
      const d = Math.round((v - 1) * 100);
      return d === 0 ? '±0%' : d > 0 ? `+${d}%` : `${d}%`;
    };
    const cell = (icon: string, name: string, value: string, good: boolean | null, why: string): HTMLElement => {
      const c = node('div', 'wcell' + (good === null ? '' : good ? ' good' : ' bad'));
      c.append(node('span', '', icon), node('b', '', value));
      tip(c, name, why);
      return c;
    };
    const mass = Math.round(wi.mass);
    const total = node('div', 'wtotal');
    total.append(node('b', '', `⚖ ${mass} kg`), node('span', '', wi.cls));
    tip(
      total,
      `總重 ${mass} kg（${wi.cls}）`,
      `骨架 ${wi.frame} + 裝甲 ${Math.round(wi.plate)}（${frame.area} m² × ${wi.plateMm} mm × ${PLATE_DENSITY}）+ 武器 ${wi.weapon} + 推進器 ${wi.thruster}`,
    );
    const bar = node('div', 'wbar');
    for (const [part, kg] of [['frame', wi.frame], ['plate', wi.plate], ['weapon', wi.weapon], ['thruster', wi.thruster]] as const) {
      const seg = node('i', 'w-' + part);
      seg.style.width = `${(kg / Math.max(250, wi.mass)) * 100}%`;
      bar.append(seg);
    }
    const grid = node('div', 'wgrid');
    grid.append(
      cell('🛡', '受傷', `${Math.round((1 - wi.taken) * 100)}%擋`, wi.taken < 0.97, `裝甲擋掉 ${Math.round((1 - wi.taken) * 100)}% 的傷害（${wi.plateMm} ÷ (${wi.plateMm} + ${PLATE_HALF})）`),
      cell('🦶', '走路', pct(wi.speed), wi.speed >= 0.995 ? null : false, `√(馬達 ${frame.motor} ÷ 總重 ${mass}) = ${wi.speed.toFixed(2)}`),
      cell('👊', '出招', Math.abs(wi.action - 1) < 0.005 ? '±0%' : wi.action > 1 ? `慢${Math.round((wi.action - 1) * 100)}%` : `快${Math.round((1 - wi.action) * 100)}%`, Math.abs(wi.action - 1) < 0.005 ? null : wi.action < 1, `蓄力、收招的時間和耗能 ×${wi.action.toFixed(2)}（(總重 ${mass} ÷ 伺服 ${frame.servo})^0.3）`),
      cell('🧱', '站穩', pct(wi.poise), wi.poise > 1.005 ? true : null, `平衡值 ×${wi.poise.toFixed(2)}、被打退 ×${wi.knockback.toFixed(2)}（越重越推不動）`),
      cell('🚀', '衝刺', pct(wi.dash), wi.dash >= 0.995 ? null : false, `衝刺速度 ×${wi.dash.toFixed(2)}（(${REF_MASS} ÷ 總重 ${mass})^0.15）`),
    );
    this.weightBox.replaceChildren(total, bar, grid);
  }

  refresh(): void {
    this.store();
    this.preview.set(this.gear, this.look, this.patches);
    for (const b of this.lookButtons) b.btn.classList.toggle('on', this.look[b.key] === b.id);
    const brain = BRAINS[this.brain];
    const program = compile(this.deck, this.brain, snapshot(this.progress.model));
    const full = this.deck.length >= brain.slots;
    const hasStyle = this.deck.some((c) => CARDS[c].kind === 'style');

    for (const [id, btn] of this.brainButtons) btn.classList.toggle('on', id === this.brain);
    for (const g of this.gearButtons) g.btn.classList.toggle('on', this.gear[g.slot] === g.id);
    this.showWeight();

    const snap = snapshot(this.progress.model);
    this.brainButtons.get('trained')!.firstElementChild!.textContent = BRAINS.trained.name + '　' + snap.cost + ' 點';
    const cost = totalCost(this.gear, this.brain, this.deck, snap);
    const cards = deckCost(this.deck);
    const over = cost > this.cap;
    // 額度：一條橫條加數字
    const fill = node('i', '');
    fill.style.width = `${Math.min(100, (cost / this.cap) * 100)}%`;
    const track = node('span', 'btrack');
    track.append(fill);
    this.budgetEl.replaceChildren(
      node('span', '', '💰'),
      track,
      node('b', '', over ? `超出 ${cost - this.cap}` : `${cost} / ${this.cap}`),
    );
    tip(this.budgetEl, '出場額度', `裝備和大腦 ${cost - cards} 點・流派和卡 ${cards} 點`, over ? '超出了：拿掉幾張卡，或換便宜一點的零件、大腦' : `還剩 ${this.cap - cost} 點`);
    this.budgetEl.classList.toggle('over', over);
    this.startBtn.disabled = over;
    // 選手本人：名字、戰績、排名
    const beaten = LADDER.filter((o) => (this.progress.record[o.id]?.w ?? 0) > 0).length;
    const won = LADDER.reduce((n, o) => n + (this.progress.record[o.id]?.w ?? 0), 0);
    const lost = LADDER.reduce((n, o) => n + (this.progress.record[o.id]?.l ?? 0), 0);
    document.getElementById('fighterName')!.textContent = this.name;
    document.getElementById('career')!.textContent = `${won} 勝 ${lost} 敗・${rankText(beaten)}`;
    for (const [id, btn] of this.cardButtons) {
      const on = this.deck.includes(id);
      btn.classList.toggle('on', on);
      const locked = !this.progress.owned.includes(id);
      btn.classList.toggle('locked', locked);
      const c = CARDS[id];
      tip(btn, `${KIND_NAME[c.kind]}・${c.name}`, c.text, `代價：${c.cost}`, locked ? `🔒 ${howToGet(id, PRIZE_FROM)}，或抽扭蛋` : on ? '點一下拿掉' : '點一下插上');
      // 卡槽滿了就不能再加（流派可以直接替換）
      const swappable = CARDS[id].kind === 'style' && hasStyle;
      (btn as HTMLButtonElement).disabled = locked || (!on && full && !swappable);
    }

    for (const [id, btn] of this.styleButtons) {
      const c = CARDS[id];
      const locked = !this.progress.owned.includes(id);
      btn.classList.toggle('on', this.deck.includes(id));
      btn.classList.toggle('locked', locked);
      (btn as HTMLButtonElement).disabled = locked;
      tip(btn, `流派・${c.name}（${c.price} 點）`, c.text, `代價：${c.cost}`, locked ? `🔒 ${howToGet(id, PRIZE_FROM)}，或抽扭蛋` : '點一下：整台換成這個流派的配法');
    }
    // 有的流派排前面
    const styleBox = document.getElementById('styles')!;
    styleBox.append(...[...this.styleButtons].sort(([a], [b]) => Number(!this.progress.owned.includes(a)) - Number(!this.progress.owned.includes(b))).map(([, btn]) => btn));
    // 還沒拿到的流派預設收起來，按一下才展開
    const lockedN = [...this.styleButtons.keys()].filter((id) => !this.progress.owned.includes(id)).length;
    this.moreStyles.textContent = styleBox.classList.contains('showLocked') ? '收起還沒拿到的流派' : `🔒 還有 ${lockedN} 種流派沒拿到（扭蛋、排名戰）`;
    this.moreStyles.classList.toggle('hidden', lockedN === 0);
    styleBox.append(this.moreStyles);
    this.showDeckRow();

    this.slotBox.replaceChildren(
      ...Array.from({ length: brain.slots }, (_, i) => {
        const id = this.deck[i];
        if (!id) return node('div', 'slot empty', '空');
        const slot = node('button', `slot k-${CARDS[id].kind}`, CARDS[id].name);
        slot.title = '點一下拿掉';
        slot.addEventListener('click', () => this.toggle(id));
        return slot;
      }),
    );

    this.readout.textContent =
      `🃏${this.deck.length}　⚡${(program.reaction / TICK_HZ).toFixed(2)}s　` +
      (this.brain === 'trained' ? `🎯×${program.accScale.toFixed(2)}` : `🎯${Math.round(program.accuracy * 100)}%`) +
      (hasStyle ? '' : '　⚠ 沒有流派卡');
    tip(this.readout, '大腦現在的狀態', '每多插一張卡，反應慢 8%、準確率少 2%', hasStyle ? '' : '沒有流派卡：只會走過去偶爾戳一下。');
    this.refreshGrowth(over);
    this.refreshFoes();
  }

  /** 現在選的對手叫什麼（開打按鈕、對照表用） */
  get foeName(): string {
    return this.careerFoe ?? this.foeSetup().name;
  }

  /** 對手名單：打贏前一個才打得到下一個 */
  refreshFoes(): void {
    const open = unlockedCount(this.progress);
    if (this.foe >= open) this.foe = open - 1;
    const cards: HTMLElement[] = [];
    if (this.daily) {
      // 每日挑戰：打贏過第一個對手才開放
      const d = this.daily;
      const rec = this.progress.daily;
      const locked = open < 2;
      if (locked && this.foe < 0) this.foe = 0;
      const date = new Date(d.day * 86400000);
      const btn = node('button', 'card foe daily' + (this.foe === -1 ? ' on' : '')) as HTMLButtonElement;
      btn.disabled = locked;
      btn.append(node('b', '', `📅 每日挑戰　${date.getUTCMonth() + 1}/${date.getUTCDate()}${rec.best > 0 ? '　✔' : ''}`));
      if (locked) btn.append(node('span', 'lock', `🔒 先打贏 ${LADDER[0].setup.name}`));
      else {
        btn.append(node('span', '', `${d.foe.name}・${BRAINS[d.foe.brain].name}・${gearText(d.foe.gear)}`));
        tip(btn, '每日挑戰', '今天全世界的玩家都打這一台、用同一個種子。', '分數 = 打贏 400 + 省下的額度 + 剩下的血和時間，所以越便宜的配法打贏，分數越高。');
        btn.append(
          node(
            'span',
            'cost',
            (rec.best > 0 ? `🏅 ${rec.best} 分` : rec.tries > 0 ? '還沒打贏' : '還沒挑戰') + `・🔥 連續 ${rec.streak} 天`,
          ),
        );
      }
      btn.addEventListener('click', () => {
        this.foe = -1;
        this.refreshFoes();
      });
      cards.push(btn);
    }
    this.foeBox.replaceChildren(
      ...cards,
      ...LADDER.map((o, i) => {
        const locked = i >= open;
        const rec = this.progress.record[o.id] ?? { w: 0, l: 0 };
        const btn = node('button', 'card foe' + (i === this.foe ? ' on' : '')) as HTMLButtonElement;
        btn.disabled = locked;
        const art = locked ? null : artFor('foe_' + o.id);
        if (art) btn.append(art);
        const rank = i === LADDER.length - 1 ? '👑 冠軍' : `第 ${LADDER.length - i} 名`;
        btn.append(node('b', '', `${rank}　${locked ? '？？？' : o.setup.name}${rec.w > 0 ? '　✔' : ''}`));
        if (locked) btn.append(node('span', 'lock', `🔒 先打贏 ${LADDER[i - 1].setup.name}`));
        else {
          btn.append(node('span', '', `${BRAINS[o.setup.brain].name}・${gearText(o.setup.gear)}`));
          tip(btn, o.setup.name, o.bio);
          // 情報：打過一次就看得到它的作戰計畫
          const seen = rec.w + rec.l > 0;
          const intel = node('span', 'intel', seen ? '📋' : '📋 打過才看得到計畫');
          if (seen) cleanPlan(o.setup.plan).forEach((t, k) => intel.append(node('small', '', `R${k + 1}`), tacticChip(t)));
          btn.append(intel);
          btn.append(node('span', 'cost', `${rec.w} 勝 ${rec.l} 敗・🎁 ${CARDS[o.prize].name}${this.progress.owned.includes(o.prize) ? ' ✔' : ''}`));
        }
        btn.addEventListener('click', () => {
          this.foe = i;
          this.refreshFoes();
        });
        return btn;
      }),
    );
    this.startBtn.textContent = this.legal ? `開打：對 ${this.foeName}` : '超出額度';
    if (!this.coachBusy) this.refreshCoach();
  }

  /** 養成區：模型的熟練度、性格、訓練營 */
  refreshGrowth(over = !this.legal): void {
    const snap = snapshot(this.progress.model);
    const keys = Object.keys(snap.prof).sort((a, b) => snap.prof[b] - snap.prof[a]);
    const rows = keys.map((k) => {
      const name = ACTION_TEXT[k as keyof typeof ACTION_TEXT] + (snap.habit === k ? '（習慣）' : '');
      return bar(name, '', snap.prof[k], pct(snap.prof[k]));
    });
    this.modelBox.replaceChildren(
      tip(
        node('div', 'hint', keys.length ? `目前身價 ${snap.cost} 點` : '還沒練過（全部 20%）'),
        '自訓模型',
        '選它當大腦去打，用到的動作就會進步；沒練過的動作都是 20%。',
      ),
      ...rows,
    );
    this.temperBox.replaceChildren(
      ...AXES.map((axis) => bar(AXIS_TEXT[axis].low, AXIS_TEXT[axis].high, this.progress.temper[axis], '')),
    );
    const left = Math.round(campXpLeft(this.progress));
    document.getElementById('campHint')!.textContent = over
      ? '超出額度的機器人不能進訓練營。'
      : `選一個方向，打 ${SPARS} 場練習賽・今天還能練 ${left} 點`;
    for (const b of this.campButtons) b.disabled = over;
  }
}
