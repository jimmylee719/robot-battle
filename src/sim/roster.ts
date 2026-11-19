/**
 * 單人模式的對手：五台，一台比一台難。打贏一台才能挑戰下一台。
 * 每台都在 $900 預算內，用的是和玩家一樣的規則（大腦也有一樣的毛病）。
 */
import type { RobotSetup } from './match';

export interface Opponent {
  id: string;
  setup: RobotSetup;
  /** 賽前看得到的介紹 */
  bio: string;
  /** 第一次打贏它拿到的卡 */
  prize: string;
}

export const LADDER: Opponent[] = [
  {
    id: 'scrap',
    bio: '回收場撿來的。大腦是 Potato，看不懂「什麼時候」，所以它的刺拳想到就戳、不管打不打得到。',
    prize: 'read_heavy',
    setup: {
      name: 'SCRAP-00 廢鐵',
      gear: { weapon: 'fists', armor: 'light', thruster: 'standard' },
      brain: 'potato',
      deck: ['jab_jab'],
    },
  },
  {
    id: 'ghost',
    bio: '拿長矛在外圍游走，戳一下就跑。大腦常搞混「自己」和「對手」。',
    prize: 'outfighter',
    setup: {
      name: 'GHOST-01 游擊者',
      gear: { weapon: 'spear', armor: 'light', thruster: 'turbo' },
      brain: 'parrot',
      deck: ['outfighter', 'hit_and_run', 'chase', 'second_wind'],
      temper: { drive: 0.4, nerve: 0.3, grip: 0.25 },
    },
  },
  {
    id: 'rampage',
    bio: '大錘加街頭亂鬥，本來應該很可怕。可惜工程師買了看不到「絕不」的大腦，又插了一張「絕不後退」。',
    prize: 'haymaker',
    setup: {
      name: 'RAMPAGE-02 衝撞者',
      gear: { weapon: 'hammer', armor: 'heavy', thruster: 'standard' },
      brain: 'autofill',
      deck: ['brawler', 'haymaker', 'never_back'],
      temper: { drive: 0.8, nerve: 0.8, grip: 0.6 },
    },
  },
  {
    id: 'monk',
    bio: '站著不動，等你先出手。擋下來的拳都會被化掉，然後一拳打回來。很少聽錯。',
    prize: 'zen',
    setup: {
      name: 'MONK-03 老僧',
      gear: { weapon: 'fists', armor: 'heavy', thruster: 'standard' },
      brain: 'chatter',
      deck: ['taichi', 'zen', 'punish', 'read_heavy'],
      temper: { drive: 0.15, nerve: 0.6, grip: 0.6 },
    },
  },
  {
    id: 'accountant',
    bio: '每一分預算都花得剛剛好：重型骨架配上好大腦，拳擊打得滴水不漏。聽說怕拳頭特別重的對手。',
    prize: 'overclocked',
    setup: {
      name: 'THE ACCOUNTANT 會計師',
      gear: { weapon: 'fists', armor: 'heavy', thruster: 'standard' },
      brain: 'nerd',
      deck: ['boxing', 'read_heavy', 'punish', 'smell_blood'],
      temper: { drive: 0.55, nerve: 0.35, grip: 0.5 },
    },
  },
];

/** 卡 → 哪個對手的獎勵（給卡桌上的剪影顯示怎麼拿） */
export const PRIZE_FROM: Record<string, string> = Object.fromEntries(LADDER.map((o) => [o.prize, o.setup.name]));
