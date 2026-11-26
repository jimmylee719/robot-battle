/**
 * 格鬥模式的固定角色（P22）：一打開就能選角色直接開打，不用先收集卡。
 * 每個角色一種武術流派、一套預設卡組（照 presets.ts 的流派優先順序、1000 點額度湊滿）、固定的性格、
 * 三回合作戰計畫和外型。所有人都能用全部角色，沒有付費或抽卡才拿得到的角色。
 *
 * 平衡目標「沒有絕對的強者」：每個角色和其他所有角色互打（換邊、很多種子），
 * 總勝率都在 40～60% 左右，而且每個角色都至少有一個打不贏（< 50%）的對手。
 * 調的時候只動這張表（裝備、大腦、卡、性格、計畫），戰鬥規則不變，所以不用加分享 VERSION；
 * 調完用 scratchpad 的 fighters 互打腳本重跑勝率矩陣。
 *
 * 純邏輯：不 import 畫面的東西。
 */
import { BRAINS, CARDS, type BrainId } from './cards';
import { BUDGET, totalCost } from './gear';
import type { Look } from './look';
import type { RobotSetup } from './match';
import { buildFor } from './presets';
import type { Plan } from './tactics';
import type { Temper } from './temper';
import type { Loadout } from './types';

export interface Fighter {
  id: string;
  /** 流派卡的 id */
  style: string;
  name: string;
  /** 一句話介紹（選角畫面） */
  bio: string;
  /** 打法標籤（選角畫面上的小字） */
  tag: string;
  temper: Temper;
  plan: Plan;
  look: Look;
  /** 不照流派預設的裝備、大腦、卡（平衡用）；沒寫就照 presets.ts 湊 */
  gear?: Loadout;
  brain?: BrainId;
  deck?: string[];
}

const L = (paint: string, trim: string, glow: string, head: string, pattern: string, finish: string, glove: string, face: string, shoulder: string, back: string, chest: string, wear: string): Look => ({
  paint, trim, glow, head, pattern, finish, glove, face, shoulder, back, chest, wear,
});

const T = (drive: number, nerve: number, grip: number): Temper => ({ drive, nerve, grip });

export const FIGHTERS: Fighter[] = [
  {
    id: 'ironjab',
    style: 'boxing',
    name: 'IRON JAB 鐵刺拳',
    tag: '拳擊・抓破綻',
    bio: '重骨架穩穩站著，刺拳一直戳，等你出重拳的空檔打回來。',
    temper: T(0.55, 0.4, 0.5),
    plan: ['tech', 'break', 'tech'],
    look: L('red', 'white', 'white', 'helmet', 'stripe', 'gloss', 'red', 'visor', 'round', 'none', 'number', 'scuffed'),
    gear: { armor: 'heavy', plate: 10, weapon: 'fists', thruster: 'standard' },
    brain: 'parrot',
    deck: ['boxing', 'read_heavy', 'punish', 'jab_jab'],
  },
  {
    id: 'whiplash',
    style: 'taekwondo',
    name: 'WHIPLASH 鞭腿',
    tag: '跆拳道・遠距離踢',
    bio: '腿又長又快，在外圍一直踢。被貼近就麻煩了。',
    temper: T(0.5, 0.45, 0.2),
    plan: ['tech', 'tech', 'rush'],
    look: L('sky', 'white', 'cyan', 'mono', 'split', 'gloss', 'white', 'visor', 'bare', 'wings', 'none', 'clean'),
    gear: { armor: 'medium', plate: 10, weapon: 'fists', thruster: 'turbo' },
    brain: 'nerd',
    deck: ['taekwondo', 'hit_and_run'],
  },
  {
    id: 'elbowstorm',
    style: 'muaythai',
    name: 'ELBOW STORM 肘擊風暴',
    tag: '泰拳・膝肘貼身',
    bio: '一路壓上去，膝蓋、手肘往你身上招呼。很耗電。',
    temper: T(0.75, 0.65, 0.8),
    plan: ['rush', 'break', 'rush'],
    look: L('gold', 'red', 'amber', 'samurai', 'tiger', 'matte', 'red', 'slit', 'spiked', 'banner', 'straps', 'battle'),
    gear: { armor: 'medium', plate: 10, weapon: 'fists', thruster: 'standard' },
    brain: 'parrot',
    deck: ['muaythai', 'cage_press', 'smell_blood', 'blitz'],
  },
  {
    id: 'throwmaster',
    style: 'judo',
    name: 'THROW MASTER 過肩王',
    tag: '柔道・抓了就摔',
    bio: '貼近你、抓住、摔出去。手臂擋不住摔技。',
    temper: T(0.55, 0.5, 0.85),
    plan: ['break', 'tech', 'break'],
    look: L('white', 'navy', 'white', 'crest', 'plain', 'matte', 'navy', 'eyes', 'plate', 'none', 'belt', 'clean'),
    gear: { armor: 'heavy', plate: 0, weapon: 'fists', thruster: 'turbo' },
    brain: 'nerd',
    deck: ['judo', 'cage_press'],
  },
  {
    id: 'doubleleg',
    style: 'wrestling',
    name: 'DOUBLE LEG 抱腿王',
    tag: '摔角・打帶跑抱摔',
    bio: '平常刺拳戳一下就跑，等你追上來就低頭抱腿。怕比它更重的對手。',
    temper: T(0.8, 0.55, 0.9),
    plan: ['rush', 'rush', 'break'],
    look: L('olive', 'forest', 'green', 'antenna', 'camo', 'matte', 'black', 'eyes', 'plate', 'tank', 'straps', 'battle'),
    gear: { armor: 'heavy', plate: 0, weapon: 'fists', thruster: 'turbo' },
    brain: 'chatter',
    deck: ['wrestling', 'hit_and_run', 'slip_counter', 'jab_jab', 'punish'],
  },
  {
    id: 'pythonlock',
    style: 'bjj',
    name: 'PYTHON LOCK 巨蟒',
    tag: '巴西柔術・等你出手',
    bio: '重骨架在外圍戳一下就退，等你追上來出手，它就抓住你摔。',
    temper: T(0.35, 0.45, 0.8),
    plan: ['guard', 'break', 'tech'],
    look: L('purple', 'black', 'violet', 'dome', 'plain', 'gloss', 'lav', 'visor', 'round', 'cape', 'reactor', 'scuffed'),
    gear: { armor: 'heavy', plate: 0, weapon: 'fists', thruster: 'standard' },
    brain: 'parrot',
    deck: ['bjj', 'hit_and_run', 'slip_counter', 'jab_jab'],
  },
  {
    id: 'phantom',
    style: 'outfighter',
    name: 'PHANTOM 幻影長矛',
    tag: '閃躲流・長矛游擊',
    bio: '長矛把距離撐開，戳一下就跑。很省電，跟它耗沒用。',
    temper: T(0.4, 0.3, 0.15),
    plan: ['tech', 'guard', 'tech'],
    look: L('white', 'teal', 'cyan', 'mono', 'plain', 'chrome', 'teal', 'visor', 'tall', 'cape', 'none', 'clean'),
    gear: { armor: 'medium', plate: 20, weapon: 'spear', thruster: 'standard' },
    brain: 'chatter',
    deck: ['outfighter', 'read_heavy', 'off_the_wall'],
  },
  {
    id: 'stillwater',
    style: 'taichi',
    name: 'STILL WATER 止水',
    tag: '太極・忍住再爆發',
    bio: '輕骨架、擋拳會化力，被逼急了就整個壓上去狂打。挨不了重拳。',
    temper: T(0.15, 0.55, 0.55),
    plan: ['guard', 'guard', 'tech'],
    look: L('black', 'white', 'white', 'helmet', 'split', 'matte', 'white', 'slit', 'round', 'halo', 'emblem', 'clean'),
    gear: { armor: 'light', plate: 10, weapon: 'fists', thruster: 'standard' },
    brain: 'nerd',
    deck: ['taichi', 'cage_press', 'smell_blood', 'blitz', 'never_back', 'haymaker'],
  },
  {
    id: 'wrecker',
    style: 'brawler',
    name: 'WRECKER 拆樓錘',
    tag: '街頭亂鬥・大錘砸防',
    bio: '大錘砸下去，舉手擋也照樣痛。撐過前幾波它就沒電了。',
    temper: T(0.85, 0.85, 0.6),
    plan: ['rush', 'guard', 'rush'],
    look: L('rust', 'sand', 'orange', 'skull', 'hazard', 'matte', 'olive', 'mask', 'spiked', 'pipes', 'vent', 'rusty'),
    gear: { armor: 'medium', plate: 0, weapon: 'hammer', thruster: 'turbo' },
    brain: 'parrot',
    deck: ['brawler', 'read_heavy', 'slip_counter'],
  },
  {
    id: 'mountain',
    style: 'sumo',
    name: 'MOUNTAIN 移山',
    tag: '相撲・超重推擠',
    bio: '超重量級，一路把你推到籠邊。打它像打牆，但它很慢。',
    temper: T(0.6, 0.6, 0.9),
    plan: ['break', 'rush', 'guard'],
    look: L('coral', 'navy', 'red', 'box', 'plain', 'matte', 'navy', 'eyes', 'shield', 'none', 'belt', 'scuffed'),
    gear: { armor: 'heavy', plate: 0, weapon: 'fists', thruster: 'turbo' },
    brain: 'nerd',
    deck: ['sumo', 'chase', 'cage_press'],
  },
  {
    id: 'samba',
    style: 'capoeira',
    name: 'SAMBA 森巴旋風',
    tag: '卡波耶拉・轉圈旋踢',
    bio: '轉著圈追上來，把你逼到籠邊再一記旋踢。節奏很難抓。',
    temper: T(0.5, 0.6, 0.3),
    plan: ['tech', 'rush', 'tech'],
    look: L('yellow', 'green', 'lime', 'horns', 'flame', 'gloss', 'green', 'triple', 'bare', 'jetpack', 'none', 'clean'),
    gear: { armor: 'medium', plate: 20, weapon: 'fists', thruster: 'standard' },
    brain: 'parrot',
    deck: ['capoeira', 'chase', 'cage_press', 'read_heavy'],
  },
  {
    id: 'oak',
    style: 'kyokushin',
    name: 'OAK 老橡樹',
    tag: '極真空手・硬碰硬',
    bio: '站著跟你對打，挨一拳回一拳，絕不後退。',
    temper: T(0.7, 0.7, 0.65),
    plan: ['guard', 'rush', 'break'],
    look: L('crimson', 'black', 'amber', 'samurai', 'plain', 'gloss', 'gold', 'slit', 'layered', 'blades', 'straps', 'scuffed'),
    gear: { armor: 'heavy', plate: 10, weapon: 'fists', thruster: 'standard' },
    brain: 'parrot',
    deck: ['kyokushin', 'read_heavy', 'punish', 'jab_jab'],
  },
];

/** 全部的卡（固定角色不用收集，照流派預設把卡槽塞滿） */
const ALL_CARDS = Object.keys(CARDS);

/** 角色 → 開打用的設定（同一個角色每次都一樣） */
export function charSetup(f: Fighter): RobotSetup {
  const b = buildFor(f.style, ALL_CARDS, BUDGET);
  const gear = f.gear ?? b.gear;
  const brain = f.brain ?? b.brain;
  const deck = f.deck ?? b.deck;
  return { name: f.name, gear: { ...gear }, brain, deck: [...deck], temper: { ...f.temper }, plan: [...f.plan], look: { ...f.look } };
}

export function fighterById(id: string): Fighter | undefined {
  return FIGHTERS.find((f) => f.id === id);
}

/** 這個角色的設定合不合法（沒超過額度、卡槽放得下）：測試和平衡腳本用 */
export function fighterLegal(f: Fighter): boolean {
  const s = charSetup(f);
  return totalCost(s.gear, s.brain, s.deck) <= BUDGET && s.deck.length <= BRAINS[s.brain].slots && s.deck.every((c) => !!CARDS[c]);
}
