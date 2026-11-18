/**
 * 機器人模型。拆成幾個獨立的切片堆（腿、軀幹、手臂），
 * 畫面層可以各自位移／旋轉來做走路、出拳等動作。
 * 模型的前方是 +x。武器決定手臂、裝甲決定軀幹、推進器決定背包的樣子。
 */
import { bake, hexToAbgr, makePalette, VoxelGrid, type PaletteEntry, type StackModel } from '../render/stack';
import type { Loadout } from '../sim/types';

export interface RobotColors {
  team: string;
  teamLight: string;
  teamDark: string;
}

export const RED_TEAM: RobotColors = { team: '#d8433a', teamLight: '#f0766a', teamDark: '#8f2a2a' };
export const BLUE_TEAM: RobotColors = { team: '#3a7bd8', teamLight: '#6fa8f0', teamDark: '#274f8f' };

export interface RobotParts {
  leg: StackModel;
  torso: StackModel;
  arm: StackModel;
}

export interface RobotModels {
  normal: RobotParts;
  /** 全白版本：被打到的瞬間閃一下 */
  white: RobotParts;
  /** 仰躺在地上的整台機器人 */
  down: StackModel;
  /** 手臂離身體中線多遠（武器大小不同） */
  armSide: number;
  /** 被打時噴出來的碎片顏色 */
  debris: number[];
}

/** 各零件的組裝位置（相對於機器人腳底中心） */
export const ROBOT_RIG = {
  legSide: 3.5,
  torsoZ: 8,
  armZ: 9,
  /** 胸口高度，特效用 */
  chestZ: 16,
  shadowRadius: 12,
};

export function buildRobotModels(colors: RobotColors, gear: Loadout): RobotModels {
  const pal = makePalette({
    team: colors.team,
    teamLight: colors.teamLight,
    teamDark: colors.teamDark,
    metal: '#9aa4b8',
    metalDark: '#555e70',
    black: '#1c2029',
    glove: '#e9e4d4',
    visor: { color: '#5ef2ff', emissive: true },
    core: { color: '#ffe066', emissive: true },
    jet: { color: '#ff8a3c', emissive: true },
    beacon: { color: '#ff4d6d', emissive: true },
    hazard: '#e2a72e',
    tip: { color: '#5ef2ff', emissive: true },
  });
  const C = pal.id;

  // 腿：腳掌 + 小腿 + 護膝
  const leg = new VoxelGrid(10, 5, 8);
  leg.box(1, 0, 0, 8, 4, 1, C.metalDark);
  leg.box(3, 1, 2, 6, 3, 7, C.metal);
  leg.box(7, 1, 4, 7, 3, 6, C.team);

  // 軀幹：髖、腰、胸、背包推進器、頭
  const heavy = gear.armor === 'heavy';
  const turbo = gear.thruster === 'turbo';
  const t = new VoxelGrid(16, 16, 21);
  t.box(5, 2, 0, 10, 13, 1, C.metalDark);
  t.box(6, 5, 2, 9, 10, 3, C.black);
  t.box(4, 1, 4, 11, 14, 11, C.team);
  t.box(4, 1, 11, 11, 14, 11, C.teamLight);
  t.box(11, 3, 6, 11, 12, 10, C.teamLight);
  if (heavy) {
    // 重型骨架：加厚的胸甲、寬肩甲、腰甲
    t.box(12, 3, 5, 12, 12, 10, C.metal);
    t.box(4, 0, 10, 11, 15, 12, C.metal);
    t.box(5, 1, 12, 10, 14, 12, C.teamDark);
    t.box(4, 1, 2, 11, 14, 3, C.metalDark);
  }
  const front = heavy ? 12 : 11;
  t.box(front, 7, 7, front, 8, 8, C.core);
  if (turbo) {
    // 渦輪推進器：大背包、三個噴口、兩片尾翼
    t.box(0, 3, 4, 3, 12, 11, C.metalDark);
    t.box(0, 4, 6, 0, 5, 8, C.jet);
    t.box(0, 7, 6, 0, 8, 8, C.jet);
    t.box(0, 10, 6, 0, 11, 8, C.jet);
    t.box(1, 2, 9, 2, 2, 14, C.team);
    t.box(1, 13, 9, 2, 13, 14, C.team);
  } else {
    t.box(1, 4, 5, 3, 11, 10, C.metalDark);
    t.box(1, 5, 6, 1, 6, 7, C.jet);
    t.box(1, 9, 6, 1, 10, 7, C.jet);
  }
  const hz = heavy ? 1 : 0;
  t.box(7, 7, 12, 8, 8, 12 + hz, C.black);
  t.box(5, 5, 13 + hz, 10, 10, 17 + hz, C.metal);
  t.box(10, 5, 15 + hz, 10, 10, 16 + hz, C.visor);
  t.box(8, 5, 15 + hz, 10, 5, 16 + hz, C.visor);
  t.box(8, 10, 15 + hz, 10, 10, 16 + hz, C.visor);
  t.box(6, 9, 18 + hz, 6, 9, 19, C.metalDark);
  t.set(6, 9, 20, C.beacon);

  // 手臂：武器 + 前臂 + 肩甲。每種武器的格子大小不同。
  let arm: VoxelGrid;
  let armPivotX = 4;
  let armPivotY = 3;
  let armSide = 10;
  if (gear.weapon === 'hammer') {
    arm = new VoxelGrid(10, 8, 12);
    armPivotY = 4;
    armSide = 11;
    arm.box(0, 0, 0, 8, 7, 4, C.metalDark);
    arm.box(0, 0, 2, 8, 7, 2, C.hazard);
    arm.box(2, 2, 5, 5, 5, 7, C.metal);
    arm.box(1, 1, 8, 6, 6, 11, C.teamDark);
    arm.box(1, 1, 11, 6, 6, 11, C.team);
  } else if (gear.weapon === 'spear') {
    arm = new VoxelGrid(16, 6, 12);
    arm.box(1, 0, 0, 6, 5, 3, C.metalDark);
    arm.box(4, 2, 1, 13, 3, 2, C.metal);
    arm.box(14, 2, 1, 15, 3, 2, C.tip);
    arm.box(2, 1, 4, 5, 4, 7, C.metal);
    arm.box(1, 0, 8, 6, 5, 11, C.teamDark);
    arm.box(1, 0, 11, 6, 5, 11, C.team);
  } else {
    arm = new VoxelGrid(8, 6, 12);
    arm.box(1, 0, 0, 6, 5, 3, C.glove);
    arm.box(2, 1, 4, 5, 4, 7, C.metal);
    arm.box(1, 0, 8, 6, 5, 11, C.teamDark);
    arm.box(1, 0, 11, 6, 5, 11, C.team);
  }

  const bakeParts = (entries: readonly PaletteEntry[]): RobotParts => ({
    leg: bake(leg, entries),
    torso: bake(t, entries),
    arm: bake(arm, entries, { pivotX: armPivotX, pivotY: armPivotY }),
  });

  // 倒地：先把零件組成一台站著的機器人，再整台往後放倒
  // （站姿的「上」變成躺姿的「後」，「前」變成「上」）
  const standing = new VoxelGrid(22, 30, 29);
  standing.blit(leg, 3, 9, 0);
  standing.blit(leg, 3, 16, 0);
  standing.blit(t, 0, 7, ROBOT_RIG.torsoZ);
  standing.blit(arm, 9 - armPivotX, 15 - armSide - armPivotY, ROBOT_RIG.armZ);
  standing.blit(arm, 9 - armPivotX, 15 + armSide - armPivotY, ROBOT_RIG.armZ);
  const lying = new VoxelGrid(standing.d, standing.h, standing.w);
  for (let z = 0; z < standing.d; z++)
    for (let y = 0; y < standing.h; y++)
      for (let x = 0; x < standing.w; x++) lying.set(standing.d - 1 - z, y, x, standing.get(x, y, z));

  return {
    normal: bakeParts(pal.entries),
    white: bakeParts(pal.entries.map(() => ({ color: '#ffffff', emissive: true }))),
    down: bake(lying, pal.entries, { pivotX: standing.d - 8 }),
    armSide,
    debris: [colors.team, colors.teamDark, '#9aa4b8', '#555e70'].map((c) => hexToAbgr(c)),
  };
}
