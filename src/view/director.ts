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
      switch (e.type) {
        case 'count':
          hud.banner(String(e.n), 0.7);
          audio.play('count');
          break;
        case 'start':
          hud.banner('FIGHT!', 0.9, 'gold');
          this.cheer(0.6);
          audio.play('bell');
          break;
        case 'whiff':
          audio.play('whiff', { pan: this.pan(m.robots[e.robot].x, m.robots[e.robot].y) });
          break;
        case 'hit': {
          const heavy = e.kind === 'heavy';
          const pan = this.pan(e.x, e.y);
          if (e.blocked) {
            fx.sparks(e.x, e.y, CHEST, heavy ? 14 : 6, 0.7);
            fx.shake(heavy ? 2.5 : 1);
            audio.play('block', { pan, volume: heavy ? 1 : 0.6 });
            break;
          }
          const power = (heavy ? 1 : 0.45) * (e.counter ? 1.3 : 1);
          fx.debris(e.x, e.y, CHEST, this.models[e.target].debris, Math.round(8 + 22 * power), 0.6 + power * 0.7);
          fx.sparks(e.x, e.y, CHEST, Math.round(8 + 20 * power), 0.6 + power * 0.5);
          fx.shake(1.5 + 4.5 * power);
          if (heavy) {
            this.cheer(e.counter ? 0.75 : 0.55);
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
          audio.play('down', { pan: this.pan(r.x, r.y) });
          hud.banner('DOWN!', 1, 'gold');
          this.cheer(0.9);
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
          audio.play('ko', { pan: this.pan(r.x, r.y) });
          this.cheer(1);
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
