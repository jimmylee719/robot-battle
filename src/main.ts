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
import { BLUE_TEAM, buildRobotModels, RED_TEAM } from './models/robot';
import { drawScene, type SceneModels } from './view/scene';
import { Fx } from './view/fx';
import { Crowd } from './view/crowd';
import { Commentator } from './view/commentary';
import { Hud } from './view/hud';
import { pct, SetupScreen, shownChanges } from './view/setup';
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

/** 低解析度緩衝區大小。所有東西都先畫在這裡，再整數倍放大。 */
const BUF_W = 320;
const BUF_H = 180;

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
renderer.cam.zoom = 1.4;
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
  () => setup.show(),
);
/** 這一場玩家用的設定。開打時凍結（含模型快照和性格），重播才會一模一樣。 */
let playerSetup: RobotSetup = setup.robot();
// 每日挑戰：今天的對手和種子（全世界一樣）。包成和天梯對手一樣的形狀
const daily = dailyFor(dailyDay());
const dailyFoe: Opponent = { id: 'daily', setup: daily.foe, bio: '', prize: '' };
setup.daily = daily;
setup.refreshFoes();
/** 設定畫面現在選的對手 */
function pickedFoe(): Opponent {
  return setup.foe < 0 ? dailyFoe : LADDER[setup.foe];
}
/** 這一場的對手（重播時沿用） */
let foe: Opponent = pickedFoe();
/** 這一場是重播：不算戰績、不成長 */
let isReplay = false;
let grown = false;
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
  models.robots[0] = buildRobotModels(RED_TEAM, m.robots[0].spec.loadout, sa.look);
  models.robots[1] = buildRobotModels(BLUE_TEAM, m.robots[1].spec.loadout, sb.look);
  hud.spectate = shared !== null;
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
  // 新的一場用最新的模型和性格；重播用上一場凍結的那一份
  if (!replay) {
    playerSetup = setup.robot();
    // 「再打一場」打同一個對手；從設定畫面開打才換成選的那個
    if (!sameFoe) foe = pickedFoe();
    // 每日挑戰永遠用當天的種子
    if (foe === dailyFoe) seed = daily.seed;
  }
  isReplay = replay || shared !== null;
  grown = false;
  verified = false;
  shareBox.classList.add('hidden');
  hud.showGrowth([]);
  match = newMatch(seed);
  commentator.reset();
  tutorial.onStart();
  fx.hitStop = 0;
  acc = 0;
  running = true;
  setup.hide();
  hud.showRules(true);
}

/** 一場打完：性格漂移、自訓模型學習，存檔，並把變化列在賽後畫面上 */
function grow(): void {
  grown = true;
  if (isReplay) {
    hud.showGrowth(shared ? [] : ['這是重播，不會成長。']);
    return;
  }
  const before = progress.temper;
  const g = growFrom(match, 0, progress.model, progress.temper);
  progress.model = g.model;
  progress.temper = g.temper;
  progress.fights++;

  // 戰績和掉卡
  const lines: string[] = [];
  if (foe === dailyFoe) {
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
  saveProgress(progress);

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
  // 離開分享的重播，回到自己的機器人
  shared = null;
  viewer.classList.add('hidden');
  rerollBtn.classList.remove('hidden');
  backBtn.textContent = '換卡';
  playerSetup = setup.robot();
  foe = pickedFoe();
  match = newMatch(match.seed);
  setup.refresh();
  commentator.reset();
  hud.showRules(false);
  setup.show();
  tutorial.maybeTour();
}

/** 空白鍵／搖桿 A：在設定畫面就開打，打完就同卡組再打一場 */
function primaryAction(): void {
  if (!viewer.classList.contains('hidden')) watch();
  else if (tutorial.welcoming) return;
  else if (setup.visible) {
    if (setup.legal) start(match.seed);
  } else if (match.phase === 'over' && !shared) start(match.seed + 1, false, true);
}

const viewer = document.getElementById('viewer')!;
const shareBox = document.getElementById('shareBox')!;
const shareLink = document.getElementById('shareLink') as HTMLInputElement;
const shareMsg = document.getElementById('shareMsg')!;
const rerollBtn = document.getElementById('reroll')!;
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
document.getElementById('viewerSkip')!.addEventListener('click', openSetup);
document.getElementById('edit')!.addEventListener('click', openSetup);
document.getElementById('back')!.addEventListener('click', openSetup);
document.getElementById('again')!.addEventListener('click', () => start(match.seed, true));
document.getElementById('reroll')!.addEventListener('click', () => start(match.seed + 1, false, true));
// 快轉：只是讓邏輯跑快一點，結果不變。網址加 ?speed=8 可以直接指定（測試用）；?speed=0.1 是慢動作，看動作細節用。
const speedBtn = document.getElementById('speed')!;
let speed = Math.max(0.05, Math.min(32, Number(new URLSearchParams(location.search).get('speed')) || 1));
speedBtn.textContent = `速度 ×${speed}`;
speedBtn.addEventListener('click', () => {
  speed = speed >= 4 ? 1 : speed * 2;
  speedBtn.textContent = `速度 ×${speed}`;
});
// 開發用：在主控台 __speed(0.1) 可以隨時切慢動作（正式版不會有這一段）
if (import.meta.env.DEV) (window as unknown as { __speed: (n: number) => void }).__speed = (n) => (speed = n);
const voiceBtn = document.getElementById('voice')!;
// 轉播語音用瀏覽器內建的語音合成，沒有的瀏覽器就不顯示這顆按鈕
if (typeof speechSynthesis === 'undefined') voiceBtn.classList.add('hidden');
voiceBtn.addEventListener('click', () => {
  commentator.voice = !commentator.voice;
  if (!commentator.voice) speechSynthesis.cancel();
  voiceBtn.textContent = commentator.voice ? '轉播語音：開' : '轉播語音：關';
});
muteBtn.addEventListener('click', () => {
  audio.unlock();
  audio.setMuted(!audio.muted);
  muteBtn.textContent = audio.muted ? '音效：關' : '音效：開';
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
} else if (tutorial.stage === 0) {
  setup.hide();
  tutorial.showWelcome();
} else if (location.hash.startsWith('#r=')) {
  window.alert('這個分享連結看不懂（可能是舊版遊戲產生的，或不完整）。');
}

const TICK = 1 / TICK_HZ;
let last = performance.now();
let acc = 0;
let time = 0;
let frameNo = 0;
let frames = 0;
let renderMs = 0;
let statTimer = 0;

function updateCamera(dt: number): void {
  const cam = renderer.cam;
  const [a, b] = match.robots;
  const dist = Math.hypot(a.x - b.x, a.y - b.y);
  // 兩台離得遠就拉遠，貼身就推近；玩家的縮放是在這上面再乘一個倍率
  const auto = Math.max(0.95, Math.min(2, BUF_W / (dist + 125)));
  // 導播鏡位：像轉播一樣從側面拍，兩台一左一右。貼太近時方向不穩，就維持原本的角度。
  controls.auto = running && match.phase !== 'over' && dist > 16 ? -Math.atan2(b.y - a.y, b.x - a.x) : running ? controls.angle : null;
  const zoom = Math.max(0.75, Math.min(4, auto * controls.zoom * (1 + fx.zoomKick)));
  const k = 1 - Math.exp(-dt * 5);
  cam.zoom += (zoom - cam.zoom) * k;
  // 鏡頭只跟一部分，擂台才不會晃得太厲害
  cam.x += (((a.x + b.x) / 2) * 0.9 - cam.x) * k;
  cam.y += (((a.y + b.y) / 2) * 0.9 - cam.y) * k;
  cam.shakeX = fx.shakeX;
  cam.shakeY = fx.shakeY;
}

function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  time += dt;
  frameNo++;

  // 戰鬥邏輯固定 60Hz，和畫面更新率無關。頓幀只是暫停推進，不影響結果。
  if (running) {
    acc += dt * speed;
    while (acc >= TICK) {
      acc -= TICK;
      if (fx.hitStop > 0) {
        fx.hitStop--;
        continue;
      }
      stepMatch(match);
      director.onTick(match);
      commentator.onTick(match);
      if (!isReplay) tutorial.onTick(match);
      if (match.phase === 'over' && !grown) grow();
      // 分享的重播跑完：和原本那場的指紋比對
      if (match.done && shared && !verified) {
        verified = true;
        if (shared.hash !== null)
          hud.showGrowth([
            matchHash(match) === shared.hash
              ? '✔ 這場和分享的人看到的完全一樣。'
              : '⚠ 這場和原本的結果不一樣：連結可能是舊版遊戲產生的，或被改過。',
          ]);
      }
    }
    director.onFrame(match, frameNo);
  }

  controls.update(dt, renderer.cam);
  fx.update(dt);
  crowd.update(dt);
  commentator.update(dt);
  tutorial.update(dt);
  updateCamera(dt);
  hud.update(match, dt);

  if (setup.visible) setup.preview.draw(dt, time);

  const t0 = performance.now();
  drawScene(renderer, match, models, fx, crowd, time, dt * Math.min(1, speed));
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
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
