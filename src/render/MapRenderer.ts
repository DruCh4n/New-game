import { Container, Graphics } from 'pixi.js';
import type { FlatPoints, MapArea, MapData, MapRoad } from '../shared/mapTypes';
import { centroid } from '../shared/geometry';
import { hashString } from '../util/random';
import { COLORS, GREEN_COLORS, LANDUSE_COLORS, ROAD_STYLES, roofColor, shade } from './styles';

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
    add(this.drawAreas(map.landuse, (k) => LANDUSE_COLORS[k] ?? 0xd3d0c4, 1));
    add(this.drawAreas(map.greens, (k) => GREEN_COLORS[k] ?? GREEN_COLORS.grass, 1, true));
    this.world.addChild(this.overlayBelow);
    add(this.drawWater(map));
    this.world.addChild(this.roadsSlot);
    this.world.addChild(this.devGround);
    this.world.addChild(this.buildingsSlot);
    this.refresh(new Set(), new Set());
    add(this.drawTrees(map.trees));
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

  private drawAreas(areas: MapArea[], color: (kind: string) => number, alpha: number, outline = false): Graphics {
    const g = new Graphics();
    // Larger areas first so small parks/pitches drawn later stay visible.
    const sorted = [...areas].sort((a, b) => approxArea(b.poly) - approxArea(a.poly));
    for (const a of sorted) {
      const c = color(a.kind);
      g.poly(a.poly).fill({ color: c, alpha });
      if (a.holes) for (const h of a.holes) g.poly(h).cut();
      if (outline) g.poly(a.poly).stroke({ width: 0.6, color: shade(c, 0.85), alpha: 0.8 });
      if (a.kind === 'pitch') g.poly(a.poly).stroke({ width: 0.4, color: 0xffffff, alpha: 0.7 });
      if (a.kind === 'paddy') drawPaddyLines(g, a.poly);
    }
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
    for (const b of map.buildings) {
      const c = roofColor(b);
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
    for (const b of map.buildings) roofs.poly(b.poly);
    roofs.stroke({ width: 0.3, color: 0x000000, alpha: 0.28 });
    for (const [x, y, r] of domes) roofs.circle(x, y, r).fill(0xd9b44a).circle(x - r * 0.25, y - r * 0.25, r * 0.4).fill(0xf0d27a);
    return [shadows, roofs];
  }

  private drawTrees(trees: FlatPoints): Graphics {
    const g = new Graphics();
    const radius = (i: number) => 1.8 + (hashString(String(i)) % 100) / 60;
    for (let i = 0; i < trees.length; i += 2) g.circle(trees[i] + 0.8, trees[i + 1] + 1, radius(i));
    g.fill({ color: 0x000000, alpha: 0.18 });
    for (let i = 0; i < trees.length; i += 2) g.circle(trees[i], trees[i + 1], radius(i));
    g.fill(COLORS.treeDark);
    for (let i = 0; i < trees.length; i += 2) g.circle(trees[i] - 0.4, trees[i + 1] - 0.5, radius(i) * 0.6);
    g.fill(COLORS.treeLight);
    return g;
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

/** Thin parallel lines across paddy fields (dykes between rice terraces). */
function drawPaddyLines(g: Graphics, poly: FlatPoints) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < poly.length; i += 2) {
    minX = Math.min(minX, poly[i]); maxX = Math.max(maxX, poly[i]);
    minY = Math.min(minY, poly[i + 1]); maxY = Math.max(maxY, poly[i + 1]);
  }
  // Clip each horizontal scanline to the polygon (even-odd crossings).
  for (let y = minY + 6; y < maxY; y += 12) {
    const xs: number[] = [];
    for (let i = 0; i < poly.length; i += 2) {
      const j = (i + 2) % poly.length;
      const ya = poly[i + 1], yb = poly[j + 1];
      if ((ya > y) !== (yb > y)) xs.push(poly[i] + ((y - ya) / (yb - ya)) * (poly[j] - poly[i]));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) g.moveTo(xs[k], y).lineTo(xs[k + 1], y);
  }
  g.stroke({ width: 0.35, color: 0x8fae68, alpha: 0.8 });
}
