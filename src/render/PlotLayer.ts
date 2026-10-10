import { Container, Graphics } from 'pixi.js';
import type { World } from '../game/World';
import type { Plot, PlotStatus } from '../game/types';
import { RasterOverlay, rgba } from './RasterOverlay';

export type Lens = 'normal' | 'plots' | 'value' | 'mine';

export const STATUS_COLORS: Record<PlotStatus, number> = {
  not_approached: 0xffffff,
  negotiating: 0xf2c14e,
  sold: 0x4caf7d,
  refused: 0xd9655b,
};
export const LAND_COLORS: Record<string, number> = {
  state_land: 0x6fa8dc,
  park: 0x6fbf73,
  field: 0xc9b458,
  cemetery: 0x9e9e9e,
};
/** Cool → hot ramp for land value. */
export const VALUE_RAMP = [0x2c7bb6, 0x7fbcd2, 0xe9f0b5, 0xfdae61, 0xd7191c];

export function valueColor(t: number): number {
  const x = Math.max(0, Math.min(1, t)) * (VALUE_RAMP.length - 1);
  const i = Math.min(VALUE_RAMP.length - 2, Math.floor(x));
  return lerpColor(VALUE_RAMP[i], VALUE_RAMP[i + 1], x - i);
}

function lerpColor(a: number, b: number, t: number): number {
  const ch = (c: number, s: number) => (c >> s) & 0xff;
  const m = (s: number) => Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * t) << s;
  return m(16) | m(8) | m(0);
}

/** Draws lenses (status / value) and parcel outlines for hover and selection. */
export class PlotLayer {
  readonly container = new Container();
  private raster: RasterOverlay | null = null;
  private relatedG = new Graphics();
  private hoverG = new Graphics();
  private selectG = new Graphics();
  private world: World | null = null;
  lens: Lens = 'normal';
  private hovered: Plot | null = null;
  private selected: Plot | null = null;
  private multi: Plot[] = [];
  /** Returns true if a plot is owned by the rival (set from main). */
  rivalOf: (id: string) => boolean = () => false;
  private lastZoom = 0;
  private outlines = new Map<string, number[]>();

  constructor() {
    this.container.addChild(this.relatedG, this.hoverG, this.selectG);
  }

  setWorld(w: World) {
    this.world = w;
    this.hovered = this.selected = null;
    this.multi = [];
    this.outlines.clear();
    this.raster?.destroy();
    const g = w.grid;
    this.raster = new RasterOverlay(g.w, g.h, g.minX, g.minY);
    this.raster.sprite.visible = false;
    this.container.addChildAt(this.raster.sprite, 0);
    this.redrawLens();
    this.redrawHighlights();
  }

  setLens(l: Lens) {
    this.lens = l;
    this.redrawLens();
  }

  setHovered(p: Plot | null) {
    if (p === this.hovered) return;
    this.hovered = p;
    this.redrawHighlights();
  }

  /** Plots picked for a group meeting. */
  setMulti(list: Plot[]) {
    this.multi = list;
    this.redrawHighlights();
  }

  setSelected(p: Plot | null) {
    this.selected = p;
    this.redrawHighlights();
  }

  /** Keeps highlight outlines a constant on-screen width. */
  update(zoom: number) {
    if (Math.abs(zoom - this.lastZoom) / zoom > 0.03) {
      this.lastZoom = zoom;
      this.redrawHighlights();
    }
  }

  redrawLens() {
    const w = this.world, r = this.raster;
    if (!w || !r) return;
    r.sprite.visible = this.lens !== 'normal';
    if (this.lens === 'normal') return;
    const P = w.parcels, gw = w.grid.w, n = P.length;
    // one fill colour and one edge colour per plot
    const fill = new Uint32Array(w.plots.length), edge = new Uint32Array(w.plots.length);
    if (this.lens === 'mine') {
      // your land bright green, everything else dimmed
      for (const p of w.plots) {
        const mine = w.statusOf(p.id) === 'sold';
        fill[p.index] = mine ? rgba(0x4caf7d, 0.5) : rgba(0x10141a, 0.45);
        edge[p.index] = mine ? rgba(0x9be0a8, 1) : rgba(0x10141a, 0.45);
      }
    } else if (this.lens === 'value') {
      const [lo, hi] = w.valueRange;
      for (const p of w.plots) {
        const c = valueColor((p.landValue / p.area - lo) / (hi - lo || 1));
        fill[p.index] = rgba(c, 0.6);
        edge[p.index] = rgba(c, 0.95);
      }
    } else {
      for (const p of w.plots) {
        if (this.rivalOf(p.id)) { fill[p.index] = rgba(0x8b5bbf, 0.42); edge[p.index] = rgba(0xb98be0, 1); continue; }
        const s = w.statusOf(p.id);
        const base = s !== 'not_approached' ? STATUS_COLORS[s] : p.kind === 'land' ? LAND_COLORS[p.category] ?? 0x888888 : 0xffffff;
        fill[p.index] = rgba(base, s !== 'not_approached' ? 0.38 : p.kind === 'land' ? 0.3 : 0);
        edge[p.index] = rgba(s !== 'not_approached' ? STATUS_COLORS[s] : 0xffffff, s !== 'not_approached' ? 1 : 0.55);
      }
    }
    r.update((i) => {
      const k = P[i];
      if (k < 0) return 0;
      const x = i % gw;
      const isEdge = (x + 1 < gw && P[i + 1] !== k) || (i + gw < n && P[i + gw] !== k) || (x > 0 && P[i - 1] !== k) || (i >= gw && P[i - gw] !== k);
      return isEdge ? edge[k] : fill[k];
    });
  }

  private outlineOf(p: Plot): number[] {
    let o = this.outlines.get(p.id);
    if (!o) {
      o = this.world!.outline(p);
      this.outlines.set(p.id, o);
    }
    return o;
  }

  private segs(g: Graphics, p: Plot) {
    const s = this.outlineOf(p);
    for (let i = 0; i < s.length; i += 4) g.moveTo(s[i], s[i + 1]).lineTo(s[i + 2], s[i + 3]);
  }

  private redrawHighlights() {
    const w = this.world;
    const px = 1 / Math.max(this.lastZoom, 0.01); // one screen pixel in meters
    this.hoverG.clear();
    this.selectG.clear();
    this.relatedG.clear();
    if (!w) return;

    const sel = this.selected;
    if (sel) {
      const owner = w.ownerOf(sel);
      if (owner.kind !== 'state' && owner.plotIds.length > 1) {
        for (const id of owner.plotIds) if (id !== sel.id) this.segs(this.relatedG, w.plot(id)!);
        this.relatedG.stroke({ width: 2 * px, color: 0xe0a458, alpha: 0.95 });
      }
      for (const id of sel.neighbors) this.segs(this.relatedG, w.plot(id)!);
      this.relatedG.stroke({ width: 1.5 * px, color: 0xffffff, alpha: 0.7 });
      this.segs(this.selectG, sel);
      this.selectG.stroke({ width: 5 * px, color: 0x1b1f26, alpha: 0.6 });
      this.segs(this.selectG, sel);
      this.selectG.stroke({ width: 2.5 * px, color: 0xffd27f, alpha: 1 });
    }
    if (this.multi.length) {
      for (const p of this.multi) this.segs(this.selectG, p);
      this.selectG.stroke({ width: 4.5 * px, color: 0x1b1f26, alpha: 0.5 });
      for (const p of this.multi) this.segs(this.selectG, p);
      this.selectG.stroke({ width: 2.2 * px, color: 0x5fb3a1, alpha: 1 });
    }
    const h = this.hovered;
    if (h && h !== sel) {
      this.segs(this.hoverG, h);
      this.hoverG.stroke({ width: 2 * px, color: 0xffffff, alpha: 0.9 });
    }
  }
}
