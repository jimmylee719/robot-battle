/** 現成的機器人設定。之後的對手名單會放在這裡。 */
import { BASE_SPEC, type RobotSetup } from './match';
import type { RobotSpec } from './types';

/** 玩家的機器人（之後數值由裝備決定） */
export const PLAYER_SPEC: RobotSpec = { ...BASE_SPEC, name: 'PLAYER-01' };

/** 測試對手：街頭亂鬥，站著硬打 */
export const RAMPAGE: RobotSetup = {
  brain: 'chatter',
  deck: ['brawler', 'never_back', 'smell_blood'],
  spec: { ...BASE_SPEC, name: 'RAMPAGE-01 衝撞者' },
};
