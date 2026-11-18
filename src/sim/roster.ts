/** 現成的機器人設定。P1 只有兩台寫死的；P4 的對手名單會放在這裡。 */
import { BASE_SPEC, type RobotSetup } from './match';

/** 重裝、血厚、拳重，但走得慢 */
export const RAMPAGE: RobotSetup = {
  ai: 'brawler',
  spec: {
    ...BASE_SPEC,
    name: 'RAMPAGE-01 衝撞者',
    maxHp: 118,
    walkSpeed: 0.55,
    heavy: { ...BASE_SPEC.heavy, damage: 15 },
  },
};

/** 輕裝、走得快、推進器冷卻短，但不耐打 */
export const GHOST: RobotSetup = {
  ai: 'outfighter',
  spec: {
    ...BASE_SPEC,
    name: 'GHOST-02 游擊者',
    maxHp: 110,
    walkSpeed: 0.66,
    dashCooldown: 80,
  },
};
