/**
 * 場邊主持人的即時轉播。只讀戰鬥事件和狀態，把發生的事講成一句話，顯示成字幕（可選擇唸出來）。
 * 純畫面：講什麼、挑哪一句都不影響勝負。挑句子用演出專用的亂數（showRng.ts），同一個種子每次聽到的台詞一樣。
 *
 * 兩位主持人：播報員講「發生了什麼」，球評講「為什麼」（大腦聽錯、沒電、卡牌）。
 * 一次只講一句；事情太多時，重要的先講，不重要又過時的就不講了。
 */
import { MATCH_TICKS, ROUNDS, TICK_HZ, type Match } from '../sim/match';
import { VERDICT_TEXT } from '../sim/judges';
import { CARDS } from '../sim/cards';
import type { Robot } from '../sim/types';
import type { Hud } from './hud';
import { ShowRng } from './showRng';

type Who = '播報' | '球評';

interface Line {
  who: Who;
  text: string;
  /** 越大越重要 */
  prio: number;
  /** 這句話最晚什麼時候講還有意義（秒） */
  expires: number;
}

/** 演出亂數：reset 時用比賽種子重設，每個 tick 先 at(tick) */
const show = new ShowRng();
function pick(list: readonly string[]): string {
  return show.pick(list);
}

/** 名字太長就只講後半（「RAMPAGE-02 衝撞者」→「衝撞者」） */
function short(r: Robot): string {
  const parts = r.spec.name.trim().split(/\s+/);
  return parts[parts.length - 1];
}

export class Commentator {
  /** 要不要用瀏覽器內建的語音唸出來 */
  voice = false;
  private queue: Line[] = [];
  private clock = 0;
  /** 現在這句還要顯示多久 */
  private hold = 0;
  private lastHit = 0;
  private lastQuiet = 0;
  private lastJabLine = -10;
  private lowHp = [false, false];
  private lastRule = -1;
  private said = new Set<string>();

  constructor(private hud: Hud) {}

  reset(seed: number): void {
    show.reset(seed);
    this.queue = [];
    this.clock = 0;
    this.hold = 0;
    this.lastHit = 0;
    this.lastQuiet = 0;
    this.lastJabLine = -10;
    this.lowHp = [false, false];
    this.lastRule = -1;
    this.said.clear();
    this.hud.caption('', '');
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
  }

  /** 別的演出（失誤演出）要主持人講一句 */
  comment(who: Who, text: string, prio: number, ttl = 3): void {
    this.say(who, text, prio, ttl);
  }

  private say(who: Who, text: string, prio: number, ttl = 2.5): void {
    this.queue.push({ who, text, prio, expires: this.clock + ttl });
  }

  /** 整場只講一次的話 */
  private once(key: string, who: Who, text: string, prio: number, ttl = 4): void {
    if (this.said.has(key)) return;
    this.said.add(key);
    this.say(who, text, prio, ttl);
  }

  /** 每個邏輯 tick 之後呼叫 */
  onTick(m: Match): void {
    show.at(m.tick);
    const [a, b] = m.robots;
    const name = (i: number): string => short(m.robots[i]);

    for (const e of m.events) {
      switch (e.type) {
        case 'count':
          if (e.n === 3) this.say('播報', `歡迎來到 PROMPT CAGE！紅方 ${name(0)}，對上藍方 ${name(1)}！`, 9, 4);
          break;
        case 'round':
          if (e.n > 1) this.say('播報', e.n === ROUNDS ? '最後一回合！要拿下比賽就看這二十秒！' : `第 ${e.n} 回合開始！`, 8, 2.5);
          break;
        case 'bell':
          if (m.phase === 'break') this.say('播報', pick([`第 ${e.n} 回合結束！兩邊回到角落。`, `鐘聲響了，第 ${e.n} 回合結束。`]), 7, 3);
          if (m.phase === 'break') this.say('球評', '裁判的分數要打完才公布，現在看的是誰比較有效地打中對手。', 3, 5);
          break;
        case 'tko':
          this.say(
            '播報',
            e.why === 'strikes'
              ? `裁判衝進來了！${name(e.robot)} 一直挨打沒有還手，比賽中止！`
              : e.why === 'knockdowns'
                ? `第三次倒地！裁判直接揮手，比賽結束！`
                : `裁判看了一眼就揮手，${name(e.robot)} 傷得太重了！`,
            10,
            6,
          );
          break;
        case 'start':
          this.say('播報', pick(['鐘聲響了，開打！', '裁判手一揮，比賽開始！']), 8, 2);
          this.say(
            '球評',
            `${name(0)} 用的是 ${m.brains[0].program.brain.name}，${name(1)} 是 ${m.brains[1].program.brain.name}，看誰的大腦比較聽話。`,
            3,
            5,
          );
          break;
        case 'hit': {
          this.lastHit = this.clock;
          const A = name(e.attacker);
          const T = name(e.target);
          if (e.blocked) {
            if (e.kind === 'heavy')
              this.say('播報', pick([`${T} 擋下這記重拳！但手都被震開了。`, `擋住了！${T} 硬吃下這一下。`]), 4);
          } else if (e.kind === 'heavy') {
            if (e.counter) this.say('播報', pick([`反擊命中！${A} 抓到 ${T} 出手的瞬間！`, `漂亮！${A} 一拳打斷 ${T}！`]), 7);
            else this.say('播報', pick([`重拳！${T} 整個身體晃了一下！`, `${A} 這一拳打得結結實實！`, `轟！${T} 吃了一記重的！`]), 6);
          } else if (this.clock - this.lastJabLine > 6) {
            this.lastJabLine = this.clock;
            this.say('播報', pick([`${A} 的刺拳一直點在 ${T} 身上。`, `${A} 用刺拳控制距離。`, `又是一記刺拳，${T} 很難靠近。`]), 1, 1.5);
          }
          break;
        }
        case 'whiff':
          if (e.kind === 'heavy') this.say('播報', pick([`${name(e.robot)} 揮空了！好大的破綻！`, `落空！${name(e.robot)} 整個人轉了過去。`]), 3, 1.5);
          break;
        case 'down':
          this.say('播報', pick([`倒了！${name(e.robot)} 被打倒在地！裁判開始讀秒！`, `${name(e.robot)} 倒下了！它還站得起來嗎？`]), 9, 3);
          break;
        case 'getup':
          this.say('播報', pick([`${name(e.robot)} 站起來了，還能打！`, `${name(e.robot)} 爬起來了，比賽繼續！`]), 6, 2);
          break;
        case 'gassed':
          this.say('球評', pick([`${name(e.robot)} 沒電了！現在只能抱頭防守，這是 ${name(1 - e.robot)} 的機會。`, `打太兇了，${name(e.robot)} 的能量見底，得喘一下。`]), 6, 3);
          break;
        case 'cage':
          this.say('播報', pick([`${name(e.robot)} 被打到撞上圍網！`, `碰！${name(e.robot)} 整個撞在網上！`]), 4, 2);
          break;
        case 'ko':
          this.say('播報', `K.O.！！${name(e.robot)} 起不來了！比賽結束！`, 10, 6);
          break;
        case 'end':
          if (e.winner === -1) this.say('播報', '三回合打完，裁判判定：這場平手！', 10, 6);
          else {
            if (e.method === 'DEC' && m.decision) this.say('播報', `三回合打完，交給裁判！${VERDICT_TEXT[m.decision.verdict]}，${name(e.winner)} 獲勝！`, 10, 6);
            this.say('球評', `恭喜 ${name(e.winner)}！裁判舉起了它的手。`, 5, 8);
          }
          break;
        default:
          break;
      }
    }

    if (m.phase !== 'fight') return;
    // 大腦聽錯：交給失誤演出（misfire.ts）講，這裡不重複
    m.robots.forEach((r, i) => {
      const low = r.hp / r.spec.maxHp < 0.25;
      if (low && !this.lowHp[i]) this.say('播報', `${name(i)} 的血量見底了，再吃一拳重的可能就結束！`, 5, 3);
      this.lowHp[i] = low;
    });
    // 紅方（玩家）換了一張卡在用
    const rule = a.ruleIndex >= 0 ? m.brains[0].program.rules[a.ruleIndex] : null;
    if (rule && a.ruleIndex !== this.lastRule && !a.fumbling) {
      const card = CARDS[rule.card];
      if (card && card.kind !== 'style') this.once(`card:${card.id}`, '球評', `${name(0)} 用上了「${card.name}」這張卡。`, 2, 2);
    }
    this.lastRule = a.ruleIndex;

    const left = (MATCH_TICKS - m.fightTicks) / TICK_HZ;
    if (left <= 10) this.once('10', '播報', '整場最後十秒！要拚就趁現在！', 7, 3);
    // 冷場
    if (this.clock - this.lastHit > 5 && this.clock - this.lastQuiet > 9) {
      this.lastQuiet = this.clock;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      this.say(
        '球評',
        dist > 60
          ? pick(['兩邊拉得很開，都在等對方先過來。', '場地大，要追到人沒那麼容易。'])
          : pick(['雙方都在試探，誰也不想先露出破綻。', '這幾秒很安靜，都在等對方出手。']),
        1,
        3,
      );
    }
  }

  /** 每一幀呼叫：一次講一句，講完再講下一句 */
  update(dt: number): void {
    this.clock += dt;
    this.hold -= dt;
    // 過時的不講了
    this.queue = this.queue.filter((l) => l.expires >= this.clock);
    if (this.queue.length === 0) {
      if (this.hold < -2.5) this.hud.caption('', '');
      return;
    }
    // 現在這句還沒講完，除非來了很重要的事才插話
    const top = this.queue.reduce((x, y) => (y.prio > x.prio ? y : x));
    if (this.hold > 0 && top.prio < 8) return;
    this.queue.splice(this.queue.indexOf(top), 1);
    this.hold = Math.min(3.2, 0.9 + top.text.length * 0.07);
    this.hud.caption(top.who, top.text);
    this.speak(top.text);
  }

  private speak(text: string): void {
    if (!this.voice || typeof speechSynthesis === 'undefined') return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'zh-TW';
    u.rate = 1.35;
    speechSynthesis.speak(u);
  }
}
