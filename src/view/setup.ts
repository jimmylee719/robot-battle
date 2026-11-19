/** 賽前設定畫面：選裝備、大腦、流派和卡（全部花同一筆出場額度）、把卡插進卡槽、看養成進度、進訓練營。 */
import { BRAINS, CARD_LIST, CARDS, compile, KIND_NAME, legalDeck, type BrainId, type CardKind } from '../sim/cards';
import { ARMORS, BRAIN_COST, BUDGET, cleanGear, deckCost, DEFAULT_GEAR, THRUSTERS, totalCost, WEAPONS, type GearItem } from '../sim/gear';
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

export interface PlayerChoice {
  gear: Loadout;
  brain: BrainId;
  deck: string[];
}

const STORAGE_KEY = 'prompt-cage.deck';
const DEFAULT: PlayerChoice = { gear: DEFAULT_GEAR, brain: 'parrot', deck: ['boxing', 'read_heavy', 'smell_blood'] };
const GEAR_SLOTS: { slot: keyof Loadout; title: string; items: Record<string, GearItem> }[] = [
  { slot: 'weapon', title: '武器', items: WEAPONS },
  { slot: 'armor', title: '骨架', items: ARMORS },
  { slot: 'thruster', title: '推進器', items: THRUSTERS },
];
const KINDS: CardKind[] = ['style', 'reflex', 'trait', 'signature'];

function load(): PlayerChoice {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const v = JSON.parse(raw) as Partial<PlayerChoice>;
      if (v.brain && v.brain in BRAINS && Array.isArray(v.deck))
        return { gear: cleanGear(v.gear), brain: v.brain, deck: legalDeck(v.deck.map(String), v.brain) };
    }
  } catch {
    // 無痕模式之類的情況下 localStorage 可能不能用，忽略
  }
  return { gear: { ...DEFAULT.gear }, brain: DEFAULT.brain, deck: [...DEFAULT.deck] };
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
  private gearButtons: { slot: keyof Loadout; id: string; btn: HTMLElement }[] = [];
  private brainButtons = new Map<BrainId, HTMLElement>();
  private cardButtons = new Map<string, HTMLElement>();
  private modelBox = document.getElementById('modelBox')!;
  private temperBox = document.getElementById('temperBox')!;
  private campBox = document.getElementById('campBox')!;
  private campReport = document.getElementById('campReport')!;
  private campButtons: HTMLButtonElement[] = [];
  private foeBox = document.getElementById('foes')!;
  /** 選了第幾個對手 */
  foe = 0;

  constructor(
    private progress: Progress,
    onStart: (choice: PlayerChoice) => void,
  ) {
    const saved = load();
    this.gear = saved.gear;
    this.brain = saved.brain;
    this.deck = saved.deck.filter((id) => this.progress.owned.includes(id));
    this.foe = unlockedCount(this.progress) - 1;

    const gearBox = document.getElementById('gear')!;
    for (const { slot, title, items } of GEAR_SLOTS) {
      gearBox.append(node('div', 'kind', title));
      const grid = node('div', 'cardgrid');
      for (const item of Object.values(items)) {
        const btn = node('button', 'card gear');
        btn.append(node('b', '', item.name + '　' + item.cost + ' 點'));
        btn.append(node('span', '', item.text));
        btn.addEventListener('click', () => {
          this.gear = { ...this.gear, [slot]: item.id };
          this.refresh();
        });
        this.gearButtons.push({ slot, id: item.id, btn });
        grid.append(btn);
      }
      gearBox.append(grid);
    }

    for (const b of Object.values(BRAINS)) {
      const btn = node('button', 'brain');
      btn.append(node('b', '', b.name + '　' + BRAIN_COST[b.id] + ' 點'));
      if (b.id === 'trained') {
        btn.append(node('span', '', `${b.slots} 格・反應 ${seconds(b.reaction)}・每個動作各看熟練度`));
        btn.append(node('span', 'quirk good', '你自己養的：越打越強，也越來越貴'));
      } else {
        btn.append(node('span', '', `${b.slots} 格・反應 ${seconds(b.reaction)}・準確率 ${Math.round(b.accuracy * 100)}%`));
        if (b.quirkText) btn.append(node('span', 'quirk', b.quirkText));
      }
      btn.addEventListener('click', () => {
        this.brain = b.id;
        this.deck = legalDeck(this.deck, b.id);
        this.refresh();
      });
      this.brainButtons.set(b.id, btn);
      this.brainBox.append(btn);
    }

    for (const kind of KINDS) {
      this.table.append(node('div', 'kind', kind === 'style' ? `${KIND_NAME[kind]}（最多一張）` : KIND_NAME[kind]));
      const grid = node('div', 'cardgrid');
      for (const card of CARD_LIST.filter((c) => c.kind === kind)) {
        const btn = node('button', `card k-${kind}`);
        btn.append(node('b', '', card.name + '　' + card.price + ' 點'));
        btn.append(node('span', '', card.text));
        btn.append(node('span', 'cost', `代價：${card.cost}`));
        btn.append(node('span', 'lock', `🔒 ${howToGet(card.id, PRIZE_FROM)}`));
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
      btn.append(node('span', '', focus.tip));
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
    this.refresh();
  }

  /** 目前選的這台機器人（訓練營和開打都用它） */
  robot(): RobotSetup {
    return {
      name: 'PLAYER-01',
      gear: { ...this.gear },
      brain: this.brain,
      deck: [...this.deck],
      model: snapshot(this.progress.model),
      temper: { ...this.progress.temper },
    };
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

  get value(): PlayerChoice {
    return { gear: { ...this.gear }, brain: this.brain, deck: [...this.deck] };
  }

  /** 有沒有在出場額度內 */
  get legal(): boolean {
    return totalCost(this.gear, this.brain, this.deck, snapshot(this.progress.model)) <= BUDGET;
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  show(): void {
    this.root.classList.remove('hidden');
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  refresh(): void {
    // 每次改選擇都存，重新整理頁面不會掉
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.value));
    } catch {
      // 存不了就算了
    }
    const brain = BRAINS[this.brain];
    const program = compile(this.deck, this.brain, snapshot(this.progress.model));
    const full = this.deck.length >= brain.slots;
    const hasStyle = this.deck.some((c) => CARDS[c].kind === 'style');

    for (const [id, btn] of this.brainButtons) btn.classList.toggle('on', id === this.brain);
    for (const g of this.gearButtons) g.btn.classList.toggle('on', this.gear[g.slot] === g.id);

    const snap = snapshot(this.progress.model);
    this.brainButtons.get('trained')!.firstElementChild!.textContent = BRAINS.trained.name + '　' + snap.cost + ' 點';
    const cost = totalCost(this.gear, this.brain, this.deck, snap);
    const cards = deckCost(this.deck);
    const over = cost > BUDGET;
    this.budgetEl.textContent = over
      ? '出場額度 ' + cost + ' / ' + BUDGET + '　超出 ' + (cost - BUDGET) + ' 點：拿掉幾張卡，或換便宜一點的零件、大腦'
      : '出場額度 ' + cost + ' / ' + BUDGET + '　還剩 ' + (BUDGET - cost) + ' 點（裝備和大腦 ' + (cost - cards) + '・流派和卡 ' + cards + '）';
    this.budgetEl.classList.toggle('over', over);
    this.startBtn.disabled = over;
    this.startBtn.textContent = over ? '超出額度' : '開打';
    for (const [id, btn] of this.cardButtons) {
      const on = this.deck.includes(id);
      btn.classList.toggle('on', on);
      const locked = !this.progress.owned.includes(id);
      btn.classList.toggle('locked', locked);
      // 卡槽滿了就不能再加（流派可以直接替換）
      const swappable = CARDS[id].kind === 'style' && hasStyle;
      (btn as HTMLButtonElement).disabled = locked || (!on && full && !swappable);
    }

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

    const lines = [
      this.brain === 'trained'
        ? `${this.deck.length} 張卡・熟練度 ×${program.accScale.toFixed(2)}・反應 ${seconds(program.reaction)}`
        : `${this.deck.length} 張卡・準確率 ${Math.round(program.accuracy * 100)}%・反應 ${seconds(program.reaction)}`,
      this.deck.length > 1 ? '（每多一張卡，反應慢 8%、準確率少 2%）' : '',
      hasStyle ? '' : '沒有流派卡：只會走過去偶爾戳一下。',
    ];
    this.readout.textContent = lines.filter(Boolean).join('　');
    this.refreshGrowth(over);
    this.refreshFoes();
  }

  /** 對手名單：打贏前一個才打得到下一個 */
  refreshFoes(): void {
    const open = unlockedCount(this.progress);
    if (this.foe >= open) this.foe = open - 1;
    this.foeBox.replaceChildren(
      ...LADDER.map((o, i) => {
        const locked = i >= open;
        const rec = this.progress.record[o.id] ?? { w: 0, l: 0 };
        const btn = node('button', 'card foe' + (i === this.foe ? ' on' : '')) as HTMLButtonElement;
        btn.disabled = locked;
        btn.append(node('b', '', `${i + 1}　${locked ? '？？？' : o.setup.name}${rec.w > 0 ? '　✔' : ''}`));
        if (locked) btn.append(node('span', 'lock', `🔒 先打贏 ${LADDER[i - 1].setup.name}`));
        else {
          btn.append(node('span', '', `${BRAINS[o.setup.brain].name}・${gearText(o.setup.gear)}`));
          btn.append(node('span', '', o.bio));
          btn.append(node('span', 'cost', `戰績 ${rec.w} 勝 ${rec.l} 敗・首勝獎勵：${CARDS[o.prize].name}${this.progress.owned.includes(o.prize) ? '（已有）' : ''}`));
        }
        btn.addEventListener('click', () => {
          this.foe = i;
          this.refreshFoes();
        });
        return btn;
      }),
    );
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
      node('div', 'hint', keys.length ? `自訓模型・目前 ${snap.cost} 點・沒練過的動作都是 20%` : '自訓模型還沒練過任何動作（全部 20%）。選它當大腦去打，用到的動作就會進步。'),
      ...rows,
    );
    this.temperBox.replaceChildren(
      ...AXES.map((axis) => bar(AXIS_TEXT[axis].low, AXIS_TEXT[axis].high, this.progress.temper[axis], '')),
    );
    const left = Math.round(campXpLeft(this.progress));
    document.getElementById('campHint')!.textContent = over
      ? '超出額度的機器人不能進訓練營。'
      : `用上面這台機器人去打 ${SPARS} 場沒人看的練習賽。今天訓練營還能給自訓模型 ${left} 點經驗。`;
    for (const b of this.campButtons) b.disabled = over;
  }
}
