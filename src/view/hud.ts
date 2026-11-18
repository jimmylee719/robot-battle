/** 疊在畫面上的 DOM 介面：血條、計時、指令清單、橫幅、賽後解讀。 */
import { MATCH_TICKS, TICK_HZ, type Match } from '../sim/match';
import type { Program } from '../sim/interpreter';

function el(id: string): HTMLElement {
  return document.getElementById(id)!;
}

function node(tag: string, cls: string, text = ''): HTMLElement {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text) n.textContent = text;
  return n;
}

/** 身體被迫進入的狀態，蓋過大腦正在執行的指令 */
const FORCED: Partial<Record<string, string>> = {
  stagger: '被打中，硬直',
  down: '被擊倒',
  getup: '爬起來',
  ko: '無法戰鬥',
  win: '勝利',
};

/** 一份「原文 → 機器人的理解」清單。賽中的指令面板和賽後解讀共用。 */
function programList(program: Program): { root: HTMLElement; rows: HTMLElement[]; fallback: HTMLElement } {
  const root = node('div', 'plist');
  const rows = program.rules.map((r, i) => {
    const row = node('div', r.misread ? 'rule bad' : 'rule');
    row.append(node('div', 'src', `${i + 1}「${r.source}」`));
    row.append(node('div', 'und', `${r.misread ? '⚠ ' : '→ '}${r.understood}`));
    if (r.note) row.append(node('div', 'note', `誤解：${r.note}`));
    root.append(row);
    return row;
  });
  const fallback = node('div', 'rule fallback');
  fallback.append(node('div', 'und', '（沒有符合的指令）'));
  root.append(fallback);
  for (const g of program.ignored) {
    const row = node('div', 'rule ignored');
    row.append(node('div', 'src', `✕「${g.source}」`));
    row.append(node('div', 'note', g.reason));
    root.append(row);
  }
  return { root, rows, fallback };
}

export class Hud {
  private hp = [el('hp0'), el('hp1')];
  private hpLag = [el('lag0'), el('lag1')];
  private poise = [el('po0'), el('po1')];
  private act = [el('act0'), el('act1')];
  private names = [el('n0'), el('n1')];
  private timer = el('timer');
  private bannerEl = el('banner');
  private rulesEl = el('rules');
  private resultEl = el('result');
  private bannerLeft = 0;
  private rows: HTMLElement[] = [];
  private fallback: HTMLElement | null = null;
  private activeRow: HTMLElement | null = null;
  private resultTimer = 0;

  reset(m: Match): void {
    m.robots.forEach((r, i) => (this.names[i].textContent = `${r.spec.name} · ${m.brains[i].program.tier.name}`));
    this.bannerEl.textContent = '';
    this.bannerLeft = 0;
    window.clearTimeout(this.resultTimer);
    this.resultEl.classList.add('hidden');

    // 玩家的指令清單
    const program = m.brains[0].program;
    const list = programList(program);
    this.rows = list.rows;
    this.fallback = list.fallback;
    this.activeRow = null;
    this.rulesEl.replaceChildren(node('div', 'ptitle', `你的機器人（${program.tier.name}）是這樣理解的`), list.root);
    this.update(m, 0);
  }

  showRules(show: boolean): void {
    this.rulesEl.classList.toggle('hidden', !show);
  }

  banner(text: string, seconds: number, cls = ''): void {
    this.bannerEl.textContent = text;
    this.bannerEl.className = cls;
    // 重新觸發進場動畫
    void this.bannerEl.offsetWidth;
    this.bannerEl.classList.add('pop');
    this.bannerLeft = seconds;
  }

  /** 比賽結束：先跳 K.O. 橫幅，過一下再攤開兩邊的 prompt 和解讀 */
  showResult(m: Match): void {
    this.banner(m.robots.some((r) => r.action === 'ko') ? 'K.O.' : 'TIME UP', 2.2, 'gold');
    const title = m.winner === -1 || m.winner === null ? '平手' : m.winner === 0 ? '你贏了' : '你輸了';
    const cols = el('resultCols');
    cols.replaceChildren(
      ...m.robots.map((r, i) => {
        const program = m.brains[i].program;
        const col = node('div', i === 0 ? 'col red' : 'col blue');
        col.append(node('div', 'name', `${r.spec.name} · ${program.tier.name}`));
        col.append(node('div', 'prompt', program.prompt || '（沒有寫指令）'));
        col.append(programList(program).root);
        return col;
      }),
    );
    el('resultTitle').textContent = title;
    el('resultTitle').className = m.winner === 0 ? 'win' : m.winner === 1 ? 'lose' : '';
    this.resultTimer = window.setTimeout(() => this.resultEl.classList.remove('hidden'), 2400);
  }

  update(m: Match, dt: number): void {
    m.robots.forEach((r, i) => {
      const hp = (r.hp / r.spec.maxHp) * 100;
      this.hp[i].style.width = `${hp}%`;
      this.hpLag[i].style.width = `${hp}%`;
      this.poise[i].style.width = `${Math.max(0, r.poise / r.spec.maxPoise) * 100}%`;
      this.act[i].textContent = `▶ ${FORCED[r.action] ?? r.label}`;
    });

    // 標出玩家的機器人正在執行哪一條
    const me = m.robots[0];
    const row = m.phase === 'fight' ? (me.ruleIndex >= 0 ? this.rows[me.ruleIndex] : this.fallback) : null;
    if (row !== this.activeRow) {
      this.activeRow?.classList.remove('active');
      row?.classList.add('active');
      this.activeRow = row ?? null;
    }
    if (this.fallback) this.fallback.firstElementChild!.textContent = `（沒有符合的指令）→ ${me.ruleIndex < 0 ? me.label : '…'}`;

    const left = Math.max(0, MATCH_TICKS - m.fightTicks);
    this.timer.textContent = String(Math.ceil(left / TICK_HZ));
    if (this.bannerLeft > 0) {
      this.bannerLeft -= dt;
      if (this.bannerLeft <= 0) this.bannerEl.textContent = '';
    }
  }
}
