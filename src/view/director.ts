/**
 * 導播：把戰鬥邏輯丟出來的事件變成特效、音效、畫面文字。
 * 只讀 sim，不改 sim；這裡做的事都不影響勝負。
 */
import type { Match } from '../sim/match';
import type { SoundPlayer } from '../audio/sound';
import type { Renderer } from '../render/renderer';
import { FLOOR_Z } from '../models/arena';
import { ROBOT_RIG, type RobotModels } from '../models/robot';
import type { Fx } from './fx';
import type { Hud } from './hud';
import type { Crowd } from './crowd';

const CHEST = FLOOR_Z + ROBOT_RIG.chestZ;

export class Director {
  constructor(
    private fx: Fx,
    private audio: SoundPlayer,
    private hud: Hud,
    private renderer: Renderer,
    private models: RobotModels[],
    private crowd: Crowd,
  ) {}

  /** 正在播 K.O. 的慢動作重播：特效照做，但不再跳橫幅、不再喊開始和結束 */
  replay = false;

  /** 觀眾歡呼：畫面上站起來，也出聲 */
  private cheer(amount: number): void {
    this.crowd.cheer(amount);
    this.audio.play('crowd', { volume: amount * 0.6 });
  }

  /** 依畫面上的左右位置決定聲音偏左還是偏右 */
  private pan(x: number, y: number): number {
    const c = this.renderer.cam;
    const rx = (x - c.x) * Math.cos(c.angle) - (y - c.y) * Math.sin(c.angle);
    return Math.max(-0.8, Math.min(0.8, (rx * c.zoom) / (this.renderer.w / 2)));
  }

  /** 每個邏輯 tick 之後呼叫一次 */
  onTick(m: Match): void {
    const { fx, audio, hud } = this;
    for (const e of m.events) {
      if (this.replay && (e.type === 'count' || e.type === 'start' || e.type === 'end' || e.type === 'round' || e.type === 'bell' || e.type === 'tko')) continue;
      switch (e.type) {
        case 'count':
          hud.banner(String(e.n), 0.7);
          audio.play('count');
          break;
        case 'start':
          this.cheer(0.6);
          break;
        case 'round':
          // 每回合開始：橫幅、鐘聲
          hud.hideRoundCard();
          hud.banner(e.n === 1 ? 'FIGHT!' : `ROUND ${e.n}`, 1.1, 'gold');
          audio.play('bell');
          if (e.n > 1) this.cheer(0.5);
          break;
        case 'tactic':
          hud.tactics(e.tactics, !this.replay);
          break;
        case 'bell':
          // 回合結束：鐘聲連響、打出這回合的數據
          audio.play('bell');
          audio.play('bell', { volume: 0.7 });
          if (m.phase === 'break') {
            hud.banner(`END OF ROUND ${e.n}`, 1.6, 'small');
            hud.showRoundCard(m);
          }
          this.cheer(0.45);
          break;
        case 'tko': {
          // 裁判衝進來中止比賽
          const r = m.robots[e.robot];
          fx.shake(4);
          fx.focusOn(r.x, r.y, 0.7);
          fx.slow(0.35, 0.9);
          hud.banner('STOPPAGE!', 1.2, 'gold');
          audio.play('bell');
          this.cheer(1);
          this.crowd.wow(0.9);
          break;
        }
        case 'whiff':
          audio.play('whiff', { pan: this.pan(m.robots[e.robot].x, m.robots[e.robot].y) });
          break;
        case 'hit': {
          const heavy = e.kind === 'heavy';
          const pan = this.pan(e.x, e.y);
          // 這一拳的方向：從出拳的人指向被打的人
          const from = m.robots[e.attacker];
          const to = m.robots[e.target];
          const dl = Math.hypot(to.x - from.x, to.y - from.y) || 1;
          const dx = (to.x - from.x) / dl;
          const dy = (to.y - from.y) / dl;
          if (e.blocked) {
            fx.sparks(e.x, e.y, CHEST, heavy ? 14 : 6, 0.7);
            fx.shake(heavy ? 2.5 : 1);
            audio.play('block', { pan, volume: heavy ? 1 : 0.6 });
            break;
          }
          const power = (heavy ? 1 : 0.45) * (e.counter ? 1.3 : 1);
          fx.debris(e.x, e.y, CHEST, this.models[e.target].debris, Math.round(8 + 22 * power), 0.6 + power * 0.7);
          fx.sparks(e.x, e.y, CHEST, Math.round(4 + 10 * power), 0.6 + power * 0.5);
          fx.cone(e.x, e.y, CHEST, dx, dy, Math.round(6 + 18 * power), 0.7 + power * 0.5);
          fx.shake(1.5 + 4.5 * power);
          if (heavy) {
            fx.ring(e.x, e.y, CHEST, 22, 150 + 60 * power);
            // 反擊重拳：短短慢一下，看得清楚是怎麼打中的
            if (e.counter && !this.replay) {
              fx.slow(0.35, 0.32);
              fx.focusOn(e.x, e.y, 0.5);
            }
            this.cheer(e.counter ? 0.75 : 0.55);
            // 有效的重擊：全場「哇」一聲跳起來（反擊更誇張）
            this.crowd.wow(e.counter ? 0.9 : 0.55);
            fx.flash(0.3 + (e.counter ? 0.15 : 0));
            fx.zoomKick = Math.max(fx.zoomKick, 0.1);
          }
          fx.hitStop = Math.max(fx.hitStop, heavy ? 5 : 2);
          audio.play(heavy ? 'heavy' : 'jab', { pan });
          if (e.counter && heavy) hud.banner('COUNTER!', 0.6, 'small');
          break;
        }
        case 'down': {
          const r = m.robots[e.robot];
          fx.dust(r.x, r.y, 26);
          fx.shake(6);
          fx.zoomKick = Math.max(fx.zoomKick, 0.14);
          fx.hitStop = Math.max(fx.hitStop, 8);
          fx.ring(r.x, r.y, FLOOR_Z + 1, 30, 120, 0xffa3907f);
          if (!this.replay) {
            fx.slow(0.3, 0.7);
            fx.focusOn(r.x, r.y, 0.7);
          }
          audio.play('down', { pan: this.pan(r.x, r.y) });
          if (!this.replay) hud.banner('DOWN!', 1, 'gold');
          this.cheer(0.9);
          this.crowd.wow(1);
          audio.play('ooh', { volume: 0.7 });
          break;
        }
        case 'ko': {
          const r = m.robots[e.robot];
          fx.debris(r.x, r.y, CHEST, this.models[e.robot].debris, 70, 1.8);
          fx.sparks(r.x, r.y, CHEST, 50, 1.4);
          fx.dust(r.x, r.y, 30);
          fx.shake(9);
          fx.flash(0.6);
          fx.zoomKick = Math.max(fx.zoomKick, 0.22);
          fx.hitStop = Math.max(fx.hitStop, 14);
          fx.ring(r.x, r.y, CHEST, 36, 220);
          fx.ring(r.x, r.y, FLOOR_Z + 1, 30, 130, 0xffa3907f);
          if (!this.replay) {
            fx.slow(0.18, 1.5);
            fx.focusOn(r.x, r.y, 0.9);
          }
          audio.play('ko', { pan: this.pan(r.x, r.y) });
          this.cheer(1);
          this.crowd.wow(1);
          break;
        }
        case 'dash':
          audio.play('dash', { pan: this.pan(m.robots[e.robot].x, m.robots[e.robot].y), volume: 0.7 });
          break;
        case 'cage':
          fx.sparks(e.x, e.y, CHEST - 4, 10, 0.6);
          fx.shake(2.5);
          audio.play('cage', { pan: this.pan(e.x, e.y) });
          break;
        case 'end':
          audio.play('end');
          hud.showResult(m);
          break;
        default:
          break;
      }
    }
  }

  /** 每一幀呼叫：持續性的特效（噴焰、冒煙） */
  onFrame(m: Match, frame: number): void {
    for (const r of m.robots) {
      if (r.dashTicks > 0)
        this.fx.flame(r.x - r.dashX * 8, r.y - r.dashY * 8, FLOOR_Z + ROBOT_RIG.torsoZ + 7, r.dashX, r.dashY);
      if (r.action === 'ko' && frame % 4 === 0) this.fx.smoke(r.x - Math.cos(r.heading) * 10, r.y - Math.sin(r.heading) * 10, FLOOR_Z + 8, 1);
    }
  }
}
