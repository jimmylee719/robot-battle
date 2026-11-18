/** 疊在畫面上的 DOM 介面：血條、計時、大腦卡槽、橫幅、賽後解讀。 */
import { MATCH_TICKS, TICK_HZ, type Match } from '../sim/match';
import { CARDS, FREESTYLE_ID, KIND_NAME, type Program } from '../sim/cards';
import { seconds } from './setup';

function el(id: string): HTMLElement {
  return document.getElementById(id)!;
}

function node(tag: string, cls: string, text = ''): HTMLElement {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text) n.textContent = text;
  return n;
}

/** 身體被迫進入的狀態，蓋過大腦正在執行的規則 */
const FORCED: Partial<Record<string, string>> = {
  stagger: '被打中，硬直',
  down: '被擊倒',
  getup: '爬起來',
  ko: '無法戰鬥',
  win: '勝利',
};

interface ProgramList {
  root: HTMLElement;
  /** 規則編號 → 那張卡的整塊、那條規則的那一行 */
  cardOf: HTMLElement[];
  lineOf: HTMLElement[];
}

/** 一顆大腦裡的卡，以及大腦對每張卡的理解。賽中的卡槽面板和賽後解讀共用。 */
function programList(program: Program): ProgramList {
  const root = node('div', 'plist');
  const cardOf: HTMLElement[] = [];
  const lineOf: HTMLElement[] = [];
  const ids = [...program.deck];
  if (program.rules.some((r) => r.card === FREESTYLE_ID)) ids.push(FREESTYLE_ID);

  for (const id of ids) {
    const card = CARDS[id];
    const note = program.notes[id];
    const block = node('div', note ? 'rule bad' : 'rule');
    const title = node('div', 'src');
    title.append(node('span', `tag k-${card?.kind ?? 'none'}`, card ? KIND_NAME[card.kind] : '本能'));
    title.append(document.createTextNode(card ? card.name : '沒有流派'));
    block.append(title);
    program.rules.forEach((r, i) => {
      if (r.card !== id) return;
      const line = node('div', 'und', `→ ${r.understood}`);
      block.append(line);
      cardOf[i] = block;
      lineOf[i] = line;
    });
    if (card && card.rules.length === 0) block.append(node('div', 'und', `→ ${card.text}`));
    if (note) block.append(node('div', 'note', `⚠ ${note}`));
    root.append(block);
  }
  return { root, cardOf, lineOf };
}

function brainLine(program: Program): string {
  return `${program.brain.name}・準確率 ${Math.round(program.accuracy * 100)}%・反應 ${seconds(program.reaction)}`;
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
  private list: ProgramList | null = null;
  private activeCard: HTMLElement | null = null;
  private activeLine: HTMLElement | null = null;
  private fumbleEl = node('div', 'fumble');
  private resultTimer = 0;

  reset(m: Match): void {
    m.robots.forEach((r, i) => (this.names[i].textContent = `${r.spec.name} · ${m.brains[i].program.brain.name}`));
    this.bannerEl.textContent = '';
    this.bannerLeft = 0;
    window.clearTimeout(this.resultTimer);
    this.resultEl.classList.add('hidden');

    // 玩家的大腦卡槽
    const program = m.brains[0].program;
    this.list = programList(program);
    this.activeCard = null;
    this.activeLine = null;
    this.rulesEl.replaceChildren(node('div', 'ptitle', brainLine(program)), this.list.root, this.fumbleEl);
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

  /** 比賽結束：先跳 K.O. 橫幅，過一下再攤開兩邊的卡組和大腦的理解 */
  showResult(m: Match): void {
    this.banner(m.robots.some((r) => r.action === 'ko') ? 'K.O.' : 'TIME UP', 2.2, 'gold');
    const title = m.winner === -1 || m.winner === null ? '平手' : m.winner === 0 ? '你贏了' : '你輸了';
    el('resultCols').replaceChildren(
      ...m.robots.map((r, i) => {
        const program = m.brains[i].program;
        const col = node('div', i === 0 ? 'col red' : 'col blue');
        col.append(node('div', 'name', r.spec.name));
        col.append(node('div', 'ptitle', brainLine(program)));
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
      this.act[i].textContent = `▶ ${FORCED[r.action] ?? (r.fumbling ? `聽錯了：${r.label}` : r.label)}`;
    });

    // 標出玩家的大腦正在用哪張卡、哪一條
    const me = m.robots[0];
    const on = m.phase === 'fight' && me.ruleIndex >= 0 && this.list !== null;
    const card = on ? this.list!.cardOf[me.ruleIndex] : null;
    const line = on ? this.list!.lineOf[me.ruleIndex] : null;
    if (card !== this.activeCard) {
      this.activeCard?.classList.remove('active');
      card?.classList.add('active');
      this.activeCard = card ?? null;
    }
    if (line !== this.activeLine) {
      this.activeLine?.classList.remove('now');
      line?.classList.add('now');
      this.activeLine = line ?? null;
    }
    const fumbling = m.phase === 'fight' && me.fumbling;
    this.fumbleEl.textContent = fumbling ? `⚠ 聽錯了 → ${me.label}` : '';
    this.rulesEl.classList.toggle('fumbling', fumbling);

    const left = Math.max(0, MATCH_TICKS - m.fightTicks);
    this.timer.textContent = String(Math.ceil(left / TICK_HZ));
    if (this.bannerLeft > 0) {
      this.bannerLeft -= dt;
      if (this.bannerLeft <= 0) this.bannerEl.textContent = '';
    }
  }
}
