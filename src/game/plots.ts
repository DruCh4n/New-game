import type { FlatPoints, MapBuilding, MapData, RoadKind } from '../shared/mapTypes';
import { bboxOf, centroid, distToSegment, offsetPolygon, pointInPolygon, polygonArea } from '../shared/geometry';
import { Rng, hashString } from '../util/random';
import { SpatialGrid } from './spatial';
import { BUILDING, LandGrid, ROAD, WATER } from './LandGrid';
import { seaSampler } from '../shared/sea';
import type { BuildingCategory, LandCategory, Plot, RoadAccess } from './types';
import type { Region } from './regional';

export const PLOT_BUFFER = 2; // meters of yard around each footprint
export const LAND_CELL = 20; // meters, size of empty-land parcels

export const CAR_ROADS = new Set<RoadKind>(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential',
  'unclassified', 'living_street', 'service', 'track']);
const MAIN_ROADS = new Set<RoadKind>(['motorway', 'trunk', 'primary', 'secondary']);
const LOCATION_FACTOR: Partial<Record<RoadKind, number>> = {
  motorway: 1.3, trunk: 1.7, primary: 1.7, secondary: 1.5, tertiary: 1.25, residential: 1.0,
  unclassified: 1.0, living_street: 1.0, service: 0.85, track: 0.75,
};

export function categorize(b: MapBuilding): BuildingCategory {
  const t = b.type, u = b.use ?? '';
  const area = polygonArea(b.poly);
  if (['mosque', 'church', 'temple', 'chapel', 'shrine', 'cathedral', 'religious', 'synagogue', 'monastery'].includes(t) || u === 'place_of_worship') return 'worship';
  if (['school', 'university', 'kindergarten', 'college'].includes(t) || ['school', 'kindergarten', 'college', 'university'].includes(u)) return 'school';
  if (['townhall', 'government', 'public', 'civic', 'hospital', 'fire_station', 'police'].includes(t) ||
    ['townhall', 'police', 'hospital', 'clinic', 'fire_station', 'post_office', 'community_centre', 'library'].includes(u)) return 'civic';
  if (u === 'marketplace' || t === 'market') return 'market';
  if (['industrial', 'warehouse', 'factory', 'manufacture', 'hangar'].includes(t) || u === 'industrial') return 'industrial';
  if (['apartments', 'dormitory', 'hotel'].includes(t)) return 'apartment';
  if (t === 'office' || u.startsWith('office')) return 'office';
  if (['commercial', 'retail', 'kiosk', 'supermarket'].includes(t) || u.startsWith('shop:') || ['restaurant', 'cafe', 'bank', 'pharmacy', 'fast_food'].includes(u)) {
    return area < 160 ? 'shophouse' : 'shop';
  }
  if (['garage', 'garages', 'shed', 'roof', 'carport', 'hut', 'toilets', 'kiosk'].includes(t) || area < 18) return 'outbuilding';
  return 'house';
}

const DEFAULT_FLOORS: Record<BuildingCategory, [number, number]> = {
  house: [1, 2], shophouse: [2, 3], shop: [1, 3], office: [2, 5], industrial: [1, 1], apartment: [4, 8],
  worship: [1, 2], school: [2, 2], civic: [1, 3], market: [1, 2], outbuilding: [1, 1],
};

interface RoadSeg { ax: number; ay: number; bx: number; by: number; half: number; kind: RoadKind; name?: string }

export interface PlotBuildResult {
  plots: Plot[];
  /** Roads, water and building flags on a 1 m raster. */
  grid: LandGrid;
  /** Plot index for every 1 m cell (-1 = road / water). */
  parcels: Int32Array;
}

/** Builds plots from buildings + empty land cells. Owner ids are filled in later. */
export function buildPlots(map: MapData, region: Region, seed: number): PlotBuildResult {
  // ----- road index -----
  const roadGrid = new SpatialGrid<RoadSeg>(40);
  for (const r of map.roads) {
    for (let i = 0; i < r.line.length - 2; i += 2) {
      const s: RoadSeg = { ax: r.line[i], ay: r.line[i + 1], bx: r.line[i + 2], by: r.line[i + 3], half: r.width / 2, kind: r.kind, name: r.name };
      roadGrid.insert(s, Math.min(s.ax, s.bx) - s.half, Math.min(s.ay, s.by) - s.half, Math.max(s.ax, s.bx) + s.half, Math.max(s.ay, s.by) + s.half);
    }
  }

  /**
   * One scan of nearby road segments: nearest car road, nearest road of any kind,
   * and the best road class within reach (which sets the price level).
   */
  const locationFactor = (poly: FlatPoints): { road: RoadAccess | null; access: RoadAccess | null; factor: number; main: boolean } => {
    const R = 60;
    const bb = bboxOf(poly);
    const pts: number[] = [];
    for (let i = 0; i < poly.length; i += 2) {
      const j = (i + 2) % poly.length;
      pts.push(poly[i], poly[i + 1], (poly[i] + poly[j]) / 2, (poly[i + 1] + poly[j + 1]) / 2);
    }
    let road: RoadAccess | null = null;
    let access: RoadAccess | null = null;
    let factor = 0;
    let main = false;
    for (const s of roadGrid.queryUnique(bb.minX - R, bb.minY - R, bb.maxX + R, bb.maxY + R)) {
      if (s.kind === 'rail') continue;
      let d = Infinity;
      for (let i = 0; i < pts.length; i += 2) d = Math.min(d, distToSegment(pts[i], pts[i + 1], s.ax, s.ay, s.bx, s.by) - s.half);
      d = Math.round(Math.max(0, d) * 10) / 10;
      if (d > R) continue;
      if (!access || d < access.distance) access = { kind: s.kind, name: s.name, distance: d };
      if (!CAR_ROADS.has(s.kind)) continue;
      if (d <= 40 && (!road || d < road.distance)) road = { kind: s.kind, name: s.name, distance: d };
      const reach = s.kind === 'service' || s.kind === 'track' ? 15 : 25;
      if (d <= reach) factor = Math.max(factor, LOCATION_FACTOR[s.kind] ?? 1);
      if (MAIN_ROADS.has(s.kind) && d < 20) main = true;
    }
    return { road, access, factor: factor || 0.7, main };
  };

  const plots: Plot[] = [];
  const stepRound = (v: number) => Math.max(region.priceStep, Math.round(v / region.priceStep) * region.priceStep);
  const { minX, minY, maxX, maxY } = map.bounds;

  // ----- 1. raster of roads, water and buildings -----
  const grid = new LandGrid(minX, minY, maxX, maxY);
  for (const w of map.water) {
    grid.setPolygon(w.poly, WATER, true);
    for (const h of w.holes ?? []) grid.setPolygon(h, WATER, false);
  }
  for (const w of map.waterways) grid.forLine(w.line, w.width / 2, (i) => (grid.flags[i] |= WATER));
  const isSea = seaSampler(map);
  if (isSea) {
    for (let y = 0; y < grid.h; y++) for (let x = 0; x < grid.w; x++) {
      if (isSea(minX + x + 0.5, minY + y + 0.5)) grid.flags[y * grid.w + x] |= WATER;
    }
  }
  for (const r of map.roads) {
    if (r.kind === 'rail') grid.forLine(r.line, r.width / 2, (i) => (grid.flags[i] |= WATER)); // rails block like water
    else grid.addRoad(r.line, r.width, CAR_ROADS.has(r.kind), 1);
  }
  for (const b of map.buildings) grid.setPolygon(b.poly, BUILDING, true);
  const N = grid.w * grid.h;
  const parcels = new Int32Array(N).fill(-1);
  const blocked = (i: number) => (grid.flags[i] & (ROAD | WATER)) !== 0;

  // ----- 2. building plots, seeded with their footprints -----
  for (const b of map.buildings) {
    const rng = new Rng(seed ^ hashString(b.id));
    const category = categorize(b);
    const poly = offsetPolygon(b.poly, PLOT_BUFFER).map((v) => Math.round(v * 10) / 10);
    const [cx, cy] = centroid(b.poly);
    const footprintArea = polygonArea(b.poly);
    const [fmin, fmax] = DEFAULT_FLOORS[category];
    const floors = b.levels ?? (category === 'house' ? (rng.chance(0.22) ? 2 : 1) : rng.int(fmin, fmax));
    const index = plots.length;
    plots.push({
      id: `p_${b.id}`, index, kind: 'building', category, buildingId: b.id, name: b.name, poly, footprint: b.poly,
      cx, cy, area: 0, footprintArea: Math.round(footprintArea), floors, floorArea: Math.round(footprintArea * floors),
      road: null, access: null, mainRoad: false, landValue: 0, buildingValue: 0, value: 0, ownerId: '', neighbors: [], cellBox: [0, 0, 0, 0],
    });
    grid.forPolygon(b.poly, (i) => { if (parcels[i] < 0) parcels[i] = index; });
  }

  // ----- 3. grow parcels outward (nearest building wins), at most 10 m -----
  const dist = new Uint16Array(N);
  let queue = new Int32Array(N);
  let qh = 0, qt = 0;
  for (let i = 0; i < N; i++) if (parcels[i] >= 0) queue[qt++] = i;
  const grow = (limit: number) => {
    while (qh < qt) {
      const i = queue[qh++];
      const d = dist[i] + 1;
      if (d > limit) continue;
      const x = i % grid.w;
      const nbs = [x > 0 ? i - 1 : -1, x < grid.w - 1 ? i + 1 : -1, i - grid.w, i + grid.w];
      for (const j of nbs) {
        if (j < 0 || j >= N || parcels[j] >= 0 || blocked(j)) continue;
        parcels[j] = parcels[i];
        dist[j] = d;
        queue[qt++] = j;
      }
    }
  };
  grow(10);

  // ----- 4. leftover open land in 20 m squares: state land, parks, fields, cemeteries -----
  const greensBy = (x: number, y: number): string | null => {
    let found: string | null = null;
    for (const g of map.greens) if (pointInPolygon(x, y, g.poly)) found = g.kind; // later (smaller) areas win
    return found;
  };
  const S = LAND_CELL;
  for (let y0 = minY; y0 + S <= maxY + 0.01; y0 += S) {
    for (let x0 = minX; x0 + S <= maxX + 0.01; x0 += S) {
      const cells: number[] = [];
      for (let yy = 0; yy < S; yy++) for (let xx = 0; xx < S; xx++) {
        const i = grid.index(x0 + xx + 0.5, y0 + yy + 0.5);
        if (i >= 0 && parcels[i] < 0 && !blocked(i)) cells.push(i);
      }
      if (cells.length < S * S * 0.5) continue;
      const cx = x0 + S / 2, cy = y0 + S / 2;
      const g = greensBy(cx, cy);
      const category: LandCategory =
        g === 'paddy' || g === 'farmland' || g === 'orchard' ? 'field'
          : g === 'cemetery' ? 'cemetery'
            : g === 'park' || g === 'garden' || g === 'pitch' ? 'park'
              : 'state_land';
      const ix = Math.round((x0 - minX) / S), iy = Math.round((y0 - minY) / S);
      const index = plots.length;
      plots.push({
        id: `c_${ix}_${iy}`, index, kind: 'land', category,
        poly: [x0, y0, x0 + S, y0, x0 + S, y0 + S, x0, y0 + S].map((v) => Math.round(v * 10) / 10),
        cx, cy, area: 0, footprintArea: 0, floors: 0, floorArea: 0, road: null, access: null, mainRoad: false,
        landValue: 0, buildingValue: 0, value: 0, ownerId: '', neighbors: [], cellBox: [0, 0, 0, 0],
      });
      for (const i of cells) { parcels[i] = index; dist[i] = 0; queue[qt++] = i; }
    }
  }

  // ----- 5. fill every remaining open cell from its nearest parcel (no slivers of no-man's land) -----
  qh = 0;
  qt = 0;
  queue = new Int32Array(N);
  for (let i = 0; i < N; i++) if (parcels[i] >= 0) { queue[qt++] = i; dist[i] = 0; }
  grow(1e4);

  // ----- 6. areas, bounding boxes, neighbours from the raster -----
  const counts = new Int32Array(plots.length);
  const box = new Int32Array(plots.length * 4);
  for (let k = 0; k < plots.length; k++) { box[k * 4] = grid.w; box[k * 4 + 1] = grid.h; box[k * 4 + 2] = -1; box[k * 4 + 3] = -1; }
  const pairs = new Set<number>();
  const P = plots.length;
  for (let i = 0; i < N; i++) {
    const p = parcels[i];
    if (p < 0) continue;
    counts[p]++;
    const x = i % grid.w, y = (i / grid.w) | 0;
    if (x < box[p * 4]) box[p * 4] = x;
    if (y < box[p * 4 + 1]) box[p * 4 + 1] = y;
    if (x > box[p * 4 + 2]) box[p * 4 + 2] = x;
    if (y > box[p * 4 + 3]) box[p * 4 + 3] = y;
    // neighbours: adjacent parcels, or across a narrow road/path (≤ 5 m)
    for (const [step, maxD] of [[1, grid.w - 1 - x], [grid.w, grid.h - 1 - y]] as const) {
      for (let d = 1; d <= Math.min(5, maxD); d++) {
        const q = parcels[i + step * d];
        if (q < 0 && blocked(i + step * d)) continue;
        if (q >= 0 && q !== p) pairs.add(p < q ? p * P + q : q * P + p);
        break;
      }
    }
  }
  for (const key of pairs) {
    const a = Math.floor(key / P), b = key % P;
    plots[a].neighbors.push(plots[b].id);
    plots[b].neighbors.push(plots[a].id);
  }

  // ----- 7. values -----
  for (const p of plots) {
    const k = p.index;
    p.area = counts[k];
    p.cellBox = [box[k * 4], box[k * 4 + 1], box[k * 4 + 2], box[k * 4 + 3]];
    const loc = locationFactor(p.poly);
    p.road = loc.road;
    p.access = loc.access;
    p.mainRoad = loc.main;
    if (p.kind === 'building') {
      const rng = new Rng(seed ^ hashString(`${p.buildingId}|cond`));
      const commercialBonus = p.category === 'shophouse' || p.category === 'shop' ? 1.12 : 1;
      const condition = rng.range(0.35, 0.9);
      const landValue = p.area * region.landPerM2 * loc.factor * commercialBonus;
      const buildingValue = p.floorArea * region.buildPerM2 * condition * (p.category === 'outbuilding' ? 0.3 : 1);
      p.landValue = stepRound(landValue);
      p.buildingValue = stepRound(buildingValue);
      p.value = stepRound(landValue + buildingValue);
    } else {
      const mult = p.category === 'field' ? 0.35 : p.category === 'park' ? 0.6 : p.category === 'cemetery' ? 0.4 : 0.85;
      p.landValue = p.value = stepRound(p.area * region.landPerM2 * loc.factor * mult);
    }
  }

  return { plots, grid, parcels };
}
