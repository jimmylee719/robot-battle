/** 現成的機器人設定。P4 的對手名單會放在這裡。 */
import { BASE_SPEC, type RobotSetup } from './match';
import type { RobotSpec } from './types';

/** 玩家的機器人（P3 之後數值由裝備決定） */
export const PLAYER_SPEC: RobotSpec = { ...BASE_SPEC, name: 'PLAYER-01' };

/** P2 的測試對手：輕裝游擊型，Pro 等級 */
export const GHOST: RobotSetup = {
  tier: 'pro',
  prompt: '對手出重拳時防禦。對手露出破綻時重拳反擊。自己血量低於25%時保持距離。平常衝刺用刺拳打。',
  spec: {
    ...BASE_SPEC,
    name: 'GHOST-02 游擊者',
    maxHp: 110,
    walkSpeed: 0.66,
    dashCooldown: 80,
  },
};
