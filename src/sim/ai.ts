/**
 * P1 的寫死 AI：兩種個性。每隔 reaction 個 tick 重新決定一次「計畫」，
 * 中間就照計畫執行。P2 會換成由 prompt 解析出來的規則，但輸出一樣是 Intent。
 */
import { fatan2, wrapAngle } from '../core/fmath';
import type { Rng } from '../core/rng';
import type { Intent, Robot } from './types';

export type AiKind = 'brawler' | 'outfighter';

type Plan = 'approach' | 'circle' | 'retreat' | 'jab' | 'heavy' | 'guard' | 'dashIn' | 'dashOut' | 'backoff';

export interface Brain {
  kind: AiKind;
  plan: Plan;
  nextThink: number;
  strafeDir: 1 | -1;
}

const REACTION: Record<AiKind, number> = { brawler: 7, outfighter: 7 };

const LABEL: Record<Plan, string> = {
  approach: '逼近對手',
  circle: '繞圈找空檔',
  retreat: '拉開距離',
  jab: '刺拳',
  heavy: '重拳',
  guard: '防禦',
  dashIn: '推進器突進',
  dashOut: '推進器後撤',
  backoff: '等對手爬起來',
};

export function createBrain(kind: AiKind): Brain {
  return { kind, plan: 'approach', nextThink: 0, strafeDir: 1 };
}

function isDown(r: Robot): boolean {
  return r.action === 'down' || r.action === 'getup' || r.action === 'ko';
}

function chooseBrawler(self: Robot, foe: Robot, dist: number, rng: Rng): Plan {
  if (isDown(foe)) return 'backoff';
  const roll = rng.next();
  if (dist <= self.spec.jab.reach - 1) {
    if (foe.action === 'windup' && roll < 0.3) return 'guard';
    const open = foe.action === 'recover' || foe.action === 'stagger';
    if ((open && roll < 0.75) || roll < 0.22) return 'heavy';
    return 'jab';
  }
  if (dist > 55 && self.dashCd === 0 && roll < 0.6) return 'dashIn';
  return 'approach';
}

function chooseOutfighter(self: Robot, foe: Robot, dist: number, brain: Brain, rng: Rng): Plan {
  if (isDown(foe)) return 'backoff';
  const roll = rng.next();
  if (rng.next() < 0.12) brain.strafeDir = brain.strafeDir === 1 ? -1 : 1;
  if (foe.action === 'windup' && dist < 34 && roll < 0.55) {
    if (roll < 0.2 && self.dashCd === 0) return 'dashOut';
    if (roll < 0.42) return 'guard';
    return 'jab';
  }
  if (foe.action === 'recover' && dist < 44 && roll < 0.5) {
    if (dist <= self.spec.heavy.reach - 1) return 'heavy';
    return self.dashCd === 0 ? 'dashIn' : 'approach';
  }
  if (dist <= self.spec.jab.reach - 1) {
    if (roll < 0.55) return 'jab';
    if (roll < 0.8) return 'retreat';
    return 'circle';
  }
  if (dist > 52) return 'approach';
  if (roll < 0.3) return 'jab';
  return 'circle';
}

export function think(self: Robot, foe: Robot, brain: Brain, rng: Rng): Intent {
  const dx = foe.x - self.x;
  const dy = foe.y - self.y;
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;
  const nx = dx / dist;
  const ny = dy / dist;
  const face = fatan2(dy, dx);

  if (--brain.nextThink <= 0) {
    brain.plan =
      brain.kind === 'brawler' ? chooseBrawler(self, foe, dist, rng) : chooseOutfighter(self, foe, dist, brain, rng);
    brain.nextThink = REACTION[brain.kind];
  }

  const intent: Intent = { moveX: 0, moveY: 0, face, attack: null, guard: false, dash: false, label: LABEL[brain.plan] };
  const tx = -ny * brain.strafeDir;
  const ty = nx * brain.strafeDir;

  switch (brain.plan) {
    case 'approach':
      intent.moveX = nx;
      intent.moveY = ny;
      break;
    case 'circle': {
      const radial = Math.max(-0.6, Math.min(0.6, (dist - 36) * 0.05));
      intent.moveX = tx + nx * radial;
      intent.moveY = ty + ny * radial;
      break;
    }
    case 'retreat': {
      intent.moveX = -nx;
      intent.moveY = -ny;
      // 快被逼到籠邊就改往中間繞
      const edge = Math.sqrt(self.x * self.x + self.y * self.y);
      if (edge > 46) {
        intent.moveX += tx - (self.x / edge) * 1.2;
        intent.moveY += ty - (self.y / edge) * 1.2;
      }
      break;
    }
    case 'jab':
    case 'heavy': {
      const spec = self.spec[brain.plan];
      const aimed = Math.abs(wrapAngle(face - self.heading)) < 0.35;
      if (dist <= spec.reach - 1 && aimed) {
        intent.attack = brain.plan;
        brain.nextThink = 0;
      } else if (dist > spec.reach - 1) {
        intent.moveX = nx;
        intent.moveY = ny;
      }
      break;
    }
    case 'guard':
      intent.guard = true;
      break;
    case 'dashIn':
      intent.moveX = nx;
      intent.moveY = ny;
      intent.dash = true;
      brain.plan = 'approach';
      break;
    case 'dashOut':
      intent.moveX = -nx + tx * 0.6;
      intent.moveY = -ny + ty * 0.6;
      intent.dash = true;
      brain.plan = 'circle';
      break;
    case 'backoff':
      if (dist < 46) {
        intent.moveX = -nx;
        intent.moveY = -ny;
      }
      break;
  }
  return intent;
}
