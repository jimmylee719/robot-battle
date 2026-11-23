/**
 * 扭蛋機畫面（純畫面）。規則在 sim/gacha.ts。
 * 動畫：轉把手（機器晃）→ 蛋掉出來 → 蛋打開（稀有的會發光）→ 卡翻出來。
 * 抽卡的亂數用 Math.random 當種子：扭蛋不是對戰，不需要重播。
 */
import { Rng } from '../core/rng';
import { CARDS } from '../sim/cards';
import { COST_ONE, COST_TEN, PITY, RARITY_NAME, RARITY_STARS, RATES, spin, type Pull, type Rarity } from '../sim/gacha';
import type { SoundPlayer } from '../audio/sound';
import type { Progress } from './save';
import { artFor } from './art';

const CAPSULE: Record<Rarity, string> = { N: '#7ee8c4', R: '#b9a4ff', SR: '#ffd166' };
const DOME_COLORS = ['#7ee8c4', '#7fd3ff', '#ffb38a', '#b9a4ff', '#ffe58a', '#ff8fd8'];
const RANK: Record<Rarity, number> = { N: 0, R: 1, SR: 2 };

function el(tag: string, cls = '', text = ''): HTMLElement {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text) n.textContent = text;
  return n;
}

const wait = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/** 一張翻出來的卡 */
export function pullCard(p: Pull): HTMLElement {
  const c = CARDS[p.card];
  const card = el('div', `gcard r-${p.rarity}`);
  const art = artFor(p.card);
  card.append(art ?? el('div', 'noart', '🃏'));
  card.append(el('div', 'stars', RARITY_STARS[p.rarity]));
  card.append(el('b', '', c.name));
  card.append(el('span', p.fresh ? 'badge new' : 'badge dupe', p.fresh ? 'NEW!' : `+${p.frags} 💠`));
  return card;
}

export class GachaScreen {
  private root = document.getElementById('gacha')!;
  private machine = document.getElementById('machine')!;
  private result = document.getElementById('gResult')!;
  private walletEl = document.getElementById('gWallet')!;
  private info = document.getElementById('gInfo')!;
  private btn1 = document.getElementById('spin1') as HTMLButtonElement;
  private btn10 = document.getElementById('spin10') as HTMLButtonElement;
  private busy = false;

  constructor(
    private progress: Progress,
    private audio: SoundPlayer,
    private save: () => void,
  ) {
    // 圓頂裡的扭蛋
    const dome = document.getElementById('dome')!;
    for (let i = 0; i < 16; i++) {
      const b = el('i');
      const a = (i / 16) * Math.PI * 2;
      const r = 18 + (i % 3) * 12;
      b.style.left = `${50 + Math.cos(a) * r}%`;
      b.style.top = `${58 + Math.sin(a) * r * 0.7}%`;
      b.style.background = DOME_COLORS[i % DOME_COLORS.length];
      b.style.animationDelay = `${-i * 0.13}s`;
      dome.append(b);
    }
    this.btn1.addEventListener('click', () => void this.go(1));
    this.btn10.addEventListener('click', () => void this.go(10));
    this.btn1.textContent = `轉一次　🪙${COST_ONE}`;
    this.btn10.textContent = `十連　🪙${COST_TEN}`;
  }

  open(): void {
    this.result.replaceChildren(el('div', 'ghint', '轉轉看！抽到重複的卡會變成碎片 💠，可以到卡牌倉庫兌換想要的卡。'));
    this.refresh();
    this.root.classList.remove('hidden');
  }

  private refresh(): void {
    const w = this.progress.wallet;
    this.walletEl.replaceChildren(el('span', 'coin', `🪙 ${w.coins}`), el('span', 'frag', `💠 ${w.frags}`));
    this.btn1.disabled = this.busy || w.coins < COST_ONE;
    this.btn10.disabled = this.busy || w.coins < COST_TEN;
    const pct = (r: Rarity): string => `${RARITY_STARS[r]} ${RARITY_NAME[r]} ${Math.round(RATES[r] * 100)}%`;
    this.info.textContent = `機率：${pct('SR')}・${pct('R')}・${pct('N')}　｜　再 ${PITY - w.pity} 次內必出超稀有　｜　十連保底一張稀有以上`;
  }

  private async go(n: 1 | 10): Promise<void> {
    if (this.busy) return;
    const rng = new Rng((Math.random() * 4294967296) >>> 0);
    const pulls = spin(n, this.progress.owned, this.progress.wallet, rng);
    if (!pulls) return;
    this.save();
    this.busy = true;
    this.refresh();
    this.audio.unlock();
    const best = pulls.reduce<Rarity>((b, p) => (RANK[p.rarity] > RANK[b] ? p.rarity : b), 'N');

    // 1. 轉把手
    this.result.replaceChildren();
    this.machine.classList.remove('done');
    this.machine.classList.add('turning');
    this.audio.play('crank');
    await wait(900);
    this.machine.classList.remove('turning');

    // 2. 蛋掉出來、晃一晃
    const cap = el('div', `capsule c-${best}`);
    cap.style.setProperty('--cap', CAPSULE[best]);
    cap.append(el('i', 'top'), el('i', 'bot'));
    this.result.append(cap);
    await wait(1000);

    // 3. 打開
    cap.classList.add('open');
    this.audio.play('pop');
    if (best !== 'N') this.audio.play('rare');
    if (best === 'SR') this.result.classList.add('rays');
    await wait(380);

    // 4. 卡翻出來
    const grid = el('div', n === 10 ? 'ggrid ten' : 'ggrid');
    this.result.replaceChildren(grid);
    for (const p of pulls) {
      const card = pullCard(p);
      grid.append(card);
      if (n === 10) {
        this.audio.play('pop', { volume: 0.4 });
        await wait(110);
      }
    }
    const fresh = pulls.filter((p) => p.fresh).length;
    const frags = pulls.reduce((s, p) => s + p.frags, 0);
    this.result.append(el('div', 'ghint', fresh ? `🎉 新卡 ${fresh} 張${frags ? `，碎片 +${frags}` : ''}` : `都是重複的，碎片 +${frags} 💠`));
    await wait(600);
    this.result.classList.remove('rays');
    this.busy = false;
    this.refresh();
  }
}
