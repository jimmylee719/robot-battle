/** 疊在畫面上的 DOM 介面：血條、平衡條、計時、目前行動、橫幅、結果。 */
import { MATCH_TICKS, TICK_HZ, type Match } from '../sim/match';

function el(id: string): HTMLElement {
  return document.getElementById(id)!;
}

export class Hud {
  private hp = [el('hp0'), el('hp1')];
  private hpLag = [el('lag0'), el('lag1')];
  private poise = [el('po0'), el('po1')];
  private act = [el('act0'), el('act1')];
  private names = [el('n0'), el('n1')];
  private timer = el('timer');
  private bannerEl = el('banner');
  private resultEl = el('result');
  private bannerLeft = 0;

  reset(m: Match): void {
    m.robots.forEach((r, i) => (this.names[i].textContent = r.spec.name));
    this.resultEl.textContent = '';
    this.bannerEl.textContent = '';
    this.bannerLeft = 0;
    this.update(m, 0);
  }

  banner(text: string, seconds: number, cls = ''): void {
    this.bannerEl.textContent = text;
    this.bannerEl.className = cls;
    // 重新觸發進場動畫
    void this.bannerEl.offsetWidth;
    this.bannerEl.classList.add('pop');
    this.bannerLeft = seconds;
  }

  showResult(m: Match): void {
    const text = m.winner === -1 || m.winner === null ? '平手' : `${m.robots[m.winner].spec.name} 獲勝`;
    const how = m.robots.some((r) => r.action === 'ko') ? 'K.O.' : 'TIME UP';
    this.banner(how, 2.5, 'gold');
    this.resultEl.textContent = text;
  }

  update(m: Match, dt: number): void {
    m.robots.forEach((r, i) => {
      const hp = (r.hp / r.spec.maxHp) * 100;
      this.hp[i].style.width = `${hp}%`;
      this.hpLag[i].style.width = `${hp}%`;
      this.poise[i].style.width = `${Math.max(0, r.poise / r.spec.maxPoise) * 100}%`;
      this.act[i].textContent = `▶ ${ACTION_TEXT[r.action] ?? r.label}`;
    });
    const left = Math.max(0, MATCH_TICKS - m.fightTicks);
    this.timer.textContent = String(Math.ceil(left / TICK_HZ));
    if (this.bannerLeft > 0) {
      this.bannerLeft -= dt;
      if (this.bannerLeft <= 0) this.bannerEl.textContent = '';
    }
  }
}

/** 身體被迫進入的狀態直接顯示狀態名；其餘顯示大腦的計畫（label） */
const ACTION_TEXT: Partial<Record<string, string>> = {
  stagger: '被打中，硬直',
  down: '被擊倒',
  getup: '爬起來',
  ko: '無法戰鬥',
  win: '勝利',
};
