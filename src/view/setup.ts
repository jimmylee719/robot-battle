/** 賽前設定畫面：選裝備和大腦（共用一筆預算）、把卡插進卡槽。 */
import { BRAINS, CARD_LIST, CARDS, compile, KIND_NAME, legalDeck, type BrainId, type CardKind } from '../sim/cards';
import { ARMORS, BRAIN_COST, BUDGET, cleanGear, DEFAULT_GEAR, THRUSTERS, totalCost, WEAPONS, type GearItem } from '../sim/gear';
import { TICK_HZ } from '../sim/match';
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

  constructor(onStart: (choice: PlayerChoice) => void) {
    const saved = load();
    this.gear = saved.gear;
    this.brain = saved.brain;
    this.deck = saved.deck;

    const gearBox = document.getElementById('gear')!;
    for (const { slot, title, items } of GEAR_SLOTS) {
      gearBox.append(node('div', 'kind', title));
      const grid = node('div', 'cardgrid');
      for (const item of Object.values(items)) {
        const btn = node('button', 'card gear');
        btn.append(node('b', '', item.name + '　$' + item.cost));
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
      btn.append(node('b', '', b.name + '　$' + BRAIN_COST[b.id]));
      btn.append(node('span', '', `${b.slots} 格・反應 ${seconds(b.reaction)}・準確率 ${Math.round(b.accuracy * 100)}%`));
      if (b.quirkText) btn.append(node('span', 'quirk', b.quirkText));
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
        btn.append(node('b', '', card.name));
        btn.append(node('span', '', card.text));
        btn.append(node('span', 'cost', `代價：${card.cost}`));
        btn.addEventListener('click', () => this.toggle(card.id));
        this.cardButtons.set(card.id, btn);
        grid.append(btn);
      }
      this.table.append(grid);
    }

    this.startBtn.addEventListener('click', () => {
      if (this.legal) onStart(this.value);
    });
    this.refresh();
  }

  private toggle(id: string): void {
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

  /** 有沒有在預算內 */
  get legal(): boolean {
    return totalCost(this.gear, this.brain) <= BUDGET;
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  show(): void {
    this.root.classList.remove('hidden');
  }

  hide(): void {
    this.root.classList.add('hidden');
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.value));
    } catch {
      // 存不了就算了
    }
  }

  private refresh(): void {
    const brain = BRAINS[this.brain];
    const program = compile(this.deck, this.brain);
    const full = this.deck.length >= brain.slots;
    const hasStyle = this.deck.some((c) => CARDS[c].kind === 'style');

    for (const [id, btn] of this.brainButtons) btn.classList.toggle('on', id === this.brain);
    for (const g of this.gearButtons) g.btn.classList.toggle('on', this.gear[g.slot] === g.id);

    const cost = totalCost(this.gear, this.brain);
    const over = cost > BUDGET;
    this.budgetEl.textContent = over
      ? '預算 $' + cost + ' / $' + BUDGET + '　超出 $' + (cost - BUDGET) + '，換便宜一點的零件或大腦'
      : '預算 $' + cost + ' / $' + BUDGET + '　還剩 $' + (BUDGET - cost);
    this.budgetEl.classList.toggle('over', over);
    this.startBtn.disabled = over;
    this.startBtn.textContent = over ? '超出預算' : '開打';
    for (const [id, btn] of this.cardButtons) {
      const on = this.deck.includes(id);
      btn.classList.toggle('on', on);
      // 卡槽滿了就不能再加（流派可以直接替換）
      const swappable = CARDS[id].kind === 'style' && hasStyle;
      (btn as HTMLButtonElement).disabled = !on && full && !swappable;
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
      `${this.deck.length} 張卡・準確率 ${Math.round(program.accuracy * 100)}%・反應 ${seconds(program.reaction)}`,
      this.deck.length > 1 ? '（每多一張卡，反應慢 8%、準確率少 2%）' : '',
      hasStyle ? '' : '沒有流派卡：只會走過去偶爾戳一下。',
    ];
    this.readout.textContent = lines.filter(Boolean).join('　');
  }
}
