import { Renderer } from './render/renderer';
import { createMatch, stepMatch, TICK_HZ, type Match, type RobotSetup } from './sim/match';
import { LADDER, type Opponent } from './sim/roster';
import { grantForWin } from './sim/album';
import { CARDS } from './sim/cards';
import { decodeReplay, encodeReplay, type Replay } from './sim/share';
import { runToEnd } from './sim/camp';
import { matchHash } from './sim/match';
import { DEFAULT_GEAR } from './sim/gear';
import { buildArenaModels } from './models/arena';
import { BLUE_TEAM, buildRobotModels, RED_TEAM, type Patch } from './models/robot';
import { SPONSOR } from './sim/sponsor';
import { MisfireShow, type MisfireRecord } from './view/misfire';
import { Rng } from './core/rng';
import { addStars, rollover, seasonName, tierOf, TIERS, ROAD, rewardIcon, rewardText, STARS_PER_TIER } from './sim/season';
import { drawScene, puppetInfo, type SceneModels } from './view/scene';
import { Fx } from './view/fx';
import { Crowd } from './view/crowd';
import { Commentator } from './view/commentary';
import { Hud } from './view/hud';
import { MODE_TABS, pct, SetupScreen, shownChanges } from './view/setup';
import { Menu } from './view/menu';
import { INCOME } from './sim/gacha';
import { ROUNDS, setTactic } from './sim/match';
import { beats, TACTIC_LIST, TACTICS } from './sim/tactics';
import { loadProgress, saveProgress } from './view/save';
import { growFrom } from './sim/camp';
import { ACTION_TEXT } from './sim/rules';
import { AXES, AXIS_TEXT } from './sim/temper';
import { Director } from './view/director';
import { SynthPlayer } from './audio/synth';
import type { SoundPlayer } from './audio/sound';
import { CameraControls } from './input/controls';
import { Tutorial } from './view/tutorial';
import { dailyFor, dailyScore } from './sim/daily';
import { dailyDay } from './view/save';
import { League } from './view/league';
import type { FightResult } from './sim/league';
import { advice, logTick, newLog } from './sim/coach';
import { rankText } from './view/setup';
import { CareerScreen } from './view/career';
import { DIVISIONS, fighterSetup, fightSeed, finishFight, myRank, type Offer } from './sim/career';
import { BUDGET } from './sim/gear';

/** 低解析度緩衝區大小。所有東西都先畫在這裡，再整數倍放大。 */
const BUF_W = 480;
const BUF_H = 270;
/** 解析度比原本的 320×180 高多少：鏡頭的縮放跟著乘，畫面框到的範圍才不變 */
const RES = BUF_W / 320;

const canvas = document.getElementById('screen') as HTMLCanvasElement;
const ctx = canvas.getContext('2d', { alpha: false })!;
const buffer = document.createElement('canvas');
buffer.width = BUF_W;
buffer.height = BUF_H;
const bufferCtx = buffer.getContext('2d')!;
const stats = document.getElementById('stats')!;
const muteBtn = document.getElementById('mute')!;

function resize(): void {
  const dpr = window.devicePixelRatio || 1;
  const scale = Math.max(1, Math.floor(Math.min((innerWidth * dpr) / BUF_W, (innerHeight * dpr) / BUF_H)));
  canvas.width = BUF_W * scale;
  canvas.height = BUF_H * scale;
  canvas.style.width = `${canvas.width / dpr}px`;
  canvas.style.height = `${canvas.height / dpr}px`;
  ctx.imageSmoothingEnabled = false;
}
window.addEventListener('resize', resize);
resize();

const renderer = new Renderer(BUF_W, BUF_H);
renderer.cam.angle = 0.35;
renderer.cam.zoom = 1.4 * RES;
const models: SceneModels = {
  arena: buildArenaModels(),
  robots: [buildRobotModels(RED_TEAM, DEFAULT_GEAR), buildRobotModels(BLUE_TEAM, DEFAULT_GEAR)],
  // 裁判：黑白配色的同一副骨架
  referee: buildRobotModels({ team: '#2b2f3a', teamLight: '#e9e4d4', teamDark: '#16181f' }, DEFAULT_GEAR),
};
const fx = new Fx();
const hud = new Hud();
const audio: SoundPlayer = new SynthPlayer();
const crowd = new Crowd();
const commentator = new Commentator(hud);
const director = new Director(fx, audio, hud, renderer, models.robots, crowd);
const misfire = new MisfireShow(fx, audio, commentator, renderer, canvas);
/**
 * 剛打完那一場的結算資料：種子、雙方設定、所有失誤（雙方）。
 * 之後挑精華片段、做分享影片要用。
 */
export interface FightReport {
  seed: number;
  setups: [RobotSetup, RobotSetup];
  misfires: MisfireRecord[];
}
let fightReport: FightReport | null = null;

const progress = loadProgress();
const setup = new SetupScreen(progress, () => start(match.seed));
// 新手引導：沒打過的玩家先選一個流派就開打，不先看整個設定畫面
const tutorial = new Tutorial(
  progress.fights > 0,
  (st) => {
    setup.apply(st.gear, st.brain, st.deck);
    setup.foe = 0;
    start(match.seed);
  },
  () => goHub(),
  (tab) => setup.tab(tab),
);
/** 首頁和大廳 */
const menu = new Menu(
  progress,
  audio,
  () => saveProgress(progress),
  () => {
    audio.unlock();
    // 新玩家先選流派打第一場；老玩家進大廳
    if (tutorial.stage === 0) {
      menu.hideAll();
      tutorial.showWelcome();
    } else goHub();
  },
  (mode) => {
    menu.hideAll();
    leaveCareer();
    setup.mode = mode;
    openSetup();
    setup.tab(MODE_TABS[mode][0]);
  },
);
menu.info = () => ({ name: setup.robot().name, rank: rankText(LADDER.filter((o) => (progress.record[o.id]?.w ?? 0) > 0).length) });
/** 回大廳 */
function goHub(): void {
  leaveCareer();
  careerScr.hide();
  setup.hide();
  setup.refresh();
  menu.showHub();
}
document.getElementById('toHub')!.addEventListener('click', goHub);
/** 生涯：這週接的比賽（從生涯畫面開打或整備時設定）；不在生涯裡就是 null */
let careerOffer: Offer | null = null;
/** 剛打完一場生涯戰：賽後畫面的「繼續」回生涯畫面 */
let careerReturn = false;
/** 生涯：身上的贊助商標誌 */
function careerPatches(): Patch[] {
  return (progress.career?.sp.contracts ?? []).map((c) => SPONSOR[c.id]).filter(Boolean).map((s) => ({ bg: s.bg, fg: s.fg }));
}
/** 離開生涯（去別的模式）：額度和開打按鈕恢復一般 */
function leaveCareer(): void {
  careerOffer = null;
  careerReturn = false;
  setup.cap = BUDGET;
  setup.careerFoe = null;
  setup.patches = [];
}
/** 進生涯的某一場：額度換成這一級的，開打按鈕顯示對手 */
function enterCareer(o: Offer): void {
  careerOffer = o;
  setup.cap = DIVISIONS[progress.career!.div].cap;
  setup.careerFoe = o.foe.name;
  setup.patches = careerPatches();
}
const careerScr = new CareerScreen(
  progress,
  () => saveProgress(progress),
  (o) => {
    // 整備：打開改裝廠，開打按鈕直接打這週接的比賽
    enterCareer(o);
    careerScr.hide();
    menu.hideAll();
    setup.mode = 'career';
    openSetup();
    setup.tab('build');
  },
  (o) => {
    enterCareer(o);
    careerScr.hide();
    menu.hideAll();
    start(match.seed);
  },
  (cap) => {
    const c = setup.cap;
    setup.cap = cap;
    const ok = setup.legal;
    setup.cap = c;
    return ok;
  },
  () => (Math.random() * 4294967296) >>> 0,
  () => setup.robot().name,
);
menu.onCareer = () => careerScr.open();
/** 換季：還沒領的獎勵自動發、星星歸零。回傳要跟玩家說的話（沒換季是 null） */
function seasonRoll(): string | null {
  const r = rollover(progress.season, dailyDay(), progress.owned, progress.wallet, new Rng((Math.random() * 4294967296) >>> 0));
  if (!r) return null;
  saveProgress(progress);
  return `🎫 ${seasonName(r.from)} 結束（第 ${r.tier} 階）${r.got.length ? `，沒領的 ${r.got.length} 個獎勵已經發給你` : ''}。新賽季開始！`;
}
let seasonNote = seasonRoll();
menu.onHub = () => {
  seasonNote ??= seasonRoll();
  if (seasonNote) {
    menu.toast(seasonNote, 5000);
    seasonNote = null;
  }
};
document.getElementById('cHub')!.addEventListener('click', goHub);
/** 打完生涯戰回生涯畫面 */
function backToCareer(): void {
  leaveCareer();
  openSetup();
  setup.hide();
  hud.showRules(false);
  menu.showHub();
  careerScr.open();
}
/** 這一場玩家用的設定。開打時凍結（含模型快照和性格），重播才會一模一樣。 */
let playerSetup: RobotSetup = setup.robot();
// 每日挑戰：今天的對手和種子（全世界一樣）。包成和天梯對手一樣的形狀
const daily = dailyFor(dailyDay());
const dailyFoe: Opponent = { id: 'daily', setup: daily.foe, bio: '', prize: '' };
setup.daily = daily;
setup.refreshFoes();
/** 正在打的聯盟戰（伺服器已經算好結果，這裡是把同一場播出來）。不是聯盟戰就是 null */
let leagueFight: FightResult | null = null;
const league = new League(
  () => ({ setup: setup.robot(), legal: setup.legal }),
  (r) => {
    leagueFight = r;
    start(r.seed);
  },
);
league.refresh();
/** 設定畫面現在選的對手 */
function pickedFoe(): Opponent {
  if (careerOffer && progress.career) return { id: 'career', setup: fighterSetup(progress.career, careerOffer.foe, careerOffer.at), bio: '', prize: '' };
  return setup.foe < 0 ? dailyFoe : LADDER[setup.foe];
}
/** 這一場的對手（重播時沿用） */
let foe: Opponent = pickedFoe();
/** 這一場是重播：不算戰績、不成長 */
let isReplay = false;
let grown = false;
/** 教練的場邊筆記：這一場打中幾拳、挨了幾拳、沒電幾次 */
let fightLog = newLog();
/**
 * K.O. 的慢動作重播：比賽結束後，用同一個種子從頭重跑到 K.O. 前一刻，再用慢動作、換個鏡位播一次。
 * 戰鬥邏輯是純函式，所以重跑出來的和剛剛那一場一模一樣。純畫面，不影響戰績。
 */
let replayPlan: { from: number; to: number } | null = null;
let replayMatch: Match | null = null;
let replayTo = 0;

/** 不播了（開新的一場、回設定畫面） */
function cancelReplay(): void {
  replayMatch = null;
  replayPlan = null;
  director.replay = false;
  hud.replay(false);
}

/** 重播播完或被跳過：攤開賽後畫面 */
function endReplay(): void {
  if (!replayMatch) return;
  cancelReplay();
  hud.openResult(250);
}
/** 從分享連結進來的重播（網址 #r=…）。有的話先看這一場，不進設定畫面。 */
let shared: Replay | null = location.hash.startsWith('#r=') ? decodeReplay(location.hash.slice(3)) : null;
let verified = false;

/** 這一場兩邊的設定 */
function currentSetups(): [RobotSetup, RobotSetup] {
  return shared ? shared.setups : [playerSetup, foe.setup];
}

function newMatch(seed: number): Match {
  const m = createMatch(seed, currentSetups());
  // 外觀跟著裝備換（陣列原地改，導播手上拿的是同一個陣列）
  const [sa, sb] = currentSetups();
  models.robots[0] = buildRobotModels(RED_TEAM, m.robots[0].spec.loadout, sa.look, !shared && foe.id === 'career' ? careerPatches() : []);
  models.robots[1] = buildRobotModels(BLUE_TEAM, m.robots[1].spec.loadout, sb.look);
  hud.spectate = shared !== null;
  // 開打前的對照表：玩家是戰績和排名，對手是它在排名戰的位置
  const beaten = LADDER.filter((o) => (progress.record[o.id]?.w ?? 0) > 0).length;
  const won = LADDER.reduce((n, o) => n + (progress.record[o.id]?.w ?? 0), 0);
  const lost = LADDER.reduce((n, o) => n + (progress.record[o.id]?.l ?? 0), 0);
  const li = LADDER.indexOf(foe);
  const cc = progress.career;
  hud.tapeLines = shared
    ? ['紅方', '藍方']
    : foe.id === 'career' && cc && careerOffer
      ? [
          `${DIVISIONS[cc.div].icon} ${cc.defenses >= 0 ? '世界冠軍' : myRank(cc) >= cc.table.length ? '新人' : `第 ${myRank(cc)} 名`}・${cc.w} 勝 ${cc.l} 敗` +
            cc.sp.contracts.map((c) => SPONSOR[c.id]?.icon ?? '').join(''),
          careerOffer.at < 0 ? '新面孔' : careerOffer.at === 0 ? '👑 冠軍' : `第 ${careerOffer.at + 1} 名`,
        ]
      : [
        `${won} 勝 ${lost} 敗・${rankText(beaten)}`,
        li >= 0 ? (li === LADDER.length - 1 ? '👑 冠軍' : `排名第 ${LADDER.length - li}`) : foe.id === 'daily' ? '每日挑戰' : foe.id === 'league' ? '聯盟守擂' : '',
        ];
  hud.reset(m);
  // 看分享的重播時不動網址（連結要留著）
  if (!shared) {
    const url = new URL(location.href);
    url.searchParams.set('seed', String(seed));
    url.hash = '';
    history.replaceState(null, '', url);
  }
  return m;
}

let match = newMatch(shared ? shared.seed : Number(new URLSearchParams(location.search).get('seed')) || 1);
let running = false;

function start(seed: number, replay = false, sameFoe = false): void {
  audio.unlock();
  closeCorner();
  cancelReplay();
  // 新的一場用最新的模型和性格；重播用上一場凍結的那一份
  if (!replay && leagueFight) {
    // 聯盟戰：兩邊的設定和種子都照伺服器給的，畫面上才會和伺服器算的是同一場
    playerSetup = leagueFight.attacker;
    foe = { id: 'league', setup: leagueFight.defender, bio: '', prize: '' };
    seed = leagueFight.seed;
  } else if (!replay) {
    careerReturn = false;
    playerSetup = setup.robot();
    // 「再打一場」打同一個對手；從設定畫面開打才換成選的那個
    if (!sameFoe) foe = pickedFoe();
    // 每日挑戰永遠用當天的種子；生涯戰用存檔種子加週數（同一週重打是同一場）
    if (foe === dailyFoe) seed = daily.seed;
    if (foe.id === 'career' && progress.career) seed = fightSeed(progress.career);
  }
  isReplay = replay || shared !== null;
  grown = false;
  verified = false;
  shareBox.classList.add('hidden');
  hud.showGrowth([]);
  match = newMatch(seed);
  commentator.reset(match.seed);
  misfire.reset(match.seed);
  tutorial.onStart();
  fx.calm();
  fightLog = newLog();
  acc = 0;
  running = true;
  setup.hide();
  hud.showRules(true);
}

/** 賽後「本場最佳失誤」那一行（順便把結算資料存起來）；這場沒有失誤就是 null */
function bestMisfireLine(): string | null {
  fightReport = { seed: match.seed, setups: currentSetups(), misfires: [...misfire.records] };
  const best = misfire.best();
  if (!best) return null;
  const n = misfire.records.length;
  const owner = shared ? `${match.robots[best.robot].spec.name} 的` : best.robot === 0 ? '你的' : '對手的';
  return `🤡 本場最佳失誤：${MisfireShow.describe(best, owner)}（全場失誤 ${n} 次）`;
}

/** 一場打完：性格漂移、自訓模型學習，存檔，並把變化列在賽後畫面上 */
function grow(): void {
  grown = true;
  if (isReplay) {
    const best = bestMisfireLine();
    hud.showGrowth([...(best ? [best] : []), ...(shared ? [] : ['這是重播，不會成長。'])]);
    return;
  }
  const before = progress.temper;
  const g = growFrom(match, 0, progress.model, progress.temper);
  progress.model = g.model;
  progress.temper = g.temper;
  progress.fights++;

  // 戰績和掉卡
  const lines: string[] = [];
  let careerPay = -1;
  if (leagueFight) {
    // 聯盟戰：積分是伺服器算的，這裡只是把結果講出來
    const r = leagueFight;
    const diff = r.after - r.before;
    lines.push(`🏟 聯盟：${r.winner === 0 ? '挑戰成功' : r.winner === 1 ? '挑戰失敗' : '平手'}・積分 ${r.before} → ${r.after}（${diff >= 0 ? '+' : ''}${diff}）`);
    if ((match.winner ?? -1) !== r.winner) lines.push('⚠ 畫面上的結果和伺服器算的不一樣：遊戲版本可能和伺服器不同，積分以伺服器為準。');
  } else if (foe === dailyFoe) {
    // 每日挑戰：不算天梯戰績，算分數和連續天數；打贏一樣算進總勝場、一樣可能掉卡
    const d = progress.daily;
    d.tries++;
    const sc = dailyScore(match, playerSetup);
    if (sc.total > 0) {
      if (d.lastWin !== daily.day) {
        d.streak = d.lastWin === daily.day - 1 ? d.streak + 1 : 1;
        d.lastWin = daily.day;
      }
      const record = sc.total > d.best;
      d.best = Math.max(d.best, sc.total);
      lines.push(`📅 每日挑戰：${sc.total} 分${record ? '（今日新高）' : `（今日最佳 ${d.best}）`}・連續 ${d.streak} 天`);
      lines.push(`　打贏 ${sc.win}・省下的額度 +${sc.thrift}・剩下的血 +${sc.health}・剩下的時間 +${sc.speed}`);
      lines.push('　想拿更高分：換便宜一點的配法再打贏一次。');
      progress.wins++;
      const got = grantForWin(progress.owned, { foeName: foe.setup.name, prize: '', firstWin: false, foeCardUses: match.brains[1].cardUses, totalWins: progress.wins });
      progress.owned = got.owned;
      for (const drop of got.drops) lines.push(`🃏 拿到新卡「${CARDS[drop.card].name}」（${drop.why}）`);
    } else lines.push('📅 每日挑戰：這次沒打贏，0 分。對手和種子不會變，換個配法再試。');
  } else if (foe.id === 'career' && careerOffer && progress.career) {
    // 生涯戰：名次、人氣、出場費都照生涯規則；打贏一樣可能掉卡
    const ko = match.method === 'KO' || match.method === 'TKO';
    const me = match.robots[0];
    const r = finishFight(progress.career, careerOffer, match.winner ?? -1, match.method, playerSetup.name, {
      won: match.winner === 0,
      koWin: match.winner === 0 && ko,
      koLoss: match.winner === 1 && ko,
      round: match.round,
      landed: fightLog.landed,
      taken: fightLog.taken,
      heavyLanded: fightLog.heavyLanded,
      counters: fightLog.counters,
      dealt: fightLog.dealt,
      downs: fightLog.downs,
      gassed: fightLog.gassed,
      hpFrac: me.hp / me.spec.maxHp,
    });
    careerPay = r.coins;
    careerScr.last = match.winner === 0 ? true : match.winner === 1 ? false : null;
    lines.push(...r.lines.map((l) => '🌟 ' + l));
    if (match.winner === 0) {
      progress.wins++;
      const got = grantForWin(progress.owned, { foeName: foe.setup.name, prize: '', firstWin: false, foeCardUses: match.brains[1].cardUses, totalWins: progress.wins });
      progress.owned = got.owned;
      for (const d of got.drops) lines.push(`🃏 拿到新卡「${CARDS[d.card].name}」（${d.why}）`);
    }
    careerOffer = null;
    careerReturn = true;
  } else if (match.winner === 0) {
    const rec = (progress.record[foe.id] ??= { w: 0, l: 0 });
    const firstWin = rec.w === 0;
    rec.w++;
    progress.wins++;
    const got = grantForWin(progress.owned, {
      foeName: foe.setup.name,
      prize: foe.prize,
      firstWin,
      foeCardUses: match.brains[1].cardUses,
      totalWins: progress.wins,
    });
    progress.owned = got.owned;
    for (const d of got.drops) lines.push(`🃏 拿到新卡「${CARDS[d.card].name}」（${d.why}）`);
    const next = LADDER[LADDER.indexOf(foe) + 1];
    // 第一次打贏：設定畫面直接跳到下一個對手
    if (firstWin && next) setup.foe = LADDER.indexOf(next);
    if (firstWin) lines.push(next ?`🔓 可以挑戰下一個對手：${next.setup.name}` : '🏆 五個對手全部打贏了！');
  } else if (match.winner === 1) (progress.record[foe.id] ??= { w: 0, l: 0 }).l++;
  // 晶片幣：輸了也有，打贏比較多；聯盟戰和每日挑戰另外加
  const pay = careerPay >= 0 ? careerPay :
    (match.winner === 0 ? INCOME.win : match.winner === 1 ? INCOME.loss : INCOME.draw) +
    (leagueFight ? INCOME.league : 0) +
    (foe === dailyFoe && match.winner === 0 ? INCOME.daily : 0);
  progress.wallet.coins += pay;
  lines.unshift(`🪙 晶片幣 +${pay}（現在 ${progress.wallet.coins}）`);
  // 生涯的那幾行放在最前面（名次、腰帶比較重要）
  if (careerPay >= 0) {
    const cl = lines.filter((l) => l.startsWith('🌟 '));
    const rest = lines.filter((l) => !l.startsWith('🌟 ') && !l.startsWith('🪙'));
    lines.splice(0, lines.length, ...cl.map((l) => l.slice(3)), ...rest);
  }
  // 賽季星星（任何模式都有；換季的話先結算上一季）
  const roll = seasonRoll();
  if (roll) lines.push(roll);
  const mode = leagueFight ? 'league' : foe === dailyFoe ? 'daily' : careerPay >= 0 ? 'career' : 'solo';
  const sg = addStars(progress.season, match.winner ?? -1, match.method === 'KO' || match.method === 'TKO', mode, dailyDay());
  const st = tierOf(progress.season.stars);
  // 升階的那一行放在第二行（賽後只直接顯示前四行）
  if (sg.tiersUp > 0) lines.splice(1, 0, `🎉 賽季升到第 ${st} 階！${rewardIcon(ROAD[st - 1])} ${rewardText(ROAD[st - 1])}（大廳「🎫 賽季獎勵」領取）`);
  lines.push(`🎫 賽季 +${sg.stars}⭐（${sg.parts.join('・')}）` + (st < TIERS ? `，第 ${st + 1} 階還差 ${(st + 1) * STARS_PER_TIER - progress.season.stars}⭐` : ''));
  // 本場最佳失誤：放在第二行，賽後畫面一眼看得到
  const best = bestMisfireLine();
  if (best) lines.splice(Math.min(1, lines.length), 0, best);
  saveProgress(progress);

  for (const tip of advice(fightLog, match, playerSetup, progress.owned)) lines.push('🤖 AI 教練：' + tip);

  const drift = AXES.filter((a) => Math.abs(g.temper[a] - before[a]) > 0.002).map(
    (a) => (g.temper[a] > before[a] ? AXIS_TEXT[a].high : AXIS_TEXT[a].low) + ' ▲',
  );
  if (drift.length) lines.push('🧬 性格：' + drift.join('　'));
  const ch = g.learned.changes;
  const gains = shownChanges(ch).map(
    (k) => `${ACTION_TEXT[k as keyof typeof ACTION_TEXT]} ${pct(ch[k][0])} → ${pct(ch[k][1])}`,
  );
  if (gains.length) lines.push('🧠 自訓模型：' + gains.join('、'));
  hud.showGrowth(lines);
}

/** 回到賽前設定：畫面停在開場，等玩家換卡 */
function openSetup(): void {
  running = false;
  closeCorner();
  cancelReplay();
  fx.calm();
  // 離開分享的重播，回到自己的機器人
  shared = null;
  leagueFight = null;
  league.refresh();
  viewer.classList.add('hidden');
  rerollBtn.classList.remove('hidden');
  backBtn.textContent = '繼續';
  playerSetup = setup.robot();
  foe = pickedFoe();
  match = newMatch(match.seed);
  setup.refresh();
  commentator.reset(match.seed);
  misfire.reset(match.seed);
  hud.showRules(false);
  setup.show();
  tutorial.maybeTour();
}

/** 空白鍵／搖桿 A：在設定畫面就開打，打完就同卡組再打一場 */
function primaryAction(): void {
  if (replayMatch) endReplay();
  else if (cornerLeft > 0) closeCorner();
  else if (!viewer.classList.contains('hidden')) watch();
  else if (tutorial.welcoming || menu.visible) return;
  else if (setup.visible) {
    if (setup.legal) start(match.seed);
  } else if (match.phase === 'over' && careerReturn) backToCareer();
  else if (match.phase === 'over' && !shared && !leagueFight) start(match.seed + 1, false, true);
}

const viewer = document.getElementById('viewer')!;
const shareBox = document.getElementById('shareBox')!;
const shareLink = document.getElementById('shareLink') as HTMLInputElement;
const shareMsg = document.getElementById('shareMsg')!;
const rerollBtn = document.getElementById('reroll')!;
const rerollText = rerollBtn.textContent;
const backBtn = document.getElementById('back')!;

/** 開始看分享的重播 */
function watch(): void {
  if (!shared) return;
  viewer.classList.add('hidden');
  rerollBtn.classList.add('hidden');
  backBtn.textContent = '我也要玩';
  start(shared.seed, true);
}

/** 把這一場包成連結。指紋用無畫面重跑一次算出來，和現在畫面播到哪裡無關。 */
function shareThis(): void {
  const setups = currentSetups();
  const hash = matchHash(runToEnd(createMatch(match.seed, setups)));
  const code = encodeReplay({ seed: match.seed, setups, hash });
  const link = `${location.origin}${location.pathname}#r=${code}`;
  shareLink.value = link;
  shareBox.classList.remove('hidden');
  shareMsg.textContent = '把這個連結傳給朋友，他打開就能看到同一場：';
  shareLink.select();
  navigator.clipboard?.writeText(link).then(
    () => (shareMsg.textContent = '連結已經複製了。傳給朋友，他打開就能看到同一場：'),
    () => undefined,
  );
}

const controls = new CameraControls(canvas, renderer.cam, primaryAction);
document.getElementById('share')!.addEventListener('click', shareThis);
document.getElementById('viewerPlay')!.addEventListener('click', watch);
document.getElementById('viewerSkip')!.addEventListener('click', () => {
  openSetup();
  goHub();
});
document.getElementById('edit')!.addEventListener('click', openSetup);
document.getElementById('back')!.addEventListener('click', () => (careerReturn ? backToCareer() : openSetup()));
// 賽後請 AI 教練調整：回選手營，直接跑陪練模擬
const coachFix = document.getElementById('coachFix')!;
coachFix.addEventListener('click', () => {
  openSetup();
  setup.tab('camp');
  void setup.runCoach();
});
canvas.addEventListener('pointerdown', () => {
  if (replayMatch) endReplay();
});
document.getElementById('again')!.addEventListener('click', () => start(match.seed, true));
document.getElementById('reroll')!.addEventListener('click', () => {
  // 聯盟戰不能「再打一場」：要回設定畫面重新挑戰，伺服器才會算
  if (leagueFight) openSetup();
  else if (careerReturn) backToCareer();
  else start(match.seed + 1, false, true);
});
// 快轉：只是讓邏輯跑快一點，結果不變。網址加 ?speed=8 可以直接指定（測試用）；?speed=0.1 是慢動作，看動作細節用。
const speedBtn = document.getElementById('speed')!;
let speed = Math.max(0.05, Math.min(32, Number(new URLSearchParams(location.search).get('speed')) || 1));
speedBtn.textContent = `⏩ ×${speed}`;
speedBtn.addEventListener('click', () => {
  speed = speed >= 4 ? 1 : speed * 2;
  speedBtn.textContent = `⏩ ×${speed}`;
});
// 開發用：在主控台 __speed(0.1) 可以隨時切慢動作（正式版不會有這一段）
if (import.meta.env.DEV) (window as unknown as { __speed: (n: number) => void }).__speed = (n) => (speed = n);
if (import.meta.env.DEV)
  (window as unknown as { __dbg: () => unknown }).__dbg = () => ({
    cam: { ...renderer.cam },
    focus: [fx.focus, fx.focusX, fx.focusY, fx.timeScale, fx.hitStop],
    replay: replayMatch ? replayMatch.tick : null,
    to: replayTo,
    tick: match.tick,
    phase: match.phase,
    round: match.round,
    method: match.method,
    winner: match.winner,
    seed: match.seed,
    hash: matchHash(match),
    misfires: fightReport?.misfires.map((r) => `${r.tick}:${r.robot}:${r.kind}:${r.actual}:${r.ticks}${r.shown ? '*' : ''}`),
    bots: (replayMatch ?? match).robots.map((r) => ({ action: r.action, t: r.actionTicks, ...puppetInfo(r) })),
  });
const voiceBtn = document.getElementById('voice')!;
// 開發時才顯示種子、tick、fps
if (import.meta.env.DEV) document.body.classList.add('dev');
// 規則面板：平常只顯示正在用的那一條，點一下展開全部
const rulesEl = document.getElementById('rules')!;
rulesEl.classList.add('compact');
rulesEl.addEventListener('click', () => rulesEl.classList.toggle('compact'));
// 轉播語音用瀏覽器內建的語音合成，沒有的瀏覽器就不顯示這顆按鈕
if (typeof speechSynthesis === 'undefined') voiceBtn.classList.add('hidden');
voiceBtn.addEventListener('click', () => {
  commentator.voice = !commentator.voice;
  if (!commentator.voice) speechSynthesis.cancel();
  voiceBtn.textContent = commentator.voice ? '🗣 開' : '🗣 關';
});
muteBtn.addEventListener('click', () => {
  audio.unlock();
  audio.setMuted(!audio.muted);
  muteBtn.textContent = audio.muted ? '🔇' : '🔊';
});

// 從分享連結進來：先問要不要看（瀏覽器規定要有點擊才能出聲）
if (shared) {
  setup.hide();
  const names = document.getElementById('viewerNames')!;
  const [a, b] = shared.setups;
  const line = (text: string, cls: string): HTMLElement => {
    const d = document.createElement('div');
    d.className = cls;
    d.textContent = text;
    return d;
  };
  names.replaceChildren(line(a.name, 'red'), line('對', 'vs'), line(b.name, 'blue'));
  viewer.classList.remove('hidden');
} else {
  // 一打開先是首頁
  setup.hide();
  menu.showTitle();
  if (location.hash.startsWith('#r=')) window.alert('這個分享連結看不懂（可能是舊版遊戲產生的，或不完整）。');
}

const TICK = 1 / TICK_HZ;
let last = performance.now();
let acc = 0;
let time = 0;
let frameNo = 0;
let frames = 0;
let renderMs = 0;
let statTimer = 0;
let inMenu = false;

// ---------------------------------------------------------------- 角落指示
/**
 * 單人模式的局間休息：比賽暫停，玩家可以改下一回合的戰術。
 * 改的是還沒開始的回合，改完把計畫寫回這一場的設定，重播和分享才會一模一樣。
 */
const CORNER_SECONDS = 7;
const cornerEl = document.getElementById('corner')!;
let cornerLeft = 0;
function cornerAllowed(): boolean {
  return running && !isReplay && !shared && !leagueFight && !replayMatch && match.phase === 'break' && match.round < ROUNDS;
}
function openCorner(): void {
  const next = match.round + 1;
  const foeNow = match.robots[1].tactic;
  const planned = match.plans[0][next - 1];
  document.getElementById('cornerRound')!.textContent = `第 ${next} 回合要怎麼打？`;
  document.getElementById('cornerFoe')!.textContent = `對手這回合：${TACTICS[foeNow].icon} ${TACTICS[foeNow].name}`;
  const btns = TACTIC_LIST.map((t) => {
    const b = document.createElement('button');
    b.className = `tacBtn t-${t}` + (t === planned ? ' on' : '');
    const name = document.createElement('b');
    name.textContent = `${TACTICS[t].icon} ${TACTICS[t].name}`;
    b.append(name);
    const note = document.createElement('span');
    note.textContent = t === planned ? '照計畫' : beats(t, foeNow) ? `剋${TACTICS[foeNow].name}` : '';
    b.append(note);
    b.addEventListener('click', () => {
      if (setTactic(match, 0, next, t)) playerSetup = { ...playerSetup, plan: [...match.plans[0]] };
      closeCorner();
    });
    return b;
  });
  document.getElementById('cornerBtns')!.replaceChildren(...btns);
  cornerEl.classList.remove('hidden');
  cornerLeft = CORNER_SECONDS;
}
function closeCorner(): void {
  cornerLeft = 0;
  cornerEl.classList.add('hidden');
}
/** 畫面現在有沒有收黑邊 */
let cine = false;

function updateCamera(dt: number): void {
  const cam = renderer.cam;
  const [a, b] = (replayMatch ?? match).robots;
  const dist = Math.hypot(a.x - b.x, a.y - b.y);
  // 兩台離得遠就拉遠，貼身就推近；玩家的縮放是在這上面再乘一個倍率
  const auto = Math.max(0.95 * RES, Math.min(2 * RES, BUF_W / (dist + 125)));
  // 導播鏡位：像轉播一樣從側面拍，兩台一左一右。貼太近時方向不穩，就維持原本的角度。
  const shown = replayMatch ?? match;
  // 重播時換到斜後方的鏡位，和剛剛看到的角度不一樣
  controls.auto =
    running && shown.phase !== 'over' && dist > 16 ? -Math.atan2(b.y - a.y, b.x - a.x) + (replayMatch ? 0.95 : 0) : running ? controls.angle : null;
  const zoom = Math.max(0.75 * RES, Math.min(4 * RES, auto * controls.zoom * (1 + fx.zoomKick) * (1 + fx.focus * 0.4)));
  const k = 1 - Math.exp(-dt * 5);
  cam.zoom += (zoom - cam.zoom) * k;
  // 鏡頭只跟一部分，擂台才不會晃得太厲害
  // 特寫：往被打倒的那一台靠過去
  const cx = ((a.x + b.x) / 2) * 0.9;
  const cy = ((a.y + b.y) / 2) * 0.9;
  cam.x += (cx + (fx.focusX - cx) * fx.focus - cam.x) * k;
  cam.y += (cy + (fx.focusY - cy) * fx.focus - cam.y) * k;
  cam.shakeX = fx.shakeX;
  cam.shakeY = fx.shakeY;
}

function frame(now: number): void {
  const dt = Math.max(0, Math.min(0.1, (now - last) / 1000));
  last = now;
  time += dt;
  frameNo++;

  // 戰鬥邏輯固定 60Hz，和畫面更新率無關。頓幀只是暫停推進，不影響結果。
  if (running) {
    // K.O. 之後等倒地的畫面播完，開始慢動作重播
    if (replayPlan && !replayMatch && match.phase === 'over' && match.phaseTicks >= 95) {
      const m = createMatch(match.seed, currentSetups());
      while (m.tick < replayPlan.from) stepMatch(m);
      replayMatch = m;
      replayTo = replayPlan.to;
      replayPlan = null;
      director.replay = true;
      hud.replay(true);
      fx.calm();
      acc = 0;
    }
    if (replayMatch) {
      // 重播固定用慢動作，鏡頭一直特寫被打倒的那一台
      fx.slow(0.3, 0.1);
      const loser = replayMatch.robots[match.winner === 0 ? 1 : 0];
      fx.focusOn(loser.x, loser.y, 0.55);
    }
    // 頓幀用真實時間算（不然慢動作的時候會頓很久）；其他時候照速度和慢動作倍率推進
    if (cornerLeft > 0) {
      // 角落指示：比賽暫停等玩家選，時間到就照原本的計畫
      cornerLeft -= dt;
      (document.getElementById('cornerBar') as HTMLElement).style.width = `${(Math.max(0, cornerLeft) / CORNER_SECONDS) * 100}%`;
      if (cornerLeft <= 0) closeCorner();
    } else if (fx.hitStop > 0) fx.hitStop = Math.max(0, fx.hitStop - dt * TICK_HZ * Math.max(1, speed));
    else acc += dt * (replayMatch ? 1 : speed) * fx.timeScale;
    while (acc >= TICK) {
      acc -= TICK;
      if (replayMatch) {
        stepMatch(replayMatch);
        director.onTick(replayMatch);
        if (replayMatch.tick >= replayTo) endReplay();
        if (fx.hitStop > 0) {
          acc = 0;
          break;
        }
        continue;
      }
      stepMatch(match);
      // 失誤演出要在導播前面：比賽結束那一刻導播會攤開賽後解讀，觸發次數要先算好
      misfire.cinematic = speed <= 2;
      misfire.onTick(match);
      if (match.events.some((e) => e.type === 'misfire')) hud.quirkHits = misfire.quirkCounts();
      director.onTick(match);
      commentator.onTick(match);
      logTick(fightLog, match, 0);
      if (!isReplay) tutorial.onTick(match);
      if (match.phase === 'over' && !grown) grow();
      // 比賽結束：K.O. 的話先排一段慢動作重播，再攤開賽後畫面；快轉中就不播了
      if (match.events.some((e) => e.type === 'end')) {
        // K.O. 和 TKO 都重播：多播一段，看得到整個人倒下去
        const ko = match.method === 'KO' || match.method === 'TKO';
        if (ko && speed <= 2) replayPlan = { from: Math.max(1, match.tick - 60), to: match.tick + 75 };
        else hud.openResult(2400);
        coachFix.classList.toggle('hidden', shared !== null || leagueFight !== null || careerReturn);
        // 生涯戰的「再打一場」是回生涯畫面接下一週的比賽
        rerollBtn.textContent = careerReturn ? '🌟 生涯' : rerollText;
        if (careerReturn) backBtn.textContent = '下一週 ▶';
        rerollBtn.classList.toggle('hidden', careerReturn || shared !== null);
      }
      // 分享的重播跑完：和原本那場的指紋比對
      if (match.done && shared && !verified) {
        verified = true;
        const best = bestMisfireLine();
        if (shared.hash !== null)
          hud.showGrowth([
            matchHash(match) === shared.hash
              ? '✔ 這場和分享的人看到的完全一樣。'
              : '⚠ 這場和原本的結果不一樣：連結可能是舊版遊戲產生的，或被改過。',
            ...(best ? [best] : []),
          ]);
      }
      if (match.events.some((e) => e.type === 'bell') && cornerAllowed()) {
        openCorner();
        acc = 0;
        break;
      }
      if (fx.hitStop > 0) {
        acc = 0;
        break;
      }
    }
    director.onFrame(replayMatch ?? match, frameNo);
  }
  if (cine !== (running && fx.cinematic)) {
    cine = running && fx.cinematic;
    document.body.classList.toggle('cinema', cine);
  }

  controls.update(dt, renderer.cam);
  fx.update(dt);
  crowd.update(dt);
  commentator.update(dt);
  misfire.onFrame(match, dt, running && !replayMatch && !menu.visible && !setup.visible);
  hud.misfire = [misfire.status(0, match), misfire.status(1, match)];
  tutorial.update(dt);
  updateCamera(dt);
  hud.update(match, dt);

  if (setup.visible || menu.hubVisible) setup.preview.draw(dt, time);
  // 首頁和大廳時藏起戰鬥介面
  if (inMenu !== menu.visible) {
    inMenu = menu.visible;
    document.body.classList.toggle('inmenu', inMenu);
  }

  const t0 = performance.now();
  drawScene(renderer, replayMatch ?? match, models, fx, crowd, time, dt * Math.min(1, speed) * fx.timeScale);
  renderMs += performance.now() - t0;
  bufferCtx.putImageData(renderer.image, 0, 0);
  ctx.drawImage(buffer, 0, 0, canvas.width, canvas.height);

  frames++;
  statTimer += dt;
  if (statTimer >= 0.5) {
    stats.textContent = `seed ${match.seed} · tick ${match.tick} · ${Math.round(frames / statTimer)} fps · 繪製 ${(renderMs / frames).toFixed(1)} ms`;
    frames = 0;
    renderMs = 0;
    statTimer = 0;
  }
}
function loop(now: number): void {
  frame(now);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
// 開發用：不等瀏覽器，直接連跑 n 幀（預覽視窗在背景時畫面更新很慢，測試用這個）
if (import.meta.env.DEV)
  (window as unknown as { __frames: (n: number) => void }).__frames = (n) => {
    for (let i = 0; i < n; i++) frame(last + 1000 / 60);
  };
