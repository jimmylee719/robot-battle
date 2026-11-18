/** 現成的機器人設定。之後的對手名單會放在這裡。 */
import type { RobotSetup } from './match';

/** 測試對手：街頭亂鬥，拿大錘站著硬打 */
export const RAMPAGE: RobotSetup = {
  name: 'RAMPAGE-01 衝撞者',
  gear: { weapon: 'hammer', armor: 'light', thruster: 'standard' },
  brain: 'chatter',
  deck: ['brawler', 'never_back', 'smell_blood'],
};
