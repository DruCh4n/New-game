/**
 * Turns a raw Overpass API JSON response (`out geom`) into the game's MapData format.
 * Pure function, no network: used by import-osm.ts and by the importer test.
 */
import {
  MAP_FORMAT,
  MAP_VERSION,
  type BBox,
  type FlatPoints,
  type MapArea,
  type MapBuilding,
  type MapData,
  type MapRoad,
  type MapWaterway,
  type RoadKind,
} from '../../src/shared/mapTypes.ts';
import { LocalProjection } from '../../src/shared/projection.ts';
import { bboxOf, centroid, polygonArea, roundPoints, simplifyLine } from '../../src/shared/geometry.ts';

type Tags = Record<string, string>;
interface LatLonPt { lat: number; lon: number }
interface OsmNode { type: 'node'; id: number; lat: number; lon: number; tags?: Tags }
interface OsmWay { type: 'way'; id: number; tags?: Tags; geometry?: (LatLonPt | null)[] }
interface OsmMember { type: string; ref: number; role: string; geometry?: (LatLonPt | null)[] }
interface OsmRelation { type: 'relation'; id: number; tags?: Tags; members?: OsmMember[] }
type OsmElement = OsmNode | OsmWay | OsmRelation;
export interface OverpassResponse { elements: OsmElement[] }

export function buildOverpassQuery(b: BBox): string {
  const bb = `${b.south},${b.west},${b.north},${b.east}`;
  return `[out:json][timeout:120][bbox:${bb}];
(
  way["building"];
  relation["building"]["type"="multipolygon"];
  way["highway"];
  way["railway"~"^(rail|light_rail|tram|subway|narrow_gauge)$"];
  way["natural"="water"];
  relation["natural"="water"];
  way["water"];
  way["waterway"];
  relation["waterway"="riverbank"];
  way["leisure"~"^(park|garden|playground|pitch|golf_course|nature_reserve|recreation_ground)$"];
  relation["leisure"~"^(park|garden|nature_reserve)$"];
  way["landuse"];
  relation["landuse"];
  way["natural"~"^(wood|scrub|grassland|wetland|heath)$"];
  relation["natural"~"^(wood|scrub|wetland)$"];
  way["amenity"~"^(grave_yard)$"];
  node["natural"="tree"];
);
out geom qt;`;
}

const ROAD_WIDTH: Record<RoadKind, number> = {
  motorway: 16, trunk: 14, primary: 12, secondary: 10, tertiary: 8, residential: 6,
  unclassified: 5.5, living_street: 4.5, service: 3.5, track: 3, pedestrian: 4, path: 1.6, rail: 3,
};

function roadKind(t: Tags): RoadKind | null {
  if (t.railway) return t.railway === 'abandoned' || t.railway === 'disused' ? null : 'rail';
  const h = t.highway;
  if (!h) return null;
  const base = h.replace(/_link$/, '');
  switch (base) {
    case 'motorway': case 'trunk': case 'primary': case 'secondary': case 'tertiary':
    case 'residential': case 'unclassified': case 'living_street': case 'service':
    case 'track': case 'pedestrian':
      return base;
    case 'road': return 'unclassified';
    case 'footway': case 'path': case 'cycleway': case 'steps': case 'bridleway': case 'corridor':
      return t.area === 'yes' ? null : 'path';
    default: return null; // construction, proposed, bus_stop, ...
  }
}

function parseNum(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const n = parseFloat(v.replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function roadWidth(kind: RoadKind, t: Tags): number {
  const w = parseNum(t.width);
  if (w && w < 60) return w;
  const lanes = parseNum(t.lanes);
  if (lanes && kind !== 'path' && kind !== 'rail') return Math.max(ROAD_WIDTH[kind] * 0.7, Math.min(lanes * 3.2, 30));
  return ROAD_WIDTH[kind];
}

function waterwayWidth(t: Tags): number | null {
  const w = parseNum(t.width);
  switch (t.waterway) {
    case 'river': return w ?? 18;
    case 'canal': return w ?? 8;
    case 'stream': return w ?? 3;
    case 'drain': case 'ditch': return w ?? 1.5;
    default: return null; // riverbank, dam, weir, ... handled elsewhere or ignored
  }
}

const GREEN_KINDS: Record<string, string> = {
  park: 'park', garden: 'garden', playground: 'park', pitch: 'pitch', golf_course: 'grass',
  nature_reserve: 'forest', recreation_ground: 'park',
  grass: 'grass', meadow: 'grass', village_green: 'grass', recreation_ground_lu: 'park',
  forest: 'forest', wood: 'forest', scrub: 'scrub', grassland: 'grass', heath: 'scrub', wetland: 'wetland',
  farmland: 'farmland', orchard: 'orchard', vineyard: 'orchard', plantation: 'orchard',
  paddy: 'paddy', allotments: 'garden', cemetery: 'cemetery', grave_yard: 'cemetery',
};

function greenKind(t: Tags): string | null {
  if (t.leisure && GREEN_KINDS[t.leisure]) return GREEN_KINDS[t.leisure];
  if (t.natural && GREEN_KINDS[t.natural]) return GREEN_KINDS[t.natural];
  if (t.amenity === 'grave_yard') return 'cemetery';
  if (t.landuse) {
    if (t.landuse === 'recreation_ground') return 'park';
    if (t.landuse === 'farmland' && /rice|paddy/.test(t.crop ?? '')) return 'paddy';
    if (GREEN_KINDS[t.landuse]) return GREEN_KINDS[t.landuse];
  }
  return null;
}

const LANDUSE_KINDS = new Set(['residential', 'commercial', 'retail', 'industrial', 'construction',
  'religious', 'education', 'institutional', 'railway', 'military', 'brownfield', 'garages']);

function isWaterArea(t: Tags): boolean {
  return t.natural === 'water' || t.waterway === 'riverbank' || t.landuse === 'reservoir' || t.landuse === 'basin' || !!t.water;
}

/** Joins open member ways into closed rings (for multipolygon relations). */
function assembleRings(segments: LatLonPt[][]): LatLonPt[][] {
  const key = (p: LatLonPt) => `${p.lat.toFixed(7)},${p.lon.toFixed(7)}`;
  const rings: LatLonPt[][] = [];
  const open = segments.filter((s) => s.length >= 2).map((s) => s.slice());
  while (open.length) {
    let cur = open.shift()!;
    let guard = 0;
    while (key(cur[0]) !== key(cur[cur.length - 1]) && guard++ < 10000) {
      const endK = key(cur[cur.length - 1]);
      const idx = open.findIndex((s) => key(s[0]) === endK || key(s[s.length - 1]) === endK);
      if (idx < 0) break; // can't close (clipped by bbox) – keep as-is
      const s = open.splice(idx, 1)[0];
      if (key(s[0]) === endK) cur = cur.concat(s.slice(1));
      else cur = cur.concat(s.slice(0, -1).reverse());
    }
    if (cur.length >= 4) rings.push(cur);
  }
  return rings;
}

export interface ProcessOptions {
  name: string;
  bbox: BBox;
  country?: string;
}

export interface ProcessStats {
  buildings: number;
  roads: number;
  water: number;
  waterways: number;
  greens: number;
  landuse: number;
  trees: number;
  skipped: number;
}

export function processOverpass(raw: OverpassResponse, opts: ProcessOptions): { map: MapData; stats: ProcessStats } {
  const { bbox } = opts;
  const center = { lat: (bbox.south + bbox.north) / 2, lon: (bbox.west + bbox.east) / 2 };
  const proj = new LocalProjection(center);
  const [minX, maxY] = proj.toLocal(bbox.south, bbox.west);
  const [maxX, minY] = proj.toLocal(bbox.north, bbox.east);
  const bounds = { minX, minY, maxX, maxY };
  const margin = 60; // keep features slightly beyond the bbox so edges don't look cut

  const project = (pts: (LatLonPt | null)[]): FlatPoints => {
    const out: FlatPoints = [];
    for (const p of pts) {
      if (!p) continue;
      const [x, y] = proj.toLocal(p.lat, p.lon);
      out.push(x, y);
    }
    return out;
  };
  const toRing = (pts: (LatLonPt | null)[]): FlatPoints | null => {
    let f = project(pts);
    if (f.length >= 4 && f[0] === f[f.length - 2] && f[1] === f[f.length - 1]) f = f.slice(0, -2);
    if (f.length < 6) return null;
    return roundPoints(f);
  };
  const intersectsBounds = (p: FlatPoints, m = margin) => {
    const b = bboxOf(p);
    return b.maxX >= minX - m && b.minX <= maxX + m && b.maxY >= minY - m && b.minY <= maxY + m;
  };

  const buildings: MapBuilding[] = [];
  const roads: MapRoad[] = [];
  const water: MapArea[] = [];
  const waterways: MapWaterway[] = [];
  const greens: MapArea[] = [];
  const landuse: MapArea[] = [];
  const trees: FlatPoints = [];
  let skipped = 0;

  const addArea = (target: MapArea[], id: string, kind: string, outer: FlatPoints, holes?: FlatPoints[]) => {
    if (!intersectsBounds(outer)) return;
    target.push(holes && holes.length ? { id, kind, poly: outer, holes } : { id, kind, poly: outer });
  };

  const addBuilding = (id: string, t: Tags, poly: FlatPoints) => {
    const [cx, cy] = centroid(poly);
    // Only buildings whose center is inside the requested area become plots.
    if (cx < minX || cx > maxX || cy < minY || cy > maxY) return;
    if (polygonArea(poly) < 4) { skipped++; return; }
    const b: MapBuilding = { id, type: t.building === 'yes' ? 'yes' : t.building || 'yes', poly };
    const use = t.amenity || t.shop || t.office || t.tourism || t.craft;
    if (use) b.use = t.shop ? `shop:${t.shop}` : use;
    const lv = parseNum(t['building:levels']);
    if (lv) b.levels = Math.round(lv);
    if (t.name) b.name = t.name;
    buildings.push(b);
  };

  for (const el of raw.elements) {
    const t = el.tags ?? {};
    if (el.type === 'node') {
      if (t.natural === 'tree') {
        const [x, y] = proj.toLocal(el.lat, el.lon);
        if (x >= minX && x <= maxX && y >= minY && y <= maxY) trees.push(Math.round(x * 10) / 10, Math.round(y * 10) / 10);
      }
      continue;
    }

    if (el.type === 'way') {
      const geom = el.geometry ?? [];
      const id = `w${el.id}`;
      const closed = geom.length >= 4 && !!geom[0] && !!geom[geom.length - 1] &&
        geom[0]!.lat === geom[geom.length - 1]!.lat && geom[0]!.lon === geom[geom.length - 1]!.lon;

      if (t.building && t.building !== 'no' && closed) {
        const ring = toRing(geom);
        if (ring) addBuilding(id, t, ring);
        else skipped++;
        continue;
      }
      const rk = roadKind(t);
      if (rk && !(closed && t.area === 'yes')) {
        const line = roundPoints(simplifyLine(project(geom), 0.3));
        if (line.length >= 4 && intersectsBounds(line, 200)) {
          const r: MapRoad = { id, kind: rk, width: roadWidth(rk, t), line };
          if (t.name) r.name = t.name;
          if (t.bridge && t.bridge !== 'no') r.bridge = true;
          roads.push(r);
        }
        continue;
      }
      const ww = t.waterway ? waterwayWidth(t) : null;
      if (ww !== null && !closed) {
        const line = roundPoints(simplifyLine(project(geom), 0.5));
        if (line.length >= 4 && intersectsBounds(line, 200)) waterways.push({ id, kind: t.waterway, width: ww, line });
        continue;
      }
      if (!closed) continue;
      const ring = toRing(geom);
      if (!ring) continue;
      if (isWaterArea(t)) addArea(water, id, t.water || 'water', ring);
      else {
        const g = greenKind(t);
        if (g) addArea(greens, id, g, ring);
        else if (t.landuse && LANDUSE_KINDS.has(t.landuse)) addArea(landuse, id, t.landuse, ring);
      }
      continue;
    }

    // Multipolygon relations
    if (el.type === 'relation' && el.members) {
      const outers = assembleRings(el.members.filter((m) => m.type === 'way' && m.role !== 'inner' && m.geometry)
        .map((m) => m.geometry!.filter((p): p is LatLonPt => !!p)));
      const inners = assembleRings(el.members.filter((m) => m.type === 'way' && m.role === 'inner' && m.geometry)
        .map((m) => m.geometry!.filter((p): p is LatLonPt => !!p)));
      const innerRings = inners.map((r) => toRing(r)).filter((r): r is FlatPoints => !!r);
      outers.forEach((o, i) => {
        const ring = toRing(o);
        if (!ring) return;
        const id = `r${el.id}${outers.length > 1 ? `_${i}` : ''}`;
        if (t.building) return addBuilding(id, t, ring);
        // Assign holes that lie inside this outer ring (cheap bbox test is enough here)
        const ob = bboxOf(ring);
        const holes = innerRings.filter((h) => {
          const hb = bboxOf(h);
          return hb.minX >= ob.minX && hb.maxX <= ob.maxX && hb.minY >= ob.minY && hb.maxY <= ob.maxY;
        });
        if (isWaterArea(t)) addArea(water, id, 'water', ring, holes);
        else {
          const g = greenKind(t);
          if (g) addArea(greens, id, g, ring, holes);
          else if (t.landuse && LANDUSE_KINDS.has(t.landuse)) addArea(landuse, id, t.landuse, ring, holes);
        }
      });
    }
  }

  const map: MapData = {
    format: MAP_FORMAT,
    version: MAP_VERSION,
    name: opts.name,
    country: opts.country,
    source: 'osm',
    attribution: '© OpenStreetMap contributors (ODbL)',
    importedAt: new Date().toISOString(),
    center,
    bbox,
    bounds: roundBounds(bounds),
    buildings,
    roads,
    water,
    waterways,
    greens,
    landuse,
    trees,
  };
  return {
    map,
    stats: {
      buildings: buildings.length, roads: roads.length, water: water.length, waterways: waterways.length,
      greens: greens.length, landuse: landuse.length, trees: trees.length / 2, skipped,
    },
  };
}

function roundBounds(b: MapData['bounds']): MapData['bounds'] {
  const r = (v: number) => Math.round(v * 10) / 10;
  return { minX: r(b.minX), minY: r(b.minY), maxX: r(b.maxX), maxY: r(b.maxY) };
}
