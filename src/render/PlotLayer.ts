import { Container, Graphics } from 'pixi.js';
import type { World } from '../game/World';
import type { Plot, PlotStatus } from '../game/types';
import type { FlatPoints } from '../shared/mapTypes';

export type Lens = 'normal' | 'plots' | 'value';

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

/** Draws lenses (status / value), hover and selection highlights on top of the map. */
export class PlotLayer {
  readonly container = new Container();
  private lensG = new Graphics();
  private relatedG = new Graphics();
  private hoverG = new Graphics();
  private selectG = new Graphics();
  private world: World | null = null;
  lens: Lens = 'normal';
  private hovered: Plot | null = null;
  private selected: Plot | null = null;
  private lastZoom = 0;

  constructor() {
    this.container.addChild(this.lensG, this.relatedG, this.hoverG, this.selectG);
  }

  setWorld(w: World) {
    this.world = w;
    this.hovered = this.selected = null;
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
    const g = this.lensG;
    g.clear();
    const w = this.world;
    if (!w || this.lens === 'normal') return;

    if (this.lens === 'value') {
      const [lo, hi] = w.valueRange;
      const groups = new Map<number, FlatPoints[]>();
      for (const p of w.plots) {
        const t = (p.landValue / p.area - lo) / (hi - lo || 1);
        const c = valueColor(Math.round(t * 20) / 20); // quantise so we batch into ~21 fills
        (groups.get(c) ?? groups.set(c, []).get(c)!).push(p.poly);
      }
      for (const [c, polys] of groups) {
        for (const poly of polys) g.poly(poly);
        g.fill({ color: c, alpha: 0.62 });
      }
      return;
    }

    // plots lens: tint land parcels, outline every plot coloured by status
    const landGroups = new Map<string, Plot[]>();
    for (const p of w.plots) if (p.kind === 'land') (landGroups.get(p.category) ?? landGroups.set(p.category, []).get(p.category)!).push(p);
    for (const [cat, list] of landGroups) {
      for (const p of list) g.poly(p.poly);
      g.fill({ color: LAND_COLORS[cat] ?? 0x888888, alpha: 0.3 });
    }
    const byStatus = new Map<PlotStatus, Plot[]>();
    for (const p of w.plots) {
      const s = w.statusOf(p.id);
      (byStatus.get(s) ?? byStatus.set(s, []).get(s)!).push(p);
    }
    for (const [s, list] of byStatus) {
      if (s !== 'not_approached') {
        for (const p of list) g.poly(p.poly);
        g.fill({ color: STATUS_COLORS[s], alpha: 0.35 });
      }
      for (const p of list) g.poly(p.poly);
      g.stroke({ width: s === 'not_approached' ? 0.35 : 0.8, color: STATUS_COLORS[s], alpha: s === 'not_approached' ? 0.55 : 0.95 });
    }
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
      // the owner's other plots (dashed feel via thinner outline) and direct neighbours
      if (owner.kind !== 'state') {
        for (const id of owner.plotIds) if (id !== sel.id) this.relatedG.poly(w.plot(id)!.poly);
        this.relatedG.fill({ color: 0xe0a458, alpha: 0.25 }).stroke({ width: 2 * px, color: 0xe0a458, alpha: 0.9 });
      }
      for (const id of sel.neighbors) this.relatedG.poly(w.plot(id)!.poly);
      this.relatedG.stroke({ width: 1.5 * px, color: 0xffffff, alpha: 0.7 });
      this.selectG.poly(sel.poly).fill({ color: 0xe0a458, alpha: 0.18 })
        .stroke({ width: 5 * px, color: 0x1b1f26, alpha: 0.6 })
        .poly(sel.poly).stroke({ width: 2.5 * px, color: 0xffd27f, alpha: 1 });
    }
    const h = this.hovered;
    if (h && h !== sel) {
      this.hoverG.poly(h.poly).fill({ color: 0xffffff, alpha: 0.12 }).stroke({ width: 2 * px, color: 0xffffff, alpha: 0.9 });
    }
  }
}
