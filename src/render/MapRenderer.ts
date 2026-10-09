import { Container, Graphics } from 'pixi.js';
import type { FlatPoints, MapArea, MapData, MapRoad } from '../shared/mapTypes';
import { centroid } from '../shared/geometry';
import { hashString } from '../util/random';
import { COLORS, ROAD_STYLES, roofColor, shade } from './styles';

/**
 * Draws the static map into a world-space container (1 unit = 1 meter).
 * Shapes are grouped by color into a few large Graphics so thousands of buildings stay cheap.
 */
export class MapRenderer {
  readonly world = new Container();
  /** Reference image slots (see OverlayManager). */
  readonly overlayBelow = new Container();
  readonly overlayAbove = new Container();
  /** For later milestones: plot highlights, selection, build previews. */
  readonly highlights = new Container();

  /** Player changes: cleared lots and new roads (below buildings), new buildings and previews (above trees). */
  readonly devGround = new Container();
  readonly devTop = new Container();

  private layers: Graphics[] = [];
  /** Baked ground texture (yards, grass, fields) and tree canopy, filled in by Terrain. */
  readonly terrainSlot = new Container();
  readonly canopySlot = new Container();
  /** Moving traffic: above roads, below buildings and trees. */
  readonly lifeSlot = new Container();
  private roadsSlot = new Container();
  private buildingsSlot = new Container();
  private map: MapData | null = null;

  constructor() {
    this.world.sortableChildren = false;
  }

  setMap(map: MapData) {
    this.map = map;
    for (const l of this.layers) l.destroy();
    this.roadsSlot.removeChildren().forEach((c) => c.destroy());
    this.buildingsSlot.removeChildren().forEach((c) => c.destroy());
    this.layers = [];
    this.world.removeChildren();

    const add = (g: Graphics) => {
      this.layers.push(g);
      this.world.addChild(g);
      return g;
    };

    add(this.drawGround(map));
    this.terrainSlot.removeChildren();
    this.canopySlot.removeChildren();
    this.world.addChild(this.terrainSlot);
    add(this.drawPitchLines(map.greens));
    this.world.addChild(this.overlayBelow);
    add(this.drawWater(map));
    this.world.addChild(this.roadsSlot);
    this.world.addChild(this.devGround);
    this.world.addChild(this.lifeSlot);
    this.world.addChild(this.buildingsSlot);
    this.refresh(new Set(), new Set());
    this.world.addChild(this.canopySlot);
    this.world.addChild(this.devTop);
    add(this.drawOutOfBounds(map));
    this.world.addChild(this.highlights);
    this.world.addChild(this.overlayAbove);
  }

  /** Redraws original roads and buildings, leaving out removed roads and demolished buildings. */
  refresh(hiddenBuildings: Set<string>, hiddenRoads: Set<string>) {
    const map = this.map;
    if (!map) return;
    this.roadsSlot.removeChildren().forEach((c) => c.destroy());
    this.buildingsSlot.removeChildren().forEach((c) => c.destroy());
    this.roadsSlot.addChild(this.drawRoads(map.roads.filter((r) => !hiddenRoads.has(r.id))));
    const [shadows, roofs] = this.drawBuildings({ ...map, buildings: map.buildings.filter((b) => !hiddenBuildings.has(b.id)) });
    this.buildingsSlot.addChild(shadows, roofs);
  }

  private drawGround(map: MapData): Graphics {
    const b = map.bounds;
    const m = 3000;
    return new Graphics().rect(b.minX - m, b.minY - m, b.maxX - b.minX + 2 * m, b.maxY - b.minY + 2 * m).fill(COLORS.land);
  }

  /** White markings on sports pitches (the grass itself is in the terrain texture). */
  private drawPitchLines(areas: MapArea[]): Graphics {
    const g = new Graphics();
    for (const a of areas) if (a.kind === 'pitch') g.poly(a.poly).stroke({ width: 0.4, color: 0xffffff, alpha: 0.75 });
    return g;
  }

  private drawWater(map: MapData): Graphics {
    const g = new Graphics();
    for (const a of map.water) {
      g.poly(a.poly).fill(COLORS.water);
      if (a.holes) for (const h of a.holes) g.poly(h).cut();
    }
    // Waterways: an edge stroke first, then the water itself, grouped by width.
    const byWidth = groupBy(map.waterways, (w) => w.width);
    for (const [w, list] of byWidth) {
      for (const ww of list) linePath(g, ww.line);
      g.stroke({ width: w + 2, color: COLORS.waterEdge, cap: 'round', join: 'round' });
    }
    for (const [w, list] of byWidth) {
      for (const ww of list) linePath(g, ww.line);
      g.stroke({ width: w, color: COLORS.water, cap: 'round', join: 'round' });
    }
    return g;
  }

  private drawRoads(roads: MapRoad[]): Graphics {
    const g = new Graphics();
    const groups = groupBy(roads, (r) => `${ROAD_STYLES[r.kind].rank}|${r.kind}|${r.width}`);
    const keys = [...groups.keys()].sort((a, b) => parseInt(a) - parseInt(b));
    // All casings first (so junctions merge cleanly), then fills from minor to major.
    for (const k of keys) {
      const list = groups.get(k)!;
      const { kind, width } = list[0];
      if (kind === 'path' || kind === 'rail') continue;
      for (const r of list) linePath(g, r.line);
      g.stroke({ width: width + 1.4, color: ROAD_STYLES[kind].casing, cap: 'round', join: 'round' });
    }
    for (const k of keys) {
      const list = groups.get(k)!;
      const { kind, width } = list[0];
      const st = ROAD_STYLES[kind];
      for (const r of list) linePath(g, r.line);
      if (kind === 'rail') {
        g.stroke({ width: 2.4, color: st.casing, cap: 'butt', join: 'round' });
        for (const r of list) linePath(g, r.line);
        g.stroke({ width: 0.8, color: 0xd8d8d8, cap: 'butt', join: 'round' });
      } else {
        g.stroke({ width, color: st.fill, cap: 'round', join: 'round' });
      }
    }
    // Centre lines on wide roads.
    for (const r of roads) if (r.width >= 9 && r.kind !== 'rail') linePath(g, r.line);
    g.stroke({ width: 0.25, color: 0xf2efe6, alpha: 0.7 });
    return g;
  }

  private drawBuildings(map: MapData): [Graphics, Graphics] {
    const shadows = new Graphics();
    const roofs = new Graphics();
    const byColor = new Map<number, FlatPoints[]>();
    const push = (c: number, p: FlatPoints) => {
      const arr = byColor.get(c);
      if (arr) arr.push(p);
      else byColor.set(c, [p]);
    };

    // Shadows: offset copy, longer for taller buildings (sun from the north-west).
    for (const b of map.buildings) {
      const off = 0.8 + 0.6 * Math.min(b.levels ?? 1, 12);
      const p = b.poly.map((v, i) => v + (i % 2 === 0 ? off : off * 1.2));
      shadows.poly(p);
    }
    shadows.fill({ color: COLORS.shadow, alpha: 0.22 });

    const domes: [number, number, number][] = [];
    const ridges: number[] = [];
    const tanks: number[][] = [], solar: number[][] = [], stains: number[][] = [];
    for (const b of map.buildings) {
      const h = hashString(b.id);
      // weathering: each roof a little lighter or darker than its neighbours
      const c = shade(roofColor(b), [0.88, 0.95, 1, 1.06][(h >>> 3) % 4]);
      if (b.poly.length === 8) {
        const q = quad(b.poly);
        if (q.len > 4) {
          ridges.push(q.cx - q.ux * q.len * 0.5, q.cy - q.uy * q.len * 0.5, q.cx + q.ux * q.len * 0.5, q.cy + q.uy * q.len * 0.5);
          const roll = (h >>> 8) % 100;
          const at = (u: number, v: number, w: number, d: number) => rectAt(q, u, v, w, d);
          if (roll < 14) tanks.push(at(q.len * 0.3, -q.wid * 0.25, 1.3, 1.3));
          else if (roll < 21) solar.push(at(-q.len * 0.2, -q.wid * 0.25, 2, 1.1));
          else if (roll < 36) stains.push(at(((h >>> 12) % 7 - 3) * q.len * 0.08, ((h >>> 15) % 2 ? 1 : -1) * q.wid * 0.22, q.len * 0.35, q.wid * 0.3));
        }
      }
      const halves = b.poly.length === 8 ? splitGable(b.poly) : null;
      if (halves) {
        push(c, halves[0]);
        push(shade(c, 0.8), halves[1]);
      } else {
        push(c, b.poly);
      }
      if (b.type === 'mosque') {
        const [cx, cy] = centroid(b.poly);
        domes.push([cx, cy, Math.sqrt(approxArea(b.poly)) * 0.28]);
      }
    }
    for (const [c, polys] of byColor) {
      for (const p of polys) roofs.poly(p);
      roofs.fill(c);
    }
    for (const p of stains) roofs.poly(p);
    roofs.fill({ color: 0x3a2a1e, alpha: 0.22 });
    for (let i = 0; i < ridges.length; i += 4) roofs.moveTo(ridges[i], ridges[i + 1]).lineTo(ridges[i + 2], ridges[i + 3]);
    roofs.stroke({ width: 0.25, color: 0x000000, alpha: 0.22 });
    for (const b of map.buildings) roofs.poly(b.poly);
    roofs.stroke({ width: 0.3, color: 0x000000, alpha: 0.28 });
    for (const p of tanks) roofs.poly(p);
    roofs.fill(0xe9edf0).stroke({ width: 0.15, color: 0x7d858c });
    for (const p of solar) roofs.poly(p);
    roofs.fill(0x2d3f5c).stroke({ width: 0.12, color: 0xb9c4d0 });
    for (const [x, y, r] of domes) roofs.circle(x, y, r).fill(0xd9b44a).circle(x - r * 0.25, y - r * 0.25, r * 0.4).fill(0xf0d27a);
    return [shadows, roofs];
  }

  /** Dims everything outside the playable bbox and outlines it. */
  private drawOutOfBounds(map: MapData): Graphics {
    const { minX, minY, maxX, maxY } = map.bounds;
    const m = 3000;
    const g = new Graphics();
    g.rect(minX - m, minY - m, maxX - minX + 2 * m, m)
      .rect(minX - m, maxY, maxX - minX + 2 * m, m)
      .rect(minX - m, minY, m, maxY - minY)
      .rect(maxX, minY, m, maxY - minY)
      .fill({ color: COLORS.outOfBounds, alpha: 0.55 });
    g.rect(minX, minY, maxX - minX, maxY - minY).stroke({ width: 1.5, color: COLORS.boundsLine, alpha: 0.5 });
    return g;
  }
}

// ---------- helpers ----------

function linePath(g: Graphics, line: FlatPoints) {
  g.moveTo(line[0], line[1]);
  for (let i = 2; i < line.length; i += 2) g.lineTo(line[i], line[i + 1]);
}

function groupBy<T, K>(arr: T[], key: (t: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const t of arr) {
    const k = key(t);
    const l = m.get(k);
    if (l) l.push(t);
    else m.set(k, [t]);
  }
  return m;
}

function approxArea(p: FlatPoints): number {
  let a = 0;
  for (let i = 0; i < p.length; i += 2) {
    const j = (i + 2) % p.length;
    a += p[i] * p[j + 1] - p[j] * p[i + 1];
  }
  return Math.abs(a / 2);
}

/**
 * Splits a 4-corner footprint along its long axis into two halves (a gable roof look).
 * Returns [lit half, shaded half] with the shaded half facing south-east.
 */
function splitGable(p: FlatPoints): [FlatPoints, FlatPoints] | null {
  const [x0, y0, x1, y1, x2, y2, x3, y3] = p;
  const e0 = Math.hypot(x1 - x0, y1 - y0);
  const e1 = Math.hypot(x2 - x1, y2 - y1);
  if (Math.min(e0, e1) < 2) return null;
  let a: FlatPoints, b: FlatPoints;
  if (e0 >= e1) {
    // ridge parallel to edge 0-1, through midpoints of edges 1-2 and 3-0
    const m12x = (x1 + x2) / 2, m12y = (y1 + y2) / 2, m30x = (x3 + x0) / 2, m30y = (y3 + y0) / 2;
    a = [x0, y0, x1, y1, m12x, m12y, m30x, m30y];
    b = [m30x, m30y, m12x, m12y, x2, y2, x3, y3];
  } else {
    const m01x = (x0 + x1) / 2, m01y = (y0 + y1) / 2, m23x = (x2 + x3) / 2, m23y = (y2 + y3) / 2;
    a = [x0, y0, m01x, m01y, m23x, m23y, x3, y3];
    b = [m01x, m01y, x1, y1, x2, y2, m23x, m23y];
  }
  const [ax, ay] = centroid(a);
  const [bx, by] = centroid(b);
  return ax + ay <= bx + by ? [a, b] : [b, a];
}

interface Quad { cx: number; cy: number; ux: number; uy: number; len: number; wid: number }

/** Centre, long axis and size of a 4-corner footprint. */
function quad(p: FlatPoints): Quad {
  const [x0, y0, x1, y1, x2, y2, x3, y3] = p;
  const e0 = Math.hypot(x1 - x0, y1 - y0), e1 = Math.hypot(x2 - x1, y2 - y1);
  const cx = (x0 + x1 + x2 + x3) / 4, cy = (y0 + y1 + y2 + y3) / 4;
  if (e0 >= e1) return { cx, cy, ux: (x1 - x0) / e0, uy: (y1 - y0) / e0, len: e0, wid: e1 };
  return { cx, cy, ux: (x2 - x1) / e1, uy: (y2 - y1) / e1, len: e1, wid: e0 };
}

/** A small rectangle on a roof, in the roof's own axes (u along the ridge, v across). */
function rectAt(q: Quad, u: number, v: number, w: number, d: number): FlatPoints {
  const nx = -q.uy, ny = q.ux;
  const cx = q.cx + q.ux * u + nx * v, cy = q.cy + q.uy * u + ny * v;
  const hw = w / 2, hd = d / 2;
  return [
    cx - q.ux * hw - nx * hd, cy - q.uy * hw - ny * hd, cx + q.ux * hw - nx * hd, cy + q.uy * hw - ny * hd,
    cx + q.ux * hw + nx * hd, cy + q.uy * hw + ny * hd, cx - q.ux * hw + nx * hd, cy - q.uy * hw + ny * hd,
  ];
}
