/**
 * 格鬥模式的選角畫面（P22）：先選自己的角色（紅方），再選對手（藍方，或隨機），按開打直接打。
 * 「拿去改裝」把選的角色的外型和配法搬進自己的改裝廠（沒有的卡會先空著，靠收集補上）。
 * 角色資料在 sim/fighters.ts。純畫面。
 */
import { BRAINS, CARDS } from '../sim/cards';
import { FIGHTERS, charSetup, type Fighter } from '../sim/fighters';
import { ARMORS, WEAPONS, weightInfo } from '../sim/gear';
import type { RobotSetup } from '../sim/match';
import { TACTICS } from '../sim/tactics';
import { BLUE_TEAM, RED_TEAM } from '../models/robot';
import { portrait } from './preview';

function node(tag: string, cls: string, text = ''): HTMLElement {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text) n.textContent = text;
  return n;
}

export class VersusScreen {
  private scr = document.getElementById('vsScr')!;
  private grid = document.getElementById('vsGrid')!;
  private info = document.getElementById('vsInfo')!;
  private go = document.getElementById('vsGo') as HTMLButtonElement;
  private stepMe = document.getElementById('vsStepMe')!;
  private stepFoe = document.getElementById('vsStepFoe')!;
  /** 現在在選哪一邊 */
  private side: 0 | 1 = 0;
  private picks: [Fighter | null, Fighter | null] = [null, null];

  constructor(
    private onFight: (me: RobotSetup, foe: RobotSetup) => void,
    private onModify: (f: Fighter) => void,
  ) {
    this.stepMe.addEventListener('click', () => this.setSide(0));
    this.stepFoe.addEventListener('click', () => this.setSide(1));
    document.getElementById('vsRand')!.addEventListener('click', () => {
      const pool = FIGHTERS.filter((f) => f !== this.picks[0]);
      this.picks[1] = pool[Math.floor(Math.random() * pool.length)];
      this.render();
    });
    document.getElementById('vsMod')!.addEventListener('click', () => {
      const f = this.picks[0];
      if (!f) return;
      this.scr.classList.add('hidden');
      this.onModify(f);
    });
    this.go.addEventListener('click', () => {
      const [a, b] = this.picks;
      if (!a || !b) return;
      this.scr.classList.add('hidden');
      this.onFight(charSetup(a), charSetup(b));
    });
    this.scr.addEventListener('click', (e) => {
      if (e.target === this.scr) this.scr.classList.add('hidden');
    });
  }

  get visible(): boolean {
    return !this.scr.classList.contains('hidden');
  }

  open(): void {
    this.scr.classList.remove('hidden');
    this.setSide(this.picks[0] ? 1 : 0);
  }

  private setSide(s: 0 | 1): void {
    this.side = s;
    this.render();
  }

  private pick(f: Fighter): void {
    this.picks[this.side] = f;
    // 選完自己就自動跳去選對手
    if (this.side === 0 && !this.picks[1]) this.side = 1;
    this.render();
  }

  private card(f: Fighter): HTMLElement {
    const s = charSetup(f);
    const b = node('button', 'vsCard');
    if (this.picks[0] === f) b.classList.add('me');
    if (this.picks[1] === f) b.classList.add('foe');
    if (this.picks[0] === f) b.append(node('span', 'vsTag', '1P'));
    else if (this.picks[1] === f) b.append(node('span', 'vsTag', 'CPU'));
    b.append(portrait(s.gear, s.look, this.side === 0 ? RED_TEAM : BLUE_TEAM));
    b.append(node('b', '', f.name.split(' ').pop() ?? f.name));
    b.append(node('small', '', f.tag));
    b.addEventListener('click', () => this.pick(f));
    return b;
  }

  private sideInfo(f: Fighter | null, cls: string, who: string): HTMLElement {
    const box = node('div', 'vsSide ' + cls);
    if (!f) {
      box.append(node('b', '', who), node('span', '', '還沒選'));
      return box;
    }
    const s = charSetup(f);
    const wi = weightInfo(s.gear);
    box.append(node('b', '', `${who}・${f.name}`));
    box.append(node('span', '', f.bio));
    box.append(
      node('span', '', `${ARMORS[s.gear.armor].name} ${wi.plateMm}mm・${Math.round(wi.mass)}kg・${WEAPONS[s.gear.weapon].name}・🧠 ${BRAINS[s.brain].name}`),
    );
    const deck = node('div', 'vsDeck');
    for (const c of s.deck) deck.append(node('span', '', CARDS[c]?.name ?? c));
    box.append(deck);
    box.append(node('span', '', '戰術：' + (s.plan ?? []).map((t) => `${TACTICS[t].icon}${TACTICS[t].name}`).join(' → ')));
    return box;
  }

  private render(): void {
    this.stepMe.classList.toggle('on', this.side === 0);
    this.stepFoe.classList.toggle('on', this.side === 1);
    this.stepMe.classList.toggle('picked', !!this.picks[0]);
    this.stepFoe.classList.toggle('picked', !!this.picks[1]);
    this.stepMe.textContent = this.picks[0] ? `1P ${this.picks[0].name.split(' ').pop()}` : '1P 你的角色';
    this.stepFoe.textContent = this.picks[1] ? `對手 ${this.picks[1].name.split(' ').pop()}` : '對手';
    this.grid.replaceChildren(...FIGHTERS.map((f) => this.card(f)));
    this.info.replaceChildren(this.sideInfo(this.picks[0], 'red', '紅方（你）'), this.sideInfo(this.picks[1], 'blue', '藍方'));
    this.go.disabled = !this.picks[0] || !this.picks[1];
    this.go.textContent = this.picks[0] && this.picks[1] ? '⚔️ 開打！' : this.picks[0] ? '選一個對手' : '先選你的角色';
  }
}
