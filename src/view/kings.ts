/**
 * 格鬥王排行榜：聯盟（對戰世界）的全球積分榜，第一名就是現任「格鬥王」。
 * 只讀伺服器的排行榜（board），挑戰還是回對戰世界打。純畫面。
 * 段位照積分分：鐵 → 銅 → 銀 → 金 → 白金 → 鑽石 → 大師，第一名另外戴王冠。
 */
import { BRAINS, CARDS } from '../sim/cards';
import type { Board, PublicEntry } from '../sim/league';
import { BLUE_TEAM, RED_TEAM } from '../models/robot';
import { fetchBoard } from './league';
import { portrait } from './preview';

export interface Tier {
  min: number;
  icon: string;
  name: string;
}

export const TIERS: Tier[] = [
  { min: -Infinity, icon: '🔩', name: '鐵' },
  { min: 900, icon: '🥉', name: '銅' },
  { min: 1000, icon: '🥈', name: '銀' },
  { min: 1100, icon: '🥇', name: '金' },
  { min: 1200, icon: '💠', name: '白金' },
  { min: 1350, icon: '💎', name: '鑽石' },
  { min: 1500, icon: '🔥', name: '大師' },
];

export function tierOf(rating: number): Tier {
  let t = TIERS[0];
  for (const x of TIERS) if (rating >= x.min) t = x;
  return t;
}

function node(tag: string, cls: string, text = ''): HTMLElement {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text) n.textContent = text;
  return n;
}

function styleName(e: PublicEntry): string {
  return e.style && CARDS[e.style] ? CARDS[e.style].name : '自由搏擊';
}

export class KingsScreen {
  private scr = document.getElementById('kingScr')!;
  private body = document.getElementById('kBody')!;
  private board: Board | null = null;
  /** 現任格鬥王的名字（大廳的格子上顯示） */
  champ = '';

  constructor(private onChallenge: () => void, private onChamp: () => void) {
    document.getElementById('kGo')!.addEventListener('click', () => {
      this.scr.classList.add('hidden');
      this.onChallenge();
    });
    this.scr.addEventListener('click', (e) => {
      if (e.target === this.scr) this.scr.classList.add('hidden');
    });
  }

  open(): void {
    this.scr.classList.remove('hidden');
    if (!this.board) this.body.replaceChildren(node('div', 'hint', '讀取中…'));
    else this.render();
    fetchBoard()
      .then((b) => {
        this.board = b;
        this.champ = b.top[0]?.name ?? '';
        this.onChamp();
        this.render();
      })
      .catch(() => {
        if (!this.board) this.body.replaceChildren(node('div', 'hint', '排行榜伺服器沒有連上，等一下再來看看。單人模式不受影響。'));
      });
  }

  private podium(e: PublicEntry, place: number): HTMLElement {
    const col = node('div', `kPod p${place}`);
    col.append(node('div', 'kMedal', place === 1 ? '👑' : place === 2 ? '🥈' : '🥉'));
    col.append(portrait(e.gear, e.look, place === 1 ? RED_TEAM : BLUE_TEAM));
    col.append(node('b', '', e.name));
    const t = tierOf(e.rating);
    col.append(node('span', 'kTier', place === 1 ? '格鬥王' : `${t.icon} ${t.name}`));
    col.append(node('span', 'kRate', String(e.rating)));
    col.append(node('small', '', `${styleName(e)}・${e.wins} 勝 ${e.losses} 敗`));
    col.dataset.tip = `${e.name}\n大腦：${BRAINS[e.brain].name}\n流派：${styleName(e)}`;
    if (this.board?.me?.id === e.id) col.classList.add('me');
    const stand = node('div', 'kStand', String(place));
    const wrap = node('div', 'kCol');
    wrap.append(col, stand);
    return wrap;
  }

  private row(e: PublicEntry, rank: number): HTMLElement {
    const row = node('div', 'kRow' + (this.board?.me?.id === e.id ? ' me' : ''));
    row.append(node('span', 'kNo', `#${rank}`));
    row.append(portrait(e.gear, e.look, BLUE_TEAM));
    const mid = node('div', 'kMid');
    mid.append(node('b', '', e.name + (e.bot ? ' 🤖' : '')));
    mid.append(node('span', '', `${styleName(e)}・${BRAINS[e.brain].name}・${e.wins}勝${e.losses}敗`));
    row.append(mid);
    const t = tierOf(e.rating);
    row.append(node('span', 'kBadge', `${t.icon}${t.name}`));
    row.append(node('span', 'kRate', String(e.rating)));
    return row;
  }

  private mine(b: Board): HTMLElement {
    const box = node('div', 'kMe');
    const me = b.me;
    if (!me) {
      box.append(node('b', '', '你還沒上榜'));
      box.append(node('span', '', '到「對戰世界」登錄一台守擂機器人，打贏別人就會往上爬。'));
      return box;
    }
    const t = tierOf(me.rating);
    const next = TIERS[TIERS.indexOf(t) + 1];
    box.append(node('b', '', me.rank === 1 ? `👑 你就是現任格鬥王！` : `你的「${me.name}」：第 ${me.rank} 名／${b.total} 台`));
    box.append(node('span', '', `${t.icon} ${t.name}・積分 ${me.rating}・${me.wins} 勝 ${me.losses} 敗`));
    if (me.rank !== 1) {
      const bar = node('div', 'kBar');
      const lo = Number.isFinite(t.min) ? t.min : 800;
      const hi = next ? next.min : (b.top[0]?.rating ?? me.rating) + 1;
      const fill = node('i', '');
      fill.style.width = `${Math.max(4, Math.min(100, ((me.rating - lo) / Math.max(1, hi - lo)) * 100))}%`;
      bar.append(fill);
      box.append(bar);
      const gap = (b.top[0]?.rating ?? me.rating) - me.rating;
      box.append(
        node('small', '', next ? `再 ${next.min - me.rating} 分升「${next.icon} ${next.name}」・離格鬥王還差 ${gap} 分` : `離格鬥王還差 ${gap} 分，去把王冠搶過來！`),
      );
    }
    return box;
  }

  private render(): void {
    const b = this.board;
    if (!b) return;
    const out: HTMLElement[] = [];
    out.push(this.mine(b));
    const top = b.top;
    if (top.length) {
      const pod = node('div', 'kPodium');
      // 頒獎台排成 2・1・3
      for (const i of [1, 0, 2]) if (top[i]) pod.append(this.podium(top[i], i + 1));
      out.push(pod);
    }
    const list = node('div', 'kList');
    top.slice(3).forEach((e, i) => list.append(this.row(e, i + 4)));
    out.push(list);
    out.push(node('div', 'hint', '段位：🔩鐵・🥉銅 900・🥈銀 1000・🥇金 1100・💠白金 1200・💎鑽石 1350・🔥大師 1500；第一名戴王冠。'));
    this.body.replaceChildren(...out);
  }
}
