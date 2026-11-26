/**
 * 攝影機操控：滑鼠、觸控（Pointer Events）、鍵盤、搖桿（Gamepad API）。
 * 所有輸入都先變成「目標角度／縮放倍率／俯仰」，再平滑追上去。
 * zoom 是玩家的縮放倍率，實際鏡頭縮放由 main 依兩台機器人的距離再乘上去。
 */
import type { Camera } from '../render/renderer';

const ZOOM_MIN = 0.6;
const ZOOM_MAX = 2.2;
const PITCH_MIN = 0.4;
const PITCH_MAX = 1;
const IDLE_ORBIT_AFTER = 3;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export class CameraControls {
  angle: number;
  /** 導播想要的角度（讓兩台機器人一左一右入鏡）。玩家一陣子沒碰鏡頭才會用。 */
  auto: number | null = null;
  zoom = 1;
  pitch: number;

  private pointers = new Map<number, { x: number; y: number }>();
  private pinchDist = 0;
  private keys = new Set<string>();
  private idle = IDLE_ORBIT_AFTER;
  private padActionHeld = false;

  constructor(
    el: HTMLElement,
    cam: Camera,
    private onAction: () => void,
  ) {
    this.angle = cam.angle;
    this.pitch = cam.pitch;

    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.pinchDist = this.currentPinch();
      this.idle = 0;
    });
    el.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      this.idle = 0;
      if (this.pointers.size === 1) {
        this.angle -= dx * 0.008;
        this.pitch = clamp(this.pitch + dy * 0.004, PITCH_MIN, PITCH_MAX);
      } else if (this.pointers.size === 2) {
        const d = this.currentPinch();
        if (this.pinchDist > 0 && d > 0) this.zoom = clamp((this.zoom * d) / this.pinchDist, ZOOM_MIN, ZOOM_MAX);
        this.pinchDist = d;
      }
    });
    const release = (e: PointerEvent): void => {
      this.pointers.delete(e.pointerId);
      this.pinchDist = this.currentPinch();
    };
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.zoom = clamp(this.zoom * Math.exp(-e.deltaY * 0.0015), ZOOM_MIN, ZOOM_MAX);
        this.idle = 0;
      },
      { passive: false },
    );
    el.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('keydown', (e) => {
      // 正在打字（寫 prompt）時不要搶鍵盤
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT')) return;
      if (e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat) this.onAction();
        return;
      }
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  private currentPinch(): number {
    if (this.pointers.size !== 2) return 0;
    const [a, b] = [...this.pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  private key(...codes: string[]): boolean {
    return codes.some((c) => this.keys.has(c));
  }

  update(dt: number, cam: Camera): void {
    let rot = 0;
    let tilt = 0;
    let zoomDir = 0;
    if (this.key('ArrowLeft', 'KeyA')) rot -= 1;
    if (this.key('ArrowRight', 'KeyD')) rot += 1;
    if (this.key('ArrowUp', 'KeyW')) tilt -= 1;
    if (this.key('ArrowDown', 'KeyS')) tilt += 1;
    if (this.key('KeyX', 'Equal', 'NumpadAdd')) zoomDir += 1;
    if (this.key('KeyZ', 'Minus', 'NumpadSubtract')) zoomDir -= 1;

    // 搖桿：右類比旋轉／俯仰，LT／RT 縮放，A 鍵動作
    let padAction = false;
    for (const pad of navigator.getGamepads?.() ?? []) {
      if (!pad) continue;
      const ax = pad.axes[2] ?? 0;
      const ay = pad.axes[3] ?? 0;
      if (Math.abs(ax) > 0.18) rot += ax;
      if (Math.abs(ay) > 0.18) tilt += ay;
      zoomDir += (pad.buttons[7]?.value ?? 0) - (pad.buttons[6]?.value ?? 0);
      if (pad.buttons[0]?.pressed) padAction = true;
    }
    if (padAction && !this.padActionHeld) this.onAction();
    this.padActionHeld = padAction;

    if (rot !== 0 || tilt !== 0 || zoomDir !== 0) this.idle = 0;
    this.angle += rot * dt * 2;
    this.pitch = clamp(this.pitch + tilt * dt * 0.6, PITCH_MIN, PITCH_MAX);
    this.zoom = clamp(this.zoom * Math.exp(zoomDir * dt * 1.5), ZOOM_MIN, ZOOM_MAX);

    // 一陣子沒人碰：有導播角度就慢慢轉過去，沒有就自轉（方便看模型）
    this.idle += dt;
    if (this.idle >= IDLE_ORBIT_AFTER && this.pointers.size === 0) {
      if (this.auto === null) this.angle += dt * 0.12;
      else {
        // 兩個方向都能讓機器人一左一右，挑近的那個；差一點點就不動，免得鏡頭一直晃
        let d = Math.atan2(Math.sin(this.auto - this.angle), Math.cos(this.auto - this.angle));
        if (d > Math.PI / 2) d -= Math.PI;
        else if (d < -Math.PI / 2) d += Math.PI;
        // P21：死區從 0.3 收到 0.12、轉得快一點，兩台一直保持正側面（UFC 遊戲的轉播鏡頭），前後才不會疊在一起
        const gap = Math.abs(d) - 0.12;
        if (gap > 0) this.angle += Math.sign(d) * Math.min(gap * 2.4, 1.3) * dt;
      }
    }

    const k = 1 - Math.exp(-dt * 14);
    cam.angle += (this.angle - cam.angle) * k;
    cam.pitch += (this.pitch - cam.pitch) * k;
  }
}
