import type { FlatPoints } from '../shared/mapTypes';
import { bboxOf } from '../shared/geometry';

/** Cell flags. */
export const OWNED = 1;
export const ROAD = 2;
export const CARROAD = 4;
export const WATER = 8;
/** An original building that still stands. */
export const BUILDING = 16;
/** A new building (finished or under construction). */
export const NEWBLD = 32;

/**
 * 1 m raster over the map. Each cell holds flags; road cells also remember how many
 * roads cover them so removing one road doesn't erase another.
 */
export class LandGrid {
  readonly size = 1;
  readonly w: number;
  readonly h: number;
  readonly flags: Uint8Array;
  private roadCount: Uint8Array;
  private carCount: Uint8Array;

  constructor(readonly minX: number, readonly minY: number, maxX: number, maxY: number) {
    this.w = Math.ceil(maxX - minX);
    this.h = Math.ceil(maxY - minY);
    this.flags = new Uint8Array(this.w * this.h);
    this.roadCount = new Uint8Array(this.w * this.h);
    this.carCount = new Uint8Array(this.w * this.h);
  }

  index(x: number, y: number): number {
    const cx = Math.floor(x - this.minX), cy = Math.floor(y - this.minY);
    if (cx < 0 || cy < 0 || cx >= this.w || cy >= this.h) return -1;
    return cy * this.w + cx;
  }

  get(x: number, y: number): number {
    const i = this.index(x, y);
    return i < 0 ? 0 : this.flags[i];
  }

  /** Calls fn(index) for every cell whose center lies inside the polygon. */
  forPolygon(poly: FlatPoints, fn: (i: number) => void) {
    const bb = bboxOf(poly);
    const y0 = Math.max(0, Math.floor(bb.minY - this.minY)), y1 = Math.min(this.h - 1, Math.ceil(bb.maxY - this.minY));
    const xs: number[] = [];
    for (let cy = y0; cy <= y1; cy++) {
      const y = this.minY + cy + 0.5;
      xs.length = 0;
      for (let i = 0; i < poly.length; i += 2) {
        const j = (i + 2) % poly.length;
        const ya = poly[i + 1], yb = poly[j + 1];
        if ((ya > y) !== (yb > y)) xs.push(poly[i] + ((y - ya) / (yb - ya)) * (poly[j] - poly[i]));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const a = Math.max(0, Math.ceil(xs[k] - this.minX - 0.5));
        const b = Math.min(this.w - 1, Math.floor(xs[k + 1] - this.minX - 0.5));
        for (let cx = a; cx <= b; cx++) fn(cy * this.w + cx);
      }
    }
  }

  /** Calls fn(index) for every cell within halfWidth of the polyline. */
  forLine(line: FlatPoints, halfWidth: number, fn: (i: number) => void) {
    const seen = new Set<number>();
    for (let s = 0; s + 3 < line.length; s += 2) {
      const ax = line[s], ay = line[s + 1], bx = line[s + 2], by = line[s + 3];
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - halfWidth - this.minX));
      const x1 = Math.min(this.w - 1, Math.ceil(Math.max(ax, bx) + halfWidth - this.minX));
      const y0 = Math.max(0, Math.floor(Math.min(ay, by) - halfWidth - this.minY));
      const y1 = Math.min(this.h - 1, Math.ceil(Math.max(ay, by) + halfWidth - this.minY));
      const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
      for (let cy = y0; cy <= y1; cy++) {
        for (let cx = x0; cx <= x1; cx++) {
          const px = this.minX + cx + 0.5, py = this.minY + cy + 0.5;
          let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
          t = Math.max(0, Math.min(1, t));
          const ex = ax + t * dx - px, ey = ay + t * dy - py;
          if (ex * ex + ey * ey <= halfWidth * halfWidth) {
            const i = cy * this.w + cx;
            if (!seen.has(i)) { seen.add(i); fn(i); }
          }
        }
      }
    }
  }

  setPolygon(poly: FlatPoints, flag: number, on: boolean) {
    this.forPolygon(poly, (i) => { this.flags[i] = on ? this.flags[i] | flag : this.flags[i] & ~flag; });
  }

  addRoad(line: FlatPoints, width: number, car: boolean, delta: 1 | -1) {
    this.forLine(line, width / 2, (i) => {
      this.roadCount[i] = Math.max(0, this.roadCount[i] + delta);
      if (car) this.carCount[i] = Math.max(0, this.carCount[i] + delta);
      this.flags[i] = (this.flags[i] & ~(ROAD | CARROAD)) | (this.roadCount[i] ? ROAD : 0) | (this.carCount[i] ? CARROAD : 0);
    });
  }
}
