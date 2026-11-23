/**
 * 首頁和大廳（純畫面）。
 *  - 首頁：標題、開始遊戲、遊玩方法、製作團隊
 *  - 大廳：選手本人 + 五個入口（單人遊玩、對戰世界、我的角色、卡牌倉庫、扭蛋）
 *  - 卡牌倉庫：拿到的卡亮著，沒拿到的是剪影，點一下看說明和怎麼拿
 * 進到單人、對戰世界、我的角色，就是打開設定畫面的對應分頁（SetupScreen 的 mode）。
 */
import { CARD_LIST, CARDS, KIND_NAME, type CardKind } from '../sim/cards';
import { howToGet } from '../sim/album';
import { PRIZE_FROM } from '../sim/roster';
import { artFor } from './art';
import type { Mode } from './setup';
import { claimSupply, craft, CRAFT_COST, RARITY_NAME, RARITY_STARS, rarityOf } from '../sim/gacha';
import type { SoundPlayer } from '../audio/sound';
import { dailyDay, type Progress } from './save';
import { GachaScreen } from './gacha';

/** 製作團隊：改這裡就好 */
export const CREDITS: { role: string; names: string[] }[] = [
  { role: '遊戲設計・企劃', names: ['PROMPT CAGE 製作團隊'] },
  { role: '程式・體素美術', names: ['PROMPT CAGE 製作團隊'] },
  { role: '音效', names: ['Web Audio 即時合成'] },
  { role: '特別感謝', names: ['每一位上場的教練'] },
];
export const VERSION_TEXT = 'v0.8 早期測試版';

const HOWTO: { icon: string; title: string; text: string }[] = [
  { icon: '🔧', title: '組裝', text: '挑身體、大腦，再插卡' },
  { icon: '🃏', title: '卡牌＝打法', text: '流派卡決定它怎麼打' },
  { icon: '📺', title: '開打', text: '它自己打，你在場邊看' },
  { icon: '🏆', title: '變強', text: '贏了拿卡、訓練、上世界榜' },
];

const KINDS: CardKind[] = ['style', 'reflex', 'trait', 'signature'];

function el(tag: string, cls = '', text = ''): HTMLElement {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text) n.textContent = text;
  return n;
}

export interface HubInfo {
  name: string;
  rank: string;
}

type VaultFilter = 'all' | 'have' | 'missing';

export class Menu {
  private title = document.getElementById('title')!;
  private hub = document.getElementById('hub')!;
  private howto = document.getElementById('howto')!;
  private credits = document.getElementById('credits')!;
  private vault = document.getElementById('vault')!;
  private toastEl = document.getElementById('toast')!;
  private toastTimer = 0;
  private gacha: GachaScreen;
  private filter: VaultFilter = 'all';
  /** 大廳上面顯示的選手資料（main 給） */
  info: () => HubInfo = () => ({ name: '', rank: '' });

  constructor(
    private progress: Progress,
    private audio: SoundPlayer,
    private save: () => void,
    onStart: () => void,
    onPick: (mode: Mode) => void,
  ) {
    this.gacha = new GachaScreen(progress, audio, save);
    document.getElementById('supply')!.addEventListener('click', () => {
      const got = claimSupply(this.progress.wallet, dailyDay());
      if (got) {
        this.save();
        this.audio.unlock();
        this.audio.play('rare');
        this.toast(`🎁 每日補給：晶片幣 +${got}`);
      }
      this.refreshHub();
    });
    for (const b of Array.from(document.querySelectorAll<HTMLElement>('#vaultTabs [data-f]')))
      b.addEventListener('click', () => {
        this.filter = b.dataset.f as VaultFilter;
        this.openVault();
      });
    document.getElementById('titleStart')!.addEventListener('click', onStart);
    document.getElementById('titleHow')!.addEventListener('click', () => this.open(this.howto));
    document.getElementById('titleCredits')!.addEventListener('click', () => this.open(this.credits));
    document.getElementById('hubHow')!.addEventListener('click', () => this.open(this.howto));
    document.getElementById('hubHome')!.addEventListener('click', () => this.showTitle());
    for (const close of Array.from(document.querySelectorAll<HTMLElement>('[data-close]')))
      close.addEventListener('click', () => {
        close.closest('.modal')!.classList.add('hidden');
        // 扭蛋、兌換之後回大廳，錢和卡數要更新
        if (this.hubVisible) this.refreshHub();
      });
    for (const m of [this.howto, this.credits, this.vault, document.getElementById('gacha')!])
      m.addEventListener('click', (e) => {
        if (e.target === m) m.classList.add('hidden');
      });

    document.getElementById('version')!.textContent = VERSION_TEXT;
    document.getElementById('howtoSteps')!.replaceChildren(
      ...HOWTO.map((s, i) => {
        const card = el('div', 'step');
        card.append(el('div', 'num', String(i + 1)), el('div', 'icon', s.icon), el('b', '', s.title), el('span', '', s.text));
        return card;
      }),
    );
    document.getElementById('creditList')!.replaceChildren(
      ...CREDITS.map((c) => {
        const row = el('div', 'credit');
        row.append(el('span', 'role', c.role), el('b', '', c.names.join('、')));
        return row;
      }),
    );

    for (const tile of Array.from(document.querySelectorAll<HTMLElement>('#hubTiles [data-go]')))
      tile.addEventListener('click', () => {
        const go = tile.dataset.go!;
        if (go === 'vault') this.openVault();
        else if (go === 'gacha') this.gacha.open();
        else onPick(go as Mode);
      });
  }

  private open(m: HTMLElement): void {
    m.classList.remove('hidden');
  }

  get visible(): boolean {
    return !this.title.classList.contains('hidden') || !this.hub.classList.contains('hidden');
  }

  /** 大廳開著（主迴圈要畫選手預覽） */
  get hubVisible(): boolean {
    return !this.hub.classList.contains('hidden');
  }

  get titleVisible(): boolean {
    return !this.title.classList.contains('hidden');
  }

  showTitle(): void {
    this.hideAll();
    this.title.classList.remove('hidden');
  }

  showHub(): void {
    this.hideAll();
    // 選手預覽只有一個 canvas：在大廳和設定畫面之間搬來搬去
    document.getElementById('hubMe')!.prepend(document.getElementById('lookView')!);
    this.refreshHub();
    this.hub.classList.remove('hidden');
  }

  private refreshHub(): void {
    const info = this.info();
    const w = this.progress.wallet;
    document.getElementById('hubName')!.textContent = info.name;
    document.getElementById('hubRank')!.textContent = info.rank;
    document.getElementById('hubCoins')!.textContent = `🪙 ${w.coins}`;
    document.getElementById('supply')!.classList.toggle('hidden', w.supplyDay === dailyDay());
    const have = CARD_LIST.filter((c) => this.progress.owned.includes(c.id)).length;
    document.getElementById('vaultCount')!.textContent = `${have} / ${CARD_LIST.length}`;
    document.getElementById('gachaCount')!.textContent = `🪙 ${w.coins}`;
  }

  hideAll(): void {
    for (const m of [this.title, this.hub, this.howto, this.credits, this.vault, document.getElementById('gacha')!]) m.classList.add('hidden');
  }

  toast(text: string): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), 2200);
  }

  /** 卡牌倉庫：全部的卡，拿到的亮、沒拿到的是剪影；碎片可以兌換沒拿到的卡 */
  private openVault(keep: string | null = null): void {
    const owned = this.progress.owned;
    const w = this.progress.wallet;
    const detail = document.getElementById('vaultDetail')!;
    document.getElementById('vaultFrags')!.textContent = `💠 碎片 ${w.frags}`;
    for (const b of Array.from(document.querySelectorAll<HTMLElement>('#vaultTabs [data-f]'))) b.classList.toggle('on', b.dataset.f === this.filter);
    const show = (id: string): void => {
      const c = CARDS[id];
      const have = owned.includes(id);
      const r = rarityOf(id);
      const art = artFor(id);
      if (art && !have) art.classList.add('locked');
      const text = el('div', '');
      text.append(el('b', '', have ? c.name : '？？？'), el('span', `kindtag r-${r}`, `${RARITY_STARS[r]} ${RARITY_NAME[r]}`), el('span', 'kindtag', KIND_NAME[c.kind]));
      text.append(el('p', '', have ? c.text : `🔒 ${howToGet(id, PRIZE_FROM)}，或抽扭蛋`));
      if (have) text.append(el('p', 'cost', `出場 ${c.price} 點・代價：${c.cost}`));
      else {
        const cost = CRAFT_COST[r];
        const btn = el('button', 'craft', `💠 ${cost} 兌換`) as HTMLButtonElement;
        btn.disabled = w.frags < cost;
        btn.addEventListener('click', () => {
          if (!craft(id, owned, w)) return;
          this.save();
          this.audio.unlock();
          this.audio.play('rare');
          this.toast(`🎉 兌換成功：${c.name}`);
          this.openVault(id);
        });
        text.append(btn);
      }
      detail.replaceChildren(...(art ? [art] : []), text);
      detail.className = `k-${c.kind}`;
    };
    const box = document.getElementById('vaultGrid')!;
    const out: HTMLElement[] = [];
    for (const kind of KINDS) {
      const all = CARD_LIST.filter((c) => c.kind === kind);
      const list = all.filter((c) => this.filter === 'all' || owned.includes(c.id) === (this.filter === 'have'));
      if (list.length === 0) continue;
      const got = all.filter((c) => owned.includes(c.id)).length;
      out.push(el('div', 'vkind', `${KIND_NAME[kind]}　${got}/${all.length}`));
      const grid = el('div', 'vgrid');
      for (const c of list) {
        const have = owned.includes(c.id);
        const r = rarityOf(c.id);
        const btn = el('button', `vcard k-${kind} r-${r}${have ? '' : ' locked'}`);
        const art = artFor(c.id);
        if (art) btn.append(art);
        else btn.append(el('div', 'noart', have ? '🃏' : '？'));
        btn.append(el('i', 'stars', RARITY_STARS[r]));
        const copies = w.copies[c.id] ?? 1;
        if (have && copies > 1) btn.append(el('em', 'copies', `×${copies}`));
        btn.append(el('span', '', have ? c.name : '？？？'));
        btn.addEventListener('click', () => show(c.id));
        grid.append(btn);
      }
      out.push(grid);
    }
    if (out.length === 0) out.push(el('p', 'hint', this.filter === 'missing' ? '🎉 全部收集完了！' : '還沒有卡'));
    box.replaceChildren(...out);
    if (keep) show(keep);
    else {
      detail.replaceChildren(el('p', 'hint', '點一張卡看說明'));
      detail.className = '';
    }
    this.open(this.vault);
  }
}
