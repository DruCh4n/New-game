import type { FlatPoints, MapBuilding, MapData, RoadKind } from '../shared/mapTypes';
import { bboxOf, centroid, distToSegment, offsetPolygon, pointInPolygon, polygonArea, polygonDistance } from '../shared/geometry';
import { Rng, hashString } from '../util/random';
import { SpatialGrid } from './spatial';
import type { BuildingCategory, LandCategory, Plot, RoadAccess } from './types';
import type { Region } from './regional';

export const PLOT_BUFFER = 2; // meters of yard around each footprint
export const LAND_CELL = 20; // meters, size of empty-land parcels

const CAR_ROADS = new Set<RoadKind>(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential',
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
  grid: SpatialGrid<Plot>;
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
  const waterSegs = new SpatialGrid<{ ax: number; ay: number; bx: number; by: number; half: number }>(40);
  for (const w of map.waterways) {
    for (let i = 0; i < w.line.length - 2; i += 2) {
      const s = { ax: w.line[i], ay: w.line[i + 1], bx: w.line[i + 2], by: w.line[i + 3], half: w.width / 2 + 2 };
      waterSegs.insert(s, Math.min(s.ax, s.bx) - s.half, Math.min(s.ay, s.by) - s.half, Math.max(s.ax, s.bx) + s.half, Math.max(s.ay, s.by) + s.half);
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
  const grid = new SpatialGrid<Plot>(25);
  const stepRound = (v: number) => Math.max(region.priceStep, Math.round(v / region.priceStep) * region.priceStep);

  // ----- building plots -----
  for (const b of map.buildings) {
    const rng = new Rng(seed ^ hashString(b.id));
    const category = categorize(b);
    const poly = offsetPolygon(b.poly, PLOT_BUFFER).map((v) => Math.round(v * 10) / 10);
    const [cx, cy] = centroid(b.poly);
    const footprintArea = polygonArea(b.poly);
    const area = polygonArea(poly);
    const [fmin, fmax] = DEFAULT_FLOORS[category];
    const floors = b.levels ?? (category === 'house' ? (rng.chance(0.22) ? 2 : 1) : rng.int(fmin, fmax));
    const loc = locationFactor(poly);
    const commercialBonus = category === 'shophouse' || category === 'shop' ? 1.12 : 1;
    const condition = rng.range(0.35, 0.9);
    const landValue = area * region.landPerM2 * loc.factor * commercialBonus;
    const buildingValue = footprintArea * floors * region.buildPerM2 * condition * (category === 'outbuilding' ? 0.3 : 1);
    const plot: Plot = {
      id: `p_${b.id}`,
      kind: 'building',
      category,
      buildingId: b.id,
      name: b.name,
      poly,
      footprint: b.poly,
      cx, cy,
      area: Math.round(area),
      footprintArea: Math.round(footprintArea),
      floors,
      floorArea: Math.round(footprintArea * floors),
      road: loc.road,
      access: loc.access,
      mainRoad: loc.main,
      landValue: stepRound(landValue),
      buildingValue: stepRound(buildingValue),
      value: stepRound(landValue + buildingValue),
      ownerId: '',
      neighbors: [],
    };
    plots.push(plot);
    const bb = bboxOf(poly);
    grid.insert(plot, bb.minX, bb.minY, bb.maxX, bb.maxY);
  }

  // ----- empty land cells -----
  const { minX, minY, maxX, maxY } = map.bounds;
  const greensBy = (x: number, y: number): string | null => {
    let found: string | null = null;
    for (const g of map.greens) if (pointInPolygon(x, y, g.poly)) found = g.kind; // later (smaller) areas win
    return found;
  };
  const inWater = (x: number, y: number) =>
    map.water.some((w) => pointInPolygon(x, y, w.poly) && !(w.holes ?? []).some((h) => pointInPolygon(x, y, h))) ||
    [...waterSegs.query(x, y, x, y)].some((s) => distToSegment(x, y, s.ax, s.ay, s.bx, s.by) < s.half);
  const onRoad = (x: number, y: number) =>
    roadGrid.query(x - 1, y - 1, x + 1, y + 1).some((s) => distToSegment(x, y, s.ax, s.ay, s.bx, s.by) < s.half + 1.2);
  const inPlot = (x: number, y: number) => grid.query(x, y, x, y).some((p) => pointInPolygon(x, y, p.poly));

  const S = LAND_CELL;
  const N = 4; // samples per side
  for (let x0 = minX; x0 + S <= maxX + 0.01; x0 += S) {
    for (let y0 = minY; y0 + S <= maxY + 0.01; y0 += S) {
      let free = 0;
      for (let i = 0; i < N; i++)
        for (let j = 0; j < N; j++) {
          const x = x0 + ((i + 0.5) / N) * S, y = y0 + ((j + 0.5) / N) * S;
          if (!inPlot(x, y) && !onRoad(x, y) && !inWater(x, y)) free++;
        }
      if (free < N * N - 2) continue;
      const cx = x0 + S / 2, cy = y0 + S / 2;
      const g = greensBy(cx, cy);
      const category: LandCategory =
        g === 'paddy' || g === 'farmland' || g === 'orchard' ? 'field'
          : g === 'cemetery' ? 'cemetery'
            : g === 'park' || g === 'garden' || g === 'pitch' ? 'park'
              : 'state_land';
      const poly = [x0, y0, x0 + S, y0, x0 + S, y0 + S, x0, y0 + S].map((v) => Math.round(v * 10) / 10);
      const loc = locationFactor(poly);
      const mult = category === 'field' ? 0.35 : category === 'park' ? 0.6 : category === 'cemetery' ? 0.4 : 0.85;
      const landValue = stepRound(S * S * region.landPerM2 * loc.factor * mult);
      const ix = Math.round((x0 - minX) / S), iy = Math.round((y0 - minY) / S);
      const plot: Plot = {
        id: `c_${ix}_${iy}`,
        kind: 'land',
        category,
        poly,
        cx, cy,
        area: S * S,
        footprintArea: 0,
        floors: 0,
        floorArea: 0,
        road: loc.road,
        access: loc.access,
        mainRoad: loc.main,
        landValue,
        buildingValue: 0,
        value: landValue,
        ownerId: '',
        neighbors: [],
      };
      plots.push(plot);
      grid.insert(plot, x0, y0, x0 + S, y0 + S);
    }
  }

  // ----- neighbors -----
  for (const p of plots) {
    const bb = bboxOf(p.poly);
    const set = new Set<string>();
    for (const q of grid.queryUnique(bb.minX - 2, bb.minY - 2, bb.maxX + 2, bb.maxY + 2)) {
      if (q === p || set.has(q.id)) continue;
      if (polygonDistance(p.poly, q.poly) < 1.5) set.add(q.id);
    }
    p.neighbors = [...set];
  }

  return { plots, grid };
}
