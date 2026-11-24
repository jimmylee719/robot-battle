/**
 * 生涯模式畫面（純畫面）。規則在 sim/career.ts。
 * 文字精簡：上面一排數字（級別、週、名次、人氣、戰績），經紀人一句話，最新一則新聞；
 * 下面是排名表和這週的邀約卡。完整說明放 data-tip（點一下看）。
 */
import { BRAINS } from '../sim/cards';
import { DIVISIONS, fighterSetup, myRank, newCareer, OFFER_NAME, offers, type Career, type Offer } from '../sim/career';
import { gearText } from '../sim/gear';
import { decline, demandText, MISSES_TO_DROP, quit, sign, slots, SPONSOR, type Sponsor } from '../sim/sponsor';
import type { Progress } from './save';

function el(tag: string, cls = '', text = ''): HTMLElement {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text) n.textContent = text;
  return n;
}

function tip(n: HTMLElement, ...lines: string[]): void {
  n.dataset.tip = JSON.stringify(lines.filter(Boolean));
}

/** 經紀人：一句話，看情況說 */
const BOSS = '🔧';
const BOSS_NAME = '經紀人阿扳';

export class CareerScreen {
  private root = document.getElementById('careerScr')!;
  private picked = 0;
  /** 現在看的是比賽（排名表＋邀約）還是贊助商 */
  private view: 'fights' | 'sponsors' = 'fights';
  /** 上一場的結果（經紀人講話用）：true 贏、false 輸、null 還沒打 */
  last: boolean | null = null;

  constructor(
    private progress: Progress,
    private save: () => void,
    /** 去整備（改裝廠），帶著這週接的比賽 */
    private onGarage: (o: Offer) => void,
    /** 開打 */
    private onFight: (o: Offer) => void,
    /** 現在的機器人在不在這一級的額度內 */
    private fits: (cap: number) => boolean,
    /** 開新生涯的種子（畫面可以用 Math.random） */
    private freshSeed: () => number,
    private myName: () => string,
  ) {
    document.getElementById('cGarage')!.addEventListener('click', () => {
      const o = this.offer;
      if (o) this.onGarage(o);
    });
    document.getElementById('cGo')!.addEventListener('click', () => {
      const o = this.offer;
      if (o) this.onFight(o);
    });
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.hide();
    });
    // 說明泡泡：和設定畫面共用 #tipBox
    const tipBox = document.getElementById('tipBox')!;
    let timer = 0;
    this.root.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-tip]');
      if (!t) return;
      const [title, ...lines] = JSON.parse(t.dataset.tip!) as string[];
      tipBox.replaceChildren(el('b', '', title), ...lines.map((l) => el('div', '', l)));
      tipBox.classList.add('show');
      clearTimeout(timer);
      timer = window.setTimeout(() => tipBox.classList.remove('show'), 5000);
    });
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  get career(): Career | null {
    return this.progress.career;
  }

  /** 現在選的邀約 */
  get offer(): Offer | null {
    const c = this.career;
    if (!c) return null;
    const list = offers(c);
    return list[Math.min(this.picked, list.length - 1)] ?? null;
  }

  open(): void {
    this.picked = 0;
    this.view = 'fights';
    this.render();
    this.root.classList.remove('hidden');
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  private render(): void {
    const c = this.career;
    const body = document.getElementById('cBody')!;
    const top = document.getElementById('cTop')!;
    const foot = document.getElementById('cFoot')!;
    if (!c) {
      // 還沒開始：一張開場卡
      top.replaceChildren();
      this.say('我是你的經紀人阿扳。從車庫打到世界冠軍，要不要試試？');
      document.getElementById('cNews')!.replaceChildren();
      const intro = el('div', 'cIntro');
      for (const [i, d] of DIVISIONS.entries()) {
        const step = el('div', 'cStep');
        step.append(el('i', '', d.icon), el('b', '', d.name), el('span', '', `💰 ${d.cap}`));
        tip(step, `${i + 1}. ${d.name}`, `出場額度上限 ${d.cap}（你和對手都一樣）`, `基本出場費 🪙${d.purse}`);
        intro.append(step);
      }
      const go = el('button', 'big', '🌟 開始生涯') as HTMLButtonElement;
      go.addEventListener('click', () => {
        this.progress.career = newCareer(this.freshSeed());
        this.save();
        this.last = null;
        this.open();
      });
      body.replaceChildren(intro, go);
      foot.classList.add('intro');
      return;
    }
    foot.classList.remove('intro');
    const div = DIVISIONS[c.div];
    const rank = myRank(c);
    const champ = c.defenses >= 0;

    // 上面一排：級別、第幾週、名次、人氣、戰績、額度
    const chip = (text: string, ...t: string[]): HTMLElement => {
      const n = el('span', 'cChip', text);
      tip(n, ...t);
      return n;
    };
    top.replaceChildren(
      chip(`${div.icon} ${div.name}`, div.name, `第 ${c.div + 1} 級（共 ${DIVISIONS.length} 級）`, '拿下這一級的冠軍腰帶就升級'),
      chip(`📅 第 ${c.week} 週`, '第幾週', '每打一場就是一週'),
      chip(champ ? `👑 冠軍・衛冕 ${c.defenses}` : rank > c.table.length - 1 ? '🌱 新人' : `🏅 第 ${rank} 名`, '名次', '打贏排名比你高的，就搶走他的名次；輸了掉一名'),
      chip(`👥 ${c.fans}`, '人氣', '贏、K.O.、打敗宿敵都會漲', `出場費多 ${Math.round(c.fans / 10)}%`),
      chip(`${c.w}勝${c.l}敗・💥${c.ko}`, '戰績', `K.O./TKO ${c.ko} 場`),
      chip(`💰 ${div.cap}`, '這一級的出場額度', `裝備、大腦、卡加起來不能超過 ${div.cap}`, '升級之後上限會變高'),
    );
    // 贊助商：一顆按鈕，有新邀約時會跳
    const sp = c.sp;
    const spBtn = el('span', 'cChip sp' + (sp.pending.length ? ' mail' : ''), `🤝 ${sp.contracts.length}/${slots(c.div)}${sp.pending.length ? ` 📨${sp.pending.length}` : ''}`);
    spBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.view = this.view === 'sponsors' ? 'fights' : 'sponsors';
      this.render();
    });
    top.append(spBtn);

    // 經紀人一句話
    const list = offers(c);
    const fit = this.fits(div.cap);
    const rival = c.rival ? c.table.find((f) => f.id === c.rival) : null;
    this.say(
      this.view === 'sponsors'
        ? sp.pending.length
          ? '有人想贊助你！簽約先拿簽約金，之後每場做到條件就再付一次。連續兩場沒做到就會被解約。'
          : sp.contracts.length
            ? '贊助商都盯著你的每一場。條件寫在合約上，別讓他們失望。'
            : '還沒有贊助商注意到你。打出成績、累積人氣，他們就會來信。'
        : !fit
        ? `這一級額度上限 ${div.cap}，你的機器人太貴了。先去 🔧 整備，拿掉幾張卡或換便宜的零件。`
        : champ
          ? '世界冠軍！現在每個人都想從你手上搶走腰帶。'
          : list.some((o) => o.kind === 'title')
            ? '冠軍戰的邀約來了！贏了就升級。'
            : this.last === true
              ? '打得好！觀眾開始記住你的名字了。'
              : this.last === false
                ? '輸一場不算什麼。去 AI 訓練場練一練，或請教練幫忙調配法。'
                : sp.pending.length
                ? `📨 有 ${sp.pending.length} 封贊助邀約，點上面的 🤝 看看。`
                : rival && list.some((o) => o.kind === 'rival')
                  ? `${rival.name} 一直在放話，要不要讓他閉嘴？`
                  : '挑一場吧：越級挑戰錢多，但對手也硬；熱身賽不影響名次。',
    );

    // 新聞：最新一則直接看，其他收起來
    const news = document.getElementById('cNews')!;
    if (c.news.length) {
      const more = el('details', 'cMore');
      more.append(el('summary', '', '📰'), ...c.news.slice(1, 8).map((n) => el('div', '', n)));
      news.replaceChildren(el('span', 'cHead', c.news[0]), ...(c.news.length > 1 ? [more] : []));
    } else news.replaceChildren();

    if (this.view === 'sponsors') {
      this.renderSponsors(c, body);
      return;
    }

    // 排名表
    const table = el('div', 'cTable');
    c.table.forEach((f, i) => {
      const me = f.id === 'me';
      const row = el('div', 'cRow' + (me ? ' me' : '') + (f.id === c.rival ? ' rival' : ''));
      row.append(
        el('b', 'cRank', i === 0 ? '👑' : me && i === c.table.length - 1 ? '🌱' : String(i + 1)),
        el('span', 'cName', me ? `${this.myName()}（你）` : f.name),
        el('small', '', f.id === c.rival ? '🔥' : me ? '' : `${f.w}-${f.l}`),
      );
      if (!me) {
        const s = fighterSetup(c, f, i);
        tip(row, f.name, `${BRAINS[s.brain].name}・${gearText(s.gear)}`, f.id === c.rival ? '🔥 你的宿敵：打贏人氣加倍' : `戰績 ${f.w} 勝 ${f.l} 敗`);
      }
      table.append(row);
    });

    // 這週的邀約
    const box = el('div', 'cOffers');
    this.picked = Math.min(this.picked, list.length - 1);
    list.forEach((o, i) => {
      const s = fighterSetup(c, o.foe, o.at);
      const card = el('button', `cOffer k-${o.kind}` + (i === this.picked ? ' on' : ''));
      card.append(
        el('b', '', OFFER_NAME[o.kind]),
        el('span', 'cFoe', o.foe.name),
        el('small', '', o.at >= 0 ? (o.at === 0 ? '👑 冠軍' : `第 ${o.at + 1} 名`) : '新面孔'),
        el('span', 'cPay', `🪙${o.purse}　👥+${o.fans}`),
      );
      tip(
        card,
        `${OFFER_NAME[o.kind]}：${o.foe.name}`,
        `${BRAINS[s.brain].name}・${gearText(s.gear)}`,
        o.kind === 'warmup' ? '不影響名次，比較好打' : o.kind === 'title' ? '贏了拿下腰帶、升到下一級' : o.kind === 'defend' ? '輸了腰帶就被搶走' : '贏了搶走他的名次；輸了掉一名',
        `出場費 🪙${o.purse}（K.O. 多 30%，輸了拿 40%）`,
      );
      card.addEventListener('click', () => {
        this.picked = i;
        this.render();
      });
      box.append(card);
    });
    body.replaceChildren(table, box);
    // 這場要顧的贊助條件
    if (sp.contracts.length) {
      const d = el('div', 'cDemands', '🤝 這場要做到：' + sp.contracts.map((k) => `${SPONSOR[k.id].icon} ${demandText(SPONSOR[k.id].demand)}`).join('・'));
      body.prepend(d);
    }
    const go = document.getElementById('cGo') as HTMLButtonElement;
    const o = list[this.picked];
    go.textContent = fit ? `▶ 開打：${o.foe.name}` : '💰 超出額度';
    go.disabled = !fit;
  }

  /** 贊助商：左邊是簽了的合約，右邊是還沒回的邀約 */
  private renderSponsors(c: Career, body: HTMLElement): void {
    const sp = c.sp;
    const full = sp.contracts.length >= slots(c.div);
    const card = (s: Sponsor, cls = ''): HTMLElement => {
      const n = el('div', 'cSp' + cls);
      const logo = el('i', 'cLogo', s.icon);
      logo.style.background = s.bg;
      logo.style.borderColor = s.fg;
      n.append(logo, el('b', '', s.name), el('span', '', '條件：' + demandText(s.demand)));
      tip(n, s.name, `「${s.pitch}」`, `條件：${demandText(s.demand)}`, `簽約金 🪙${s.sign}・每場達標 🪙${s.pay}`, `連續 ${MISSES_TO_DROP} 場沒做到就解約`);
      return n;
    };
    const mine = el('div', 'cSpCol');
    mine.append(el('h4', '', `📄 合約 ${sp.contracts.length}/${slots(c.div)}`));
    if (!sp.contracts.length) mine.append(el('div', 'cSpEmpty', '還沒有合約。'));
    for (const k of sp.contracts) {
      const s = SPONSOR[k.id];
      const n = card(s);
      n.append(el('span', 'cPay', `每場 🪙${s.pay}・已拿 🪙${k.paid}`));
      if (k.misses > 0) n.append(el('span', 'warn', '⚠ 上一場沒做到，再一次就解約'));
      const acts = el('div', 'acts');
      const q = el('button', 'pill', '解約') as HTMLButtonElement;
      q.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!q.dataset.sure) {
          // 點兩下才算：第一下先確認
          q.dataset.sure = '1';
          q.textContent = '確定解約？（不會再來）';
          return;
        }
        quit(sp, k.id);
        this.save();
        this.render();
      });
      acts.append(q);
      n.append(acts);
      mine.append(n);
    }
    const mail = el('div', 'cSpCol');
    mail.append(el('h4', '', `📨 邀約 ${sp.pending.length}`));
    if (!sp.pending.length) mail.append(el('div', 'cSpEmpty', '沒有新的邀約。贏球、K.O.、人氣、連勝，甚至一直輸，都會有贊助商注意到。'));
    for (const id of sp.pending) {
      const s = SPONSOR[id];
      const n = card(s, ' new');
      n.append(el('span', 'cPay', `簽約金 🪙${s.sign}・每場 🪙${s.pay}`));
      const acts = el('div', 'acts');
      const yes = el('button', 'pill yes', full ? '合約滿了' : '✍ 簽約') as HTMLButtonElement;
      yes.disabled = full;
      if (full) tip(yes, '合約滿了', `這一級最多簽 ${slots(c.div)} 家`, '先解約一家，或升級之後再簽');
      yes.addEventListener('click', (e) => {
        e.stopPropagation();
        const bonus = sign(sp, id, c.div);
        if (bonus < 0) return;
        this.progress.wallet.coins += bonus;
        c.news.unshift(`✍ 和${s.name}簽下贊助合約`);
        this.save();
        this.render();
        this.say(`簽了！簽約金 🪙${bonus} 已經入帳。記得：${demandText(s.demand)}。`);
      });
      const no = el('button', 'pill', '拒絕') as HTMLButtonElement;
      no.addEventListener('click', (e) => {
        e.stopPropagation();
        decline(sp, id, c.week);
        this.save();
        this.render();
      });
      acts.append(no, yes);
      n.append(acts);
      mail.append(n);
    }
    body.replaceChildren(mine, mail);
  }

  private say(text: string): void {
    const b = document.getElementById('cBoss')!;
    b.replaceChildren(el('i', '', BOSS), el('div', '', ''));
    const line = b.lastElementChild as HTMLElement;
    line.append(el('b', '', BOSS_NAME), el('span', '', text));
  }
}
