/** 賽前設定畫面：選 AI 等級、寫戰術 prompt。 */
import { PROMPT_MAX, TIERS, type Tier } from '../sim/interpreter';

export interface PlayerChoice {
  prompt: string;
  tier: Tier;
}

const STORAGE_KEY = 'prompt-cage.choice';
const DEFAULT_PROMPT = '先繞圈保持距離，對手血量低於 30% 時衝刺連打';
const EXAMPLES = [
  '先繞圈保持距離，對手血量低於 30% 時衝刺連打',
  '對手出拳時防禦，對手露出破綻時重拳反擊，平常用刺拳打',
  '把對手逼到角落，然後用組合拳。自己血量低於 25% 就逃跑',
  '不要防禦，一直進攻！',
];

function load(): PlayerChoice {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const v = JSON.parse(raw) as Partial<PlayerChoice>;
      if (typeof v.prompt === 'string' && v.tier && v.tier in TIERS) return { prompt: v.prompt.slice(0, PROMPT_MAX), tier: v.tier };
    }
  } catch {
    // 無痕模式之類的情況下 localStorage 可能不能用，忽略
  }
  return { prompt: DEFAULT_PROMPT, tier: 'pro' };
}

export class SetupScreen {
  private root = document.getElementById('setup')!;
  private input = document.getElementById('prompt') as HTMLTextAreaElement;
  private counter = document.getElementById('count')!;
  private tierBox = document.getElementById('tiers')!;
  private tier: Tier;

  constructor(onStart: (choice: PlayerChoice) => void) {
    const saved = load();
    this.tier = saved.tier;
    this.input.maxLength = PROMPT_MAX;
    this.input.value = saved.prompt;
    this.input.addEventListener('input', () => this.refresh());

    for (const t of Object.values(TIERS)) {
      const b = document.createElement('button');
      b.className = 'tier';
      b.dataset.tier = t.id;
      const name = document.createElement('b');
      name.textContent = t.name;
      const blurb = document.createElement('span');
      blurb.textContent = t.blurb;
      b.append(name, blurb);
      b.addEventListener('click', () => {
        this.tier = t.id;
        this.refresh();
      });
      this.tierBox.append(b);
    }

    const examples = document.getElementById('examples')!;
    EXAMPLES.forEach((text, i) => {
      const b = document.createElement('button');
      b.className = 'chip';
      b.textContent = `範例 ${i + 1}`;
      b.title = text;
      b.addEventListener('click', () => {
        this.input.value = text;
        this.refresh();
      });
      examples.append(b);
    });

    const go = (): void => onStart(this.value);
    document.getElementById('startBtn')!.addEventListener('click', go);
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) go();
    });
    this.refresh();
  }

  get value(): PlayerChoice {
    return { prompt: this.input.value.trim(), tier: this.tier };
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  show(): void {
    this.root.classList.remove('hidden');
  }

  hide(): void {
    this.root.classList.add('hidden');
    this.input.blur();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.value));
    } catch {
      // 存不了就算了
    }
  }

  private refresh(): void {
    this.counter.textContent = `${this.input.value.length} / ${PROMPT_MAX}`;
    for (const b of this.tierBox.children) b.classList.toggle('on', (b as HTMLElement).dataset.tier === this.tier);
  }
}
