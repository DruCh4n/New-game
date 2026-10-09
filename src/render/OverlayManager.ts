import { Sprite, Texture } from 'pixi.js';
import type { MapRenderer } from './MapRenderer';
import type { Camera } from './Camera';
import type { InputInterceptor } from './controls';
import type { MapData } from '../shared/mapTypes';
import { idb } from '../util/idb';

interface OverlayState {
  x: number; // world position of image center
  y: number;
  metersPerPixel: number;
  rotation: number; // radians
  opacity: number;
  below: boolean;
}

/**
 * A user-supplied satellite screenshot drawn in world space for reference.
 * The image and its alignment are stored per map in the browser (IndexedDB/localStorage) only.
 */
export class OverlayManager implements InputInterceptor {
  adjusting = false;
  private sprite: Sprite | null = null;
  private state: OverlayState | null = null;
  private mapKey = '';
  private map: MapData | null = null;
  onChange: () => void = () => {};

  constructor(private renderer: MapRenderer, private camera: Camera) {}

  get loaded() { return !!this.sprite; }
  get opacity() { return this.state?.opacity ?? 0.5; }
  get below() { return this.state?.below ?? false; }

  async setMap(map: MapData, key: string) {
    this.clearSprite();
    this.map = map;
    this.mapKey = key;
    this.adjusting = false;
    const blob = await idb.get<Blob>(this.imageKey());
    if (blob) {
      const saved = this.loadState();
      await this.showImage(blob, saved);
    }
    this.onChange();
  }

  async loadFile(file: File) {
    await idb.set(this.imageKey(), file).catch(() => { /* storage may be unavailable – still show it this session */ });
    await this.showImage(file, null);
    this.adjusting = true;
    this.onChange();
  }

  async remove() {
    this.clearSprite();
    this.state = null;
    this.adjusting = false;
    await idb.del(this.imageKey()).catch(() => {});
    try { localStorage.removeItem(this.stateKey()); } catch { /* ignore */ }
    this.onChange();
  }

  setOpacity(v: number) {
    if (!this.state) return;
    this.state.opacity = v;
    this.apply();
  }

  setBelow(v: boolean) {
    if (!this.state) return;
    this.state.below = v;
    this.apply();
  }

  fitToMap() {
    if (!this.sprite || !this.map || !this.state) return;
    const b = this.map.bounds;
    const tex = this.sprite.texture;
    this.state.x = (b.minX + b.maxX) / 2;
    this.state.y = (b.minY + b.maxY) / 2;
    this.state.rotation = 0;
    this.state.metersPerPixel = Math.max((b.maxX - b.minX) / tex.width, (b.maxY - b.minY) / tex.height);
    this.apply();
  }

  // ----- InputInterceptor -----
  active() { return this.adjusting && !!this.sprite; }
  drag(dwx: number, dwy: number) {
    if (!this.state) return;
    this.state.x += dwx;
    this.state.y += dwy;
    this.apply();
  }
  wheel(sx: number, sy: number, deltaY: number, shift: boolean) {
    if (!this.state) return;
    const [wx, wy] = this.camera.screenToWorld(sx, sy);
    const s = this.state;
    if (shift) {
      // rotate around cursor
      const a = -deltaY * 0.0005;
      const dx = s.x - wx, dy = s.y - wy;
      s.x = wx + dx * Math.cos(a) - dy * Math.sin(a);
      s.y = wy + dx * Math.sin(a) + dy * Math.cos(a);
      s.rotation += a;
    } else {
      // scale around cursor
      const f = Math.exp(-deltaY * 0.0008);
      s.x = wx + (s.x - wx) * f;
      s.y = wy + (s.y - wy) * f;
      s.metersPerPixel *= f;
    }
    this.apply();
  }

  // ----- internals -----
  private async showImage(blob: Blob, saved: OverlayState | null) {
    const bitmap = await createImageBitmap(blob);
    this.clearSprite();
    const sprite = new Sprite(Texture.from(bitmap));
    sprite.anchor.set(0.5);
    this.sprite = sprite;
    this.state = saved ?? { x: 0, y: 0, metersPerPixel: 1, rotation: 0, opacity: 0.5, below: false };
    if (!saved) this.fitToMap();
    this.apply();
  }

  private apply() {
    const s = this.state, sp = this.sprite;
    if (!s || !sp) return;
    sp.position.set(s.x, s.y);
    sp.scale.set(s.metersPerPixel);
    sp.rotation = s.rotation;
    sp.alpha = s.opacity;
    const parent = s.below ? this.renderer.overlayBelow : this.renderer.overlayAbove;
    if (sp.parent !== parent) parent.addChild(sp);
    try { localStorage.setItem(this.stateKey(), JSON.stringify(s)); } catch { /* ignore */ }
  }

  private clearSprite() {
    if (this.sprite) {
      this.sprite.destroy({ texture: true, textureSource: true });
      this.sprite = null;
    }
  }

  private loadState(): OverlayState | null {
    try {
      const v = localStorage.getItem(this.stateKey());
      return v ? (JSON.parse(v) as OverlayState) : null;
    } catch {
      return null;
    }
  }

  private imageKey() { return `overlay-image:${this.mapKey}`; }
  private stateKey() { return `kotabaru.overlay:${this.mapKey}`; }
}
