import type { MapData } from '../shared/mapTypes';
import { hashString } from '../util/random';
import { buildPlots } from './plots';
import { generateOwners } from './owners';
import { regionFor, type Region } from './regional';
import type { LandGrid } from './LandGrid';
import type { Owner, Plot, PlotStatus } from './types';

/**
 * Everything generated from a map: plots, owners, spatial lookup.
 * Generation is deterministic (same map + seed → same owners), so saves only need what changed.
 */
export class World {
  readonly region: Region;
  readonly seed: number;
  readonly plots: Plot[];
  readonly owners: Owner[];
  private plotById: Map<string, Plot>;
  private ownerById: Map<string, Owner>;
  /** 1 m raster: roads, water, buildings (and later ownership). */
  readonly grid: LandGrid;
  /** Plot index per raster cell, -1 for roads and water. */
  readonly parcels: Int32Array;
  readonly status = new Map<string, PlotStatus>();
  /** Range of value per m² (for the value lens). */
  readonly valueRange: [number, number];

  constructor(readonly map: MapData, seed?: number) {
    this.region = regionFor(map.country);
    this.seed = seed ?? hashString(`${map.name}|${map.center.lat}|${map.center.lon}`);
    const { plots, grid, parcels } = buildPlots(map, this.region, this.seed);
    this.plots = plots;
    this.grid = grid;
    this.parcels = parcels;
    this.owners = generateOwners(plots, map.country, this.seed);
    this.plotById = new Map(plots.map((p) => [p.id, p]));
    this.ownerById = new Map(this.owners.map((o) => [o.id, o]));
    const perM2 = plots.filter((p) => p.kind === 'building').map((p) => p.landValue / p.area).sort((a, b) => a - b);
    this.valueRange = perM2.length ? [perM2[Math.floor(perM2.length * 0.05)], perM2[Math.floor(perM2.length * 0.95)]] : [0, 1];
  }

  plot(id: string): Plot | undefined {
    return this.plotById.get(id);
  }

  owner(id: string): Owner | undefined {
    return this.ownerById.get(id);
  }

  ownerOf(plot: Plot): Owner {
    return this.ownerById.get(plot.ownerId)!;
  }

  statusOf(plotId: string): PlotStatus {
    return this.status.get(plotId) ?? 'not_approached';
  }

  /** Plot under a world point (exact, from the parcel raster). */
  plotAt(x: number, y: number): Plot | null {
    const i = this.grid.index(x, y);
    if (i < 0) return null;
    const k = this.parcels[i];
    return k >= 0 ? this.plots[k] : null;
  }

  /** Calls fn(cellIndex) for every raster cell of a plot. */
  forEachCell(plot: Plot, fn: (i: number) => void) {
    const [x0, y0, x1, y1] = plot.cellBox;
    const w = this.grid.w;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = y * w + x;
      if (this.parcels[i] === plot.index) fn(i);
    }
  }

  /** Parcel outline as flat line segments [x0,y0,x1,y1, ...] in world meters. */
  outline(plot: Plot): number[] {
    const out: number[] = [];
    const g = this.grid, w = g.w, k = plot.index, P = this.parcels;
    const [x0, y0, x1, y1] = plot.cellBox;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (P[y * w + x] !== k) continue;
        const wx = g.minX + x, wy = g.minY + y;
        if (y === 0 || P[(y - 1) * w + x] !== k) out.push(wx, wy, wx + 1, wy);
        if (y === g.h - 1 || P[(y + 1) * w + x] !== k) out.push(wx, wy + 1, wx + 1, wy + 1);
        if (x === 0 || P[y * w + x - 1] !== k) out.push(wx, wy, wx, wy + 1);
        if (x === g.w - 1 || P[y * w + x + 1] !== k) out.push(wx + 1, wy, wx + 1, wy + 1);
      }
    }
    return mergeSegments(out);
  }
}

/** Joins collinear unit segments into longer ones so outlines draw fast. */
function mergeSegments(seg: number[]): number[] {
  const h = new Map<string, number[]>(), v = new Map<string, number[]>();
  for (let i = 0; i < seg.length; i += 4) {
    if (seg[i + 1] === seg[i + 3]) (h.get(`${seg[i + 1]}`) ?? h.set(`${seg[i + 1]}`, []).get(`${seg[i + 1]}`)!).push(seg[i]);
    else (v.get(`${seg[i]}`) ?? v.set(`${seg[i]}`, []).get(`${seg[i]}`)!).push(seg[i + 1]);
  }
  const out: number[] = [];
  for (const [k, xs] of h) {
    const y = parseFloat(k);
    xs.sort((a, b) => a - b);
    let start = xs[0], end = xs[0] + 1;
    for (let i = 1; i <= xs.length; i++) {
      if (i < xs.length && xs[i] === end) { end++; continue; }
      out.push(start, y, end, y);
      if (i < xs.length) { start = xs[i]; end = xs[i] + 1; }
    }
  }
  for (const [k, ys] of v) {
    const x = parseFloat(k);
    ys.sort((a, b) => a - b);
    let start = ys[0], end = ys[0] + 1;
    for (let i = 1; i <= ys.length; i++) {
      if (i < ys.length && ys[i] === end) { end++; continue; }
      out.push(x, start, x, end);
      if (i < ys.length) { start = ys[i]; end = ys[i] + 1; }
    }
  }
  return out;
}
