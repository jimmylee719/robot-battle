/**
 * 賽季獎勵畫面（純畫面）。規則在 sim/season.ts。
 * 上面是賽季名字、剩幾天、目前第幾階；中間一條星星進度；下面 20 格獎勵，到了的會跳、點一下就領。
 */
import { Rng } from '../core/rng';
import {
  claim,
  claimable,
  daysLeft,
  ROAD,
  rewardIcon,
  rewardText,
  seasonName,
  STARS_PER_TIER,
  TIERS,
  tierOf,
} from '../sim/season';
import type { SoundPlayer } from '../audio/sound';
import { dailyDay, type Progress } from './save';

function el(tag: string, cls = '', text = ''): HTMLElement {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text) n.textContent = text;
  return n;
}

export class SeasonScreen {
  private root = document.getElementById('seasonScr')!;

  constructor(
    private progress: Progress,
    private audio: SoundPlayer,
    private save: () => void,
  ) {
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.hide();
    });
    document.getElementById('sAll')!.addEventListener('click', () => {
      const s = this.progress.season;
      const got = claimable(s).map((t) => this.take(t));
      this.show(got.filter((g): g is string => !!g));
    });
  }

  open(): void {
    document.getElementById('sGot')!.replaceChildren();
    this.render();
    this.root.classList.remove('hidden');
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  private take(tier: number): string | null {
    const rng = new Rng((Math.random() * 4294967296) >>> 0);
    return claim(this.progress.season, tier, this.progress.owned, this.progress.wallet, rng);
  }

  private show(got: string[]): void {
    if (!got.length) return;
    this.save();
    this.audio.unlock();
    this.audio.play('rare');
    this.render();
    document.getElementById('sGot')!.replaceChildren(...got.map((g) => el('div', '', g)));
  }

  private render(): void {
    const s = this.progress.season;
    const day = dailyDay();
    const tier = tierOf(s.stars);
    const left = daysLeft(day);
    const chip = (t: string): HTMLElement => el('span', 'cChip', t);
    document.getElementById('sTitle')!.textContent = `🎫 ${seasonName(s.id)}`;
    document.getElementById('sHead')!.replaceChildren(
      chip(`🏅 第 ${tier} / ${TIERS} 階`),
      chip(`⭐ ${s.stars}`),
      chip(left <= 1 ? '⏰ 今天換季' : `⏰ 剩 ${left} 天`),
      ...(s.history[0] ? [chip(`上季 S${s.history[0].id}：第 ${s.history[0].tier} 階`)] : []),
    );
    // 進度條：這一階走到哪
    const bar = document.getElementById('sBar')!;
    const into = tier >= TIERS ? STARS_PER_TIER : s.stars % STARS_PER_TIER;
    (bar.firstElementChild as HTMLElement).style.width = `${(into / STARS_PER_TIER) * 100}%`;
    bar.lastElementChild!.textContent = tier >= TIERS ? '⭐ 滿階！' : `⭐ ${into} / ${STARS_PER_TIER}　下一階：${rewardIcon(ROAD[tier])} ${rewardText(ROAD[tier])}`;
    document.getElementById('sHow')!.textContent =
      s.firstWinDay === day
        ? '每場都有星星：贏 3、輸 1、K.O. 和生涯再加。今天的首勝加成拿過了。'
        : '每場都有星星：贏 3、輸 1、K.O. 和生涯再加。今天第一場勝利再 +3 ⭐！';
    const road = document.getElementById('sRoad')!;
    road.replaceChildren(
      ...ROAD.map((r, i) => {
        const t = i + 1;
        const done = s.claimed.includes(t);
        const ready = t <= tier && !done;
        const c = el('button', 'sCell' + (done ? ' done' : ready ? ' ready' : t > tier ? ' lock' : '') + (r.kind === 'card' ? ' rare' : ''));
        c.append(el('b', '', `第 ${t} 階`), el('i', '', rewardIcon(r)), el('span', '', rewardText(r)));
        if (ready)
          c.addEventListener('click', () => {
            const g = this.take(t);
            this.show(g ? [g] : []);
          });
        return c;
      }),
    );
    const n = claimable(s).length;
    const all = document.getElementById('sAll') as HTMLButtonElement;
    all.disabled = n === 0;
    all.textContent = n ? `🎁 全部領取（${n}）` : '🎁 沒有可以領的';
  }
}
