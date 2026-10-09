import type { Container } from 'pixi.js';

export interface Bounds { minX: number; minY: number; maxX: number; maxY: number }

/**
 * 2D camera: `zoom` is screen pixels per world meter, (x, y) is the world point at screen center.
 * Movement is smoothed: input changes the *target*, update() eases toward it.
 */
export class Camera {
  x = 0;
  y = 0;
  zoom = 1;
  private tx = 0;
  private ty = 0;
  private tzoom = 1;
  private vx = 0; // pan inertia, world m/s
  private vy = 0;
  private anchor: { wx: number; wy: number; sx: number; sy: number } | null = null;
  minZoom = 0.05;
  maxZoom = 16;
  bounds: Bounds | null = null;
  width = 1;
  height = 1;

  resize(w: number, h: number) {
    this.width = w;
    this.height = h;
  }

  screenToWorld(sx: number, sy: number, useTarget = false): [number, number] {
    const z = useTarget ? this.tzoom : this.zoom;
    const cx = useTarget ? this.tx : this.x;
    const cy = useTarget ? this.ty : this.y;
    return [cx + (sx - this.width / 2) / z, cy + (sy - this.height / 2) / z];
  }

  worldToScreen(wx: number, wy: number): [number, number] {
    return [(wx - this.x) * this.zoom + this.width / 2, (wy - this.y) * this.zoom + this.height / 2];
  }

  /** Immediately move by a screen-space delta (used while dragging). */
  panByScreen(dx: number, dy: number) {
    this.anchor = null;
    this.x -= dx / this.zoom;
    this.y -= dy / this.zoom;
    this.tx = this.x;
    this.ty = this.y;
    this.clampTarget(true);
  }

  /** Smooth pan by a screen-space delta (keyboard). */
  nudge(dx: number, dy: number) {
    this.anchor = null;
    this.tx += dx / this.tzoom;
    this.ty += dy / this.tzoom;
    this.clampTarget();
  }

  setInertia(vxScreen: number, vyScreen: number) {
    this.vx = -vxScreen / this.zoom;
    this.vy = -vyScreen / this.zoom;
  }

  stopInertia() {
    this.vx = this.vy = 0;
  }

  /** Zoom by a factor keeping the world point under (sx, sy) fixed on screen. */
  zoomAt(sx: number, sy: number, factor: number) {
    const [wx, wy] = this.anchor && this.anchor.sx === sx && this.anchor.sy === sy
      ? [this.anchor.wx, this.anchor.wy]
      : this.screenToWorld(sx, sy);
    this.tzoom = clamp(this.tzoom * factor, this.minZoom, this.maxZoom);
    this.anchor = { wx, wy, sx, sy };
    this.stopInertia();
  }

  fitBounds(b: Bounds, padding = 40, instant = true) {
    const z = Math.min((this.width - padding * 2) / (b.maxX - b.minX), (this.height - padding * 2) / (b.maxY - b.minY));
    this.bounds = b;
    this.minZoom = Math.max(0.02, z * 0.5);
    this.anchor = null;
    this.stopInertia();
    this.tzoom = clamp(z, this.minZoom, this.maxZoom);
    this.tx = (b.minX + b.maxX) / 2;
    this.ty = (b.minY + b.maxY) / 2;
    if (instant) {
      this.zoom = this.tzoom;
      this.x = this.tx;
      this.y = this.ty;
    }
  }

  update(dt: number) {
    const k = 1 - Math.exp(-dt * 14); // smoothing factor, frame-rate independent
    // zoom eases in log space so it feels uniform
    this.zoom = Math.exp(Math.log(this.zoom) + (Math.log(this.tzoom) - Math.log(this.zoom)) * k);
    if (Math.abs(this.zoom - this.tzoom) / this.tzoom < 1e-4) this.zoom = this.tzoom;

    if (this.anchor) {
      // keep the anchored world point exactly under the cursor while zoom animates
      const a = this.anchor;
      this.x = a.wx - (a.sx - this.width / 2) / this.zoom;
      this.y = a.wy - (a.sy - this.height / 2) / this.zoom;
      this.tx = a.wx - (a.sx - this.width / 2) / this.tzoom;
      this.ty = a.wy - (a.sy - this.height / 2) / this.tzoom;
      if (this.zoom === this.tzoom) this.anchor = null;
      this.clampTarget();
      return;
    }

    if (this.vx || this.vy) {
      this.tx += this.vx * dt;
      this.ty += this.vy * dt;
      const decay = Math.exp(-dt * 5);
      this.vx *= decay;
      this.vy *= decay;
      if (Math.hypot(this.vx, this.vy) * this.zoom < 5) this.stopInertia();
      this.clampTarget();
    }
    this.x += (this.tx - this.x) * k;
    this.y += (this.ty - this.y) * k;
  }

  apply(world: Container) {
    world.scale.set(this.zoom);
    world.position.set(this.width / 2 - this.x * this.zoom, this.height / 2 - this.y * this.zoom);
  }

  private clampTarget(alsoCurrent = false) {
    const b = this.bounds;
    if (!b) return;
    const m = 100; // allow a little overscroll
    this.tx = clamp(this.tx, b.minX - m, b.maxX + m);
    this.ty = clamp(this.ty, b.minY - m, b.maxY + m);
    if (alsoCurrent) {
      this.x = clamp(this.x, b.minX - m, b.maxX + m);
      this.y = clamp(this.y, b.minY - m, b.maxY + m);
    }
  }
}

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}
