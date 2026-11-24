/** 設定畫面的機器人預覽：用同一個渲染器畫一台站在展示台上的機器人，鏡頭慢慢繞。 */
import { Renderer } from '../render/renderer';
import { bake, makePalette, VoxelGrid, type StackModel } from '../render/stack';
import { buildRobotModels, RED_TEAM, type Patch, type RobotModels } from '../models/robot';
import type { Look } from '../sim/look';
import type { Loadout } from '../sim/types';
import { drawShowcase } from './scene';

const W = 112;
const H = 120;

/** 展示台：一個圓盤，邊緣亮一圈 */
function buildStand(): StackModel {
  const pal = makePalette({ top: '#262c3c', side: '#161a26', rim: { color: '#f2c14e', emissive: true } });
  const size = 36;
  const g = new VoxelGrid(size, size, 3);
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c);
      if (d > 17.5) continue;
      g.set(x, y, 0, pal.id.side);
      g.set(x, y, 1, pal.id.side);
      g.set(x, y, 2, d > 16 ? pal.id.rim : pal.id.top);
    }
  return bake(g, pal.entries);
}

export class Preview {
  private r = new Renderer(W, H);
  private ctx: CanvasRenderingContext2D;
  private stand = buildStand();
  private models: RobotModels | null = null;
  private key = '';
  /** 玩家用手指或滑鼠拖著轉的角度 */
  private spin = 0;
  private held = false;

  constructor(canvas: HTMLCanvasElement) {
    canvas.width = W;
    canvas.height = H;
    this.ctx = canvas.getContext('2d')!;
    this.r.cam.zoom = 2.5;
    this.r.cam.z = 15;
    let lastX = 0;
    canvas.addEventListener('pointerdown', (e) => {
      this.held = true;
      lastX = e.clientX;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.held) return;
      this.spin += (e.clientX - lastX) * 0.02;
      lastX = e.clientX;
    });
    const up = (): void => void (this.held = false);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
  }

  /** 換了裝備或外觀才重建模型 */
  set(gear: Loadout, look: Look, patches: readonly Patch[] = []): void {
    const key = JSON.stringify([gear, look, patches]);
    if (key === this.key) return;
    this.key = key;
    this.models = buildRobotModels(RED_TEAM, gear, look, patches);
  }

  draw(dt: number, time: number): void {
    if (!this.models) return;
    if (!this.held) this.spin += dt * 0.5;
    this.r.cam.angle = this.spin;
    drawShowcase(this.r, this.models, this.stand, time, dt);
    this.ctx.putImageData(this.r.image, 0, 0);
  }
}
