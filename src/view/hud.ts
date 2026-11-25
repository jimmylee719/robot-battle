/** 疊在畫面上的 DOM 介面：血條、計時、大腦卡槽、橫幅、賽後解讀。 */
import { ROUND_TICKS, ROUNDS, TICK_HZ, type Match } from '../sim/match';
import { JUDGES, VERDICT_TEXT } from '../sim/judges';
import { CARDS, FREESTYLE_ID, KIND_NAME, type Program } from '../sim/cards';
import { gearText } from '../sim/gear';
import { seconds, tacticChip } from './setup';
import { beats, type Tactic } from '../sim/tactics';

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
  tko: '裁判中止比賽',
  win: '勝利',
};

interface ProgramList {
  root: HTMLElement;
  /** 規則編號 → 那張卡的整塊、那條規則的那一行 */
  cardOf: HTMLElement[];
  lineOf: HTMLElement[];
}

/** 一顆大腦裡的卡，以及大腦對每張卡的理解。賽中的卡槽面板和賽後解讀共用。 */
function programList(program: Program, quirkHits: Record<string, number> = {}): ProgramList {
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
    if (note) block.append(node('div', 'note', `⚠ ${note}${quirkHits[id] !== undefined ? `（本場觸發 ${quirkHits[id]} 次）` : ''}`));
    root.append(block);
  }
  return { root, cardOf, lineOf };
}

function brainLine(program: Program): string {
  // 自訓模型沒有單一的準確率，每個動作各看熟練度
  const acc = program.prof ? '每個動作各看熟練度' : `準確率 ${Math.round(program.accuracy * 100)}%`;
  return `${program.brain.name}・${acc}・反應 ${seconds(program.reaction)}`;
}

export class Hud {
  private hp = [el('hp0'), el('hp1')];
  private hpLag = [el('lag0'), el('lag1')];
  private poise = [el('po0'), el('po1')];
  private energy = [el('en0'), el('en1')];
  private act = [el('act0'), el('act1')];
  private names = [el('n0'), el('n1')];
  private timer = el('timer');
  private bannerEl = el('banner');
  private rulesEl = el('rules');
  private resultEl = el('result');
  private captionEl = el('caption');
  private bannerLeft = 0;
  private list: ProgramList | null = null;
  private activeCard: HTMLElement | null = null;
  private activeLine: HTMLElement | null = null;
  private fumbleEl = node('div', 'fumble');
  private resultTimer = 0;
  /** 在看別人分享的重播：結果寫「誰獲勝」而不是「你贏了」 */
  spectate = false;
  private tapeEl = el('tape');
  private tacEls = [el('tac0'), el('tac1')];
  private tacLine = el('tacLine');
  private tacLeft = 0;
  /** 開打前的對照表上，兩邊名字下面那一行（戰績、排名）。main 在開打前填。 */
  tapeLines: [string, string] = ['', ''];
  /** 雙方正在出的包（失誤演出給的，空字串 = 沒有） */
  misfire: [string, string] = ['', ''];
  /** 賽後解讀用：每一方、每張卡的固定毛病本場觸發了幾次 */
  quirkHits: Record<string, number>[] = [{}, {}];

  reset(m: Match): void {
    m.robots.forEach((r, i) => (this.names[i].textContent = `${r.spec.name} · ${m.brains[i].program.brain.name}`));
    this.bannerEl.textContent = '';
    this.bannerLeft = 0;
    this.tacLeft = 0;
    this.tacLine.classList.add('hidden');
    this.tactics([m.robots[0].tactic, m.robots[1].tactic], false);
    window.clearTimeout(this.resultTimer);
    this.resultEl.classList.add('hidden');
    this.hideRoundCard();

    // 玩家的大腦卡槽
    const program = m.brains[0].program;
    this.list = programList(program);
    this.activeCard = null;
    this.activeLine = null;
    this.rulesEl.replaceChildren(node('div', 'ptitle', brainLine(program)), this.list.root, this.fumbleEl);

    // 開打前的雙方對照表：名字、戰績、大腦、裝備、流派
    Array.from(this.tapeEl.querySelectorAll('.side')).forEach((side, i) => {
      const p = m.brains[i].program;
      const style = p.deck.find((c) => CARDS[c]?.kind === 'style');
      side.replaceChildren(
        node('b', '', m.robots[i].spec.name),
        node('i', '', this.tapeLines[i]),
        node('div', '', `大腦　${p.brain.name}`),
        node('div', '', gearText(m.robots[i].spec.loadout)),
        node('div', '', `流派　${style ? CARDS[style].name : '沒有'}`),
      );
    });
    this.replay(false);
    this.update(m, 0);
  }

  /**
   * 這回合兩邊的戰術：名字下面的小標籤；announce 的話在畫面中間打出「誰剋誰」。
   */
  tactics(t: [Tactic, Tactic], announce = true): void {
    t.forEach((x, i) => {
      const edge = beats(x, t[1 - i]);
      this.tacEls[i].replaceChildren(tacticChip(x, edge ? 'edge' : ''));
    });
    if (!announce) return;
    const line: HTMLElement[] = [tacticChip(t[0])];
    if (beats(t[0], t[1])) line.push(node('b', 'win', '剋'));
    else if (beats(t[1], t[0])) line.push(node('b', 'lose', '被剋'));
    else line.push(node('b', '', 'vs'));
    line.push(tacticChip(t[1]));
    this.tacLine.replaceChildren(...line);
    this.tacLine.classList.remove('hidden');
    this.tacLeft = 2.6;
  }

  /** 主持人轉播的字幕。text 空的就收起來。 */
  caption(who: string, text: string): void {
    this.captionEl.classList.toggle('hidden', text === '');
    this.captionEl.classList.toggle('pundit', who === '球評');
    el('capWho').textContent = who ? `🎙 ${who}` : '';
    el('capText').textContent = text;
  }

  showRules(show: boolean): void {
    this.rulesEl.classList.toggle('hidden', !show);
  }

  /** 回合開始的 FIGHT! / ROUND N 還在畫面上（失誤對話框要等它消失） */
  get opening(): boolean {
    return this.bannerLeft > 0 && /^(FIGHT!|ROUND \d+)$/.test(this.bannerEl.textContent ?? '');
  }

  banner(text: string, seconds: number, cls = ''): void {
    this.bannerEl.textContent = text;
    this.bannerEl.className = cls;
    // 重新觸發進場動畫
    void this.bannerEl.offsetWidth;
    this.bannerEl.classList.add('pop');
    this.bannerLeft = seconds;
  }

  /** 賽後成長：性格往哪邊漂、自訓模型哪些動作進步了。lines 空的就不顯示。 */
  /** 賽後的成長紀錄：前幾行直接看，其他收進「更多」 */
  showGrowth(lines: string[]): void {
    const SHOW = 4;
    const out = lines.slice(0, SHOW).map((l) => node('div', '', l));
    if (lines.length > SHOW) {
      const more = node('details', 'more');
      more.append(node('summary', '', `更多（${lines.length - SHOW}）`), ...lines.slice(SHOW).map((l) => node('div', '', l)));
      out.push(more);
    }
    el('growth').replaceChildren(...out);
  }

  /** K.O. 慢動作重播的標籤 */
  replay(on: boolean): void {
    el('replayTag').classList.toggle('hidden', !on);
  }

  /** 過 delayMs 之後把賽後畫面攤開（showResult 只是先準備好內容） */
  openResult(delayMs: number): void {
    window.clearTimeout(this.resultTimer);
    this.resultTimer = window.setTimeout(() => this.resultEl.classList.remove('hidden'), delayMs);
  }

  /** 局間休息：這一回合兩邊的數據（像轉播在回合之間打出來的那張表） */
  showRoundCard(m: Match): void {
    const st = m.stats[m.stats.length - 1];
    const rows: [string, string, string][] = [
      ['打中', String(st[0].landed), String(st[1].landed)],
      ['出手', String(st[0].thrown), String(st[1].thrown)],
      ['擊倒', String(st[0].knockdowns), String(st[1].knockdowns)],
      ['傷害', String(Math.round(st[0].damage)), String(Math.round(st[1].damage))],
    ];
    const box = el('roundCard');
    box.replaceChildren(
      node('div', 'rc-title', `第 ${m.round} 回合結束`),
      ...rows.map(([k, a, b]) => {
        const row = node('div', 'rc-row');
        const na = Number(a);
        const nb = Number(b);
        row.append(node('span', 'red' + (na > nb ? ' lead' : ''), a), node('span', 'rc-k', k), node('span', 'blue' + (nb > na ? ' lead' : ''), b));
        return row;
      }),
      node('div', 'rc-note', '裁判的分數要打完才公布'),
    );
    box.classList.remove('hidden');
  }

  hideRoundCard(): void {
    el('roundCard').classList.add('hidden');
  }

  /** 比賽怎麼結束的：「K.O.・第 2 回合 0:13」「一致判定 30-27、30-27、29-28」 */
  static methodText(m: Match): string {
    const t = m.roundTicks / TICK_HZ;
    const at = `第 ${m.round} 回合 ${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
    if (m.method === 'KO') return `K.O.・${at}`;
    if (m.method === 'TKO') return `TKO（裁判中止）・${at}`;
    if (m.decision) {
      const cards = m.decision.totals.map(([a, b]) => (m.decision!.winner === 1 ? `${b}-${a}` : `${a}-${b}`)).join('、');
      return `${VERDICT_TEXT[m.decision.verdict]}　${cards}`;
    }
    return '雙方同時倒下・平手';
  }

  /** 比賽結束：先跳橫幅，並把兩邊的卡組和大腦的理解準備好（什麼時候攤開由 main 決定） */
  showResult(m: Match): void {
    this.hideRoundCard();
    this.banner(m.method === 'KO' ? 'K.O.' : m.method === 'TKO' ? 'T.K.O.' : 'DECISION', 2.2, 'gold');
    const draw = m.winner === -1 || m.winner === null;
    const title = draw
      ? '平手'
      : this.spectate
        ? `${m.robots[m.winner!].spec.name} 獲勝`
        : m.winner === 0
          ? '你贏了'
          : '你輸了';
    el('resultCols').replaceChildren(
      ...m.robots.map((r, i) => {
        const program = m.brains[i].program;
        const col = node('div', i === 0 ? 'col red' : 'col blue');
        col.append(node('div', 'name', r.spec.name));
        col.append(node('div', 'gearline', gearText(r.spec.loadout)));
        col.append(node('div', 'ptitle', brainLine(program)));
        // 有固定毛病的卡都標出本場觸發幾次（0 次也標）
        const hits: Record<string, number> = {};
        for (const id of Object.keys(program.notes)) hits[id] = this.quirkHits[i]?.[id] ?? 0;
        col.append(programList(program, hits).root);
        return col;
      }),
    );
    el('resultTitle').textContent = title;
    el('resultMethod').textContent = Hud.methodText(m);
    // 計分卡：每位裁判每回合給幾分（KO / TKO 也看得到打到那一刻的分數）
    const sheet = el('scorecard');
    if (m.cards.length === 0) sheet.replaceChildren();
    else {
      const head = node('div', 'sc-row sc-head');
      head.append(node('span', '', ''), ...m.cards.map((_, i) => node('span', '', `R${i + 1}`)), node('span', '', '合計'));
      sheet.replaceChildren(
        head,
        ...JUDGES.map((j, ji) => {
          const row = node('div', 'sc-row');
          let ta = 0;
          let tb = 0;
          row.append(node('span', 'sc-j', j.name));
          for (const round of m.cards) {
            const [a, b] = round[ji];
            ta += a;
            tb += b;
            row.append(node('span', a > b ? 'red' : b > a ? 'blue' : '', `${a}-${b}`));
          }
          row.append(node('span', 'sc-t', `${ta}-${tb}`));
          return row;
        }),
      );
    }
    el('resultTitle').className = this.spectate ? 'win' : m.winner === 0 ? 'win' : m.winner === 1 ? 'lose' : '';
  }

  update(m: Match, dt: number): void {
    if (this.tacLeft > 0) {
      this.tacLeft -= dt;
      if (this.tacLeft <= 0) this.tacLine.classList.add('hidden');
    }
    m.robots.forEach((r, i) => {
      const hp = (r.hp / r.spec.maxHp) * 100;
      this.hp[i].style.width = `${hp}%`;
      this.hpLag[i].style.width = `${hp}%`;
      this.poise[i].style.width = `${Math.max(0, r.poise / r.spec.maxPoise) * 100}%`;
      this.energy[i].style.width = `${Math.max(0, r.energy / r.spec.maxEnergy) * 100}%`;
      this.energy[i].classList.toggle('out', r.gassed);
      const doing = FORCED[r.action] ?? (r.gassed ? '沒電了，只能防守' : r.fumbling ? `聽錯了：${r.label}` : r.label);
      this.act[i].textContent = `▶ ${doing}`;
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
    // 雙方的失誤都顯示：自己的在上、對手的在下
    const [mine, theirs] = this.misfire;
    this.fumbleEl.replaceChildren(
      ...(mine ? [node('div', '', `⚠ ${mine}`)] : []),
      ...(theirs ? [node('div', 'foe', `⚠ 對手${theirs}`)] : []),
    );
    this.rulesEl.classList.toggle('fumbling', mine !== '');

    // 對照表只在倒數的時候出現
    // 對照表只在開頭顯示：之後兩台走到場中間碰拳，不要擋住
    this.tapeEl.classList.toggle('hidden', !(m.phase === 'intro' && m.tick > 0 && m.phaseTicks < 58));

    // 回合計時：R1 0:20
    const left = m.phase === 'break' ? ROUND_TICKS : Math.max(0, ROUND_TICKS - m.roundTicks);
    const sec = Math.ceil(left / TICK_HZ);
    this.timer.textContent = `R${m.round}/${ROUNDS}  ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
    this.timer.classList.toggle('last', m.phase === 'fight' && left <= 5 * TICK_HZ);
    if (this.bannerLeft > 0) {
      this.bannerLeft -= dt;
      if (this.bannerLeft <= 0) this.bannerEl.textContent = '';
    }
  }
}
