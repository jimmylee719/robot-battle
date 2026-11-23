/**
 * 聯盟的畫面（設定畫面最下面那一區）：登錄守擂機器人、挑戰別人、看排行榜。
 * 伺服器位址預設是同網域的 /api/league；打包時可以用 VITE_LEAGUE_URL 指到別的地方。
 * 連不上伺服器就顯示一行說明，其他功能照常。
 */
import { BRAINS } from '../sim/cards';
import { gearText } from '../sim/gear';
import type { Board, FightResult, PublicEntry } from '../sim/league';
import type { RobotSetup } from '../sim/match';

const TOKEN_KEY = 'prompt-cage.league';
const BASE: string = (import.meta.env.VITE_LEAGUE_URL as string | undefined) ?? '/api/league';

function node(tag: string, cls: string, text = ''): HTMLElement {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text) n.textContent = text;
  return n;
}

/** 這台瀏覽器的密鑰：第一次用的時候隨機產生，之後靠它認出「這是我的守擂機器人」 */
function token(): string {
  try {
    const saved = localStorage.getItem(TOKEN_KEY);
    if (saved && /^[a-z0-9]{16,64}$/.test(saved)) return saved;
  } catch {
    // 讀不到就每次用新的（等於每次都是新玩家）
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const t = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  try {
    localStorage.setItem(TOKEN_KEY, t);
  } catch {
    // 存不了就算了
  }
  return t;
}

/** 被伺服器的用量上限擋下來 */
class Limited extends Error {}

export class League {
  private box = document.getElementById('leagueBox')!;
  private board: Board | null = null;
  private status = '';
  private busy = false;

  constructor(
    /** 現在設定畫面上這台機器人，以及它能不能出場（有沒有超出額度） */
    private current: () => { setup: RobotSetup; legal: boolean },
    private onFight: (r: FightResult) => void,
  ) {}

  private async call(action: string, body: Record<string, unknown>): Promise<unknown> {
    const res = await fetch(`${BASE}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token(), ...body }),
    });
    if (res.status === 429) {
      // 伺服器的用量上限（太頻繁、今天的次數用完）：把原因講給玩家聽
      const why = ((await res.json().catch(() => null)) as { error?: string } | null)?.error;
      throw new Limited(why ?? '請求太頻繁，請稍後再試。');
    }
    if (!res.ok) throw new Error(String(res.status));
    return res.json();
  }

  private async run(job: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await job();
      this.status = '';
    } catch (err) {
      this.status = err instanceof Limited ? err.message : '聯盟伺服器沒有連上。單人模式和每日挑戰不受影響。';
    }
    this.busy = false;
    this.render();
  }

  /** 重新抓排行榜（打開設定畫面時叫） */
  refresh(): void {
    void this.run(async () => {
      this.board = (await this.call('board', {})) as Board;
    });
  }

  private enter(): void {
    const cur = this.current();
    if (!cur.legal) return;
    void this.run(async () => {
      this.board = (await this.call('enter', { setup: cur.setup })) as Board;
    });
  }

  private challenge(id: string): void {
    const cur = this.current();
    if (!cur.legal) return;
    void this.run(async () => {
      const out = (await this.call('fight', { defender: id, setup: cur.setup })) as { result: FightResult; board: Board };
      this.board = out.board;
      this.onFight(out.result);
    });
  }

  private row(e: PublicEntry, rank: number | null, canFight: boolean): HTMLElement {
    const row = node('div', 'lrow' + (this.board?.me?.id === e.id ? ' me' : ''));
    row.append(node('span', 'lrank', rank === null ? '' : `#${rank}`));
    const mid = node('div', 'lmid');
    mid.append(node('b', '', e.name + (e.bot ? '　🤖' : '')));
    mid.append(node('span', '', `${BRAINS[e.brain].name}・${gearText(e.gear)}・${e.wins} 勝 ${e.losses} 敗`));
    row.append(mid);
    row.append(node('span', 'lrate', String(e.rating)));
    if (canFight) {
      const btn = node('button', 'chip', '挑戰') as HTMLButtonElement;
      btn.disabled = this.busy || !this.current().legal;
      btn.addEventListener('click', () => this.challenge(e.id));
      row.append(btn);
    }
    return row;
  }

  render(): void {
    const out: HTMLElement[] = [];
    if (this.status) out.push(node('div', 'hint', this.status));
    const b = this.board;
    if (b) {
      const me = b.me;
      out.push(
        node(
          'div',
          'hint',
          me
            ? `你的守擂機器人「${me.name}」：積分 ${me.rating}・第 ${me.rank} 名（共 ${b.total} 台）・${me.wins} 勝 ${me.losses} 敗。你不在線上時，別人挑戰的就是它。`
            : '把現在這台登錄成你的守擂機器人，就能挑戰別人；你不在線上時，別人也可以來挑戰它。',
        ),
      );
      const enterBtn = node('button', 'chip', me ? '用現在這台換掉守擂機器人' : '登錄我的守擂機器人') as HTMLButtonElement;
      enterBtn.disabled = this.busy || !this.current().legal;
      enterBtn.addEventListener('click', () => this.enter());
      out.push(enterBtn);
      if (me) {
        out.push(node('div', 'kind', '積分和你差不多的對手（用現在設定畫面上這台去打，勝負由伺服器算）'));
        out.push(...b.rivals.map((e) => this.row(e, null, true)));
      }
      out.push(node('div', 'kind', '排行榜'));
      out.push(...b.top.map((e, i) => this.row(e, i + 1, false)));
    } else if (!this.status) out.push(node('div', 'hint', '讀取中…'));
    this.box.replaceChildren(...out);
  }
}
