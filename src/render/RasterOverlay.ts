import { Sprite, Texture } from 'pixi.js';

/** A 1 m-per-pixel image laid over the map, recoloured from per-cell data. */
export class RasterOverlay {
  readonly sprite: Sprite;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private image: ImageData;
  private pixels: Uint32Array;
  private texture: Texture;

  constructor(readonly w: number, readonly h: number, minX: number, minY: number) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx = this.canvas.getContext('2d')!;
    this.image = this.ctx.createImageData(w, h);
    this.pixels = new Uint32Array(this.image.data.buffer);
    this.texture = Texture.from(this.canvas);
    this.texture.source.scaleMode = 'nearest';
    this.sprite = new Sprite(this.texture);
    this.sprite.position.set(minX, minY);
  }

  /** color(i) returns 0xAABBGGRR (little-endian RGBA), 0 = transparent. */
  update(color: (i: number) => number) {
    const px = this.pixels;
    for (let i = 0; i < px.length; i++) px[i] = color(i);
    this.ctx.putImageData(this.image, 0, 0);
    this.texture.source.update();
  }

  /** Sets individual pixels; call flush() afterwards. */
  set(i: number, color: number) {
    this.pixels[i] = color;
  }

  clear() {
    this.pixels.fill(0);
  }

  flush() {
    this.ctx.putImageData(this.image, 0, 0);
    this.texture.source.update();
  }

  destroy() {
    this.sprite.destroy();
    this.texture.destroy(true);
  }
}

/** 0xRRGGBB + alpha (0..1) → packed little-endian RGBA for ImageData. */
export function rgba(rgb: number, alpha: number): number {
  const r = (rgb >> 16) & 0xff, g = (rgb >> 8) & 0xff, b = rgb & 0xff;
  return ((Math.round(alpha * 255) << 24) | (b << 16) | (g << 8) | r) >>> 0;
}
