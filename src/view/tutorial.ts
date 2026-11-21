/**
 * 新手引導（純畫面）。三段：
 *  1. 第一次進來：不給看整個設定畫面，選一個流派就直接開打（對手是最弱的那台，三種都穩贏）。
 *  2. 第一場對戰中：照時間和事件跳幾句提示，同時把提示講的那塊介面框起來。不暫停比賽。
 *  3. 打完回到設定畫面：一步一步帶過額度、大腦、卡、對手。
 * 做到哪一段存在 localStorage；老玩家（已經打過）不會看到。
 */
import { DEFAULT_GEAR } from '../sim/gear';
import { TICK_HZ, type Match } from '../sim/match';
import type { BrainId } from '../sim/cards';
import type { Loadout } from '../sim/types';
import { artFor } from './art';

const KEY = 'prompt-cage.tutorial';

export interface Starter {
  title: string;
  text: string;
  gear: Loadout;
  brain: BrainId;
  deck: string[];
}

/** 三套入門配法：都只用新玩家一開始就有的卡，也都在額度內 */
export const STARTERS: Starter[] = [
  { title: '拳擊手', text: '穩穩往前壓，用刺拳點、看到破綻才出重拳。最好上手。', gear: DEFAULT_GEAR, brain: 'parrot', deck: ['boxing', 'slip_counter', 'shell_up'] },
  { title: '亂鬥王', text: '衝上去猛攻，重拳能砸穿防禦。很痛，但很快就沒電。', gear: DEFAULT_GEAR, brain: 'parrot', deck: ['brawler', 'jab_jab'] },
  { title: '太極師', text: '站著等對手先出手，把拳化掉再打回去。後發先至。', gear: DEFAULT_GEAR, brain: 'parrot', deck: ['taichi', 'slip_counter'] },
];

interface Tip {
  /** 幾秒之後才可以出現（從開打算） */
  after: number;
  /** 要框起來的介面 */
  target: string;
  text: string;
  /** 有的提示要等事情發生才講 */
  when?: (m: Match) => boolean;
  /** 等到這時候還沒發生就跳過 */
  giveUp?: number;
}

const FIGHT_TIPS: Tip[] = [
  { after: 0.4, target: 'rules', text: '你不用按任何按鍵。左下角亮起來的那一行，就是它現在照著做的規則。' },
  { after: 7, target: 'en0', text: '血條下面最細的那條是能量：出拳和衝刺都要花，用完就只能抱頭防守。' },
  {
    after: 13,
    target: 'rules',
    text: '看到紅字了嗎？那是大腦聽錯了指令。便宜的大腦比較常聽錯。',
    when: (m) => m.robots[0].fumbling,
    giveUp: 30,
  },
  { after: 20, target: 'po0', text: '中間那條是平衡值：被打或一直擋都會掉，掉光就會被打倒在地。' },
];

const TOUR: { target: string; text: string; tab: 'camp' | 'build' }[] = [
  { target: 'campHead', tab: 'camp', text: '這是你的選手。你是它的教練：賽前決定它的身體和大腦，上場之後它自己打。' },
  { target: 'foes', tab: 'camp', text: '排名戰：打贏一台才能挑戰下一台，一路打到冠軍。第一次打贏會拿到它的卡。' },
  { target: 'coachBox', tab: 'camp', text: '不知道怎麼配？按「跑陪練模擬」，AI 教練會把幾十套配法實際打過，告訴你哪一套勝率最高。' },
  { target: 'budget', tab: 'build', text: '想自己動手就到「改裝」：武器、骨架、大腦、每一張卡都花同一筆 1000 點。聰明的大腦很貴，錢花在這裡，身體就得省。' },
  { target: 'tabs', tab: 'camp', text: '「訓練」可以調整它的打法和性格，「外型」換塗裝。準備好就按最下面的「開打」。' },
];

export class Tutorial {
  /** 0 = 還沒打過，1 = 打過第一場、還沒看設定導覽，2 = 都看完了 */
  stage: number;
  private welcome = document.getElementById('welcome')!;
  private coach = document.getElementById('coach')!;
  private coachText = document.getElementById('coachText')!;
  private coachBtns = document.getElementById('coachBtns')!;
  private marked: HTMLElement | null = null;
  private tip = 0;
  private tipLeft = 0;
  /** 這一場要不要跳對戰提示 */
  private coaching = false;
  private touring = false;

  constructor(
    veteran: boolean,
    onPick: (s: Starter) => void,
    onSkip: () => void,
    /** 導覽講到哪一頁，就把設定畫面切到那一頁 */
    private goTab: (tab: 'camp' | 'build') => void,
  ) {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(KEY);
    } catch {
      // 讀不到就當新玩家
    }
    this.stage = saved !== null ? Math.max(0, Math.min(2, Number(saved) || 0)) : veteran ? 2 : 0;

    const box = document.getElementById('starters')!;
    for (const st of STARTERS) {
      const btn = document.createElement('button');
      btn.className = 'card starter';
      const art = artFor(st.deck[0]);
      if (art) btn.append(art);
      const b = document.createElement('b');
      b.textContent = st.title;
      const span = document.createElement('span');
      span.textContent = st.text;
      btn.append(b, span);
      btn.addEventListener('click', () => {
        this.welcome.classList.add('hidden');
        this.coaching = true;
        this.setStage(1);
        onPick(st);
      });
      box.append(btn);
    }
    document.getElementById('welcomeSkip')!.addEventListener('click', () => {
      this.welcome.classList.add('hidden');
      this.setStage(2);
      onSkip();
    });
  }

  private setStage(n: number): void {
    this.stage = n;
    try {
      localStorage.setItem(KEY, String(n));
    } catch {
      // 存不了就算了：頂多下次再看一次引導
    }
  }

  /** 新玩家：蓋掉設定畫面，先選流派 */
  showWelcome(): void {
    this.welcome.classList.remove('hidden');
  }

  get welcoming(): boolean {
    return !this.welcome.classList.contains('hidden');
  }

  private mark(id: string | null): void {
    this.marked?.classList.remove('coach-target');
    this.marked = id ? document.getElementById(id) : null;
    this.marked?.classList.add('coach-target');
  }

  private say(text: string, target: string, buttons: [string, () => void][] = []): void {
    this.coachText.textContent = text;
    this.coachBtns.replaceChildren(
      ...buttons.map(([label, fn], i) => {
        const b = document.createElement('button');
        b.textContent = label;
        if (i === 0) b.className = 'primary';
        b.addEventListener('click', fn);
        return b;
      }),
    );
    this.coach.classList.remove('hidden');
    this.mark(target);
  }

  private hush(): void {
    this.coach.classList.add('hidden');
    this.mark(null);
  }

  /** 開打時叫：不是第一場就不提示 */
  onStart(): void {
    this.tip = 0;
    this.tipLeft = 0;
    this.touring = false;
    this.coach.classList.remove('tour');
    this.hush();
  }

  /** 每個邏輯 tick 之後叫 */
  onTick(m: Match): void {
    if (!this.coaching) return;
    if (m.phase === 'over') {
      this.coaching = false;
      this.hush();
      return;
    }
    if (m.phase !== 'fight' || this.tipLeft > 0) return;
    const t = FIGHT_TIPS[this.tip];
    if (!t) return;
    const sec = m.fightTicks / TICK_HZ;
    if (sec < t.after) return;
    if (t.when && !t.when(m)) {
      if (t.giveUp !== undefined && sec > t.giveUp) this.tip++;
      return;
    }
    this.tip++;
    this.tipLeft = 5.5;
    this.say(t.text, t.target);
  }

  /** 每一幀叫 */
  update(dt: number): void {
    if (this.touring || this.tipLeft <= 0) return;
    this.tipLeft -= dt;
    if (this.tipLeft <= 0) this.hush();
  }

  /** 回到設定畫面時叫：打完第一場之後帶一次導覽 */
  maybeTour(): void {
    this.coaching = false;
    if (this.stage !== 1) return;
    this.touring = true;
    this.coach.classList.add('tour');
    const step = (i: number): void => {
      if (i >= TOUR.length) {
        this.touring = false;
        this.coach.classList.remove('tour');
        this.hush();
        this.goTab('camp');
        this.setStage(2);
        return;
      }
      const last = i === TOUR.length - 1;
      this.goTab(TOUR[i].tab);
      this.say(`${i + 1} / ${TOUR.length}　${TOUR[i].text}`, TOUR[i].target, [
        [last ? '知道了' : '下一步', () => step(i + 1)],
        ...(last ? [] : ([['跳過', () => step(TOUR.length)]] as [string, () => void][])),
      ]);
      this.marked?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    };
    step(0);
  }
}
