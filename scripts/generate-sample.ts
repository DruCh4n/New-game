/**
 * Generates a SYNTHETIC ~1 km² Indonesian kampung in the same format as imported OSM maps,
 * so the game can be tried without running the importer. Not real data.
 *
 *   npm run sample-map
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAP_FORMAT, MAP_VERSION, type FlatPoints, type MapArea, type MapBuilding, type MapData, type MapRoad, type RoadKind } from '../src/shared/mapTypes.ts';
import { LocalProjection } from '../src/shared/projection.ts';
import { distToSegment, pointInPolygon, roundPoints } from '../src/shared/geometry.ts';
import { Rng } from '../src/util/random.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rng = new Rng(20261009);
const HALF = 500;
const center = { lat: -7.7956, lon: 110.3695 };
const proj = new LocalProjection(center);

type Pt = [number, number];
const roads: MapRoad[] = [];
const buildings: MapBuilding[] = [];
const greens: MapArea[] = [];
const landuse: MapArea[] = [];
const trees: FlatPoints = [];
let nextId = 1;
const id = (p: string) => `${p}${nextId++}`;

// ---------- helpers ----------
function wobblyLine(a: Pt, b: Pt, amp: number, step = 40): Pt[] {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  const n = Math.max(2, Math.round(len / step));
  const nx = -dy / len, ny = dx / len;
  const phase = rng.range(0, Math.PI * 2), freq = rng.range(1.2, 2.5);
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const off = i === 0 || i === n ? 0 : Math.sin(t * Math.PI * freq + phase) * amp + rng.range(-amp, amp) * 0.25;
    pts.push([a[0] + dx * t + nx * off, a[1] + dy * t + ny * off]);
  }
  return pts;
}
const flat = (pts: Pt[]): FlatPoints => roundPoints(pts.flat());

function addRoad(kind: RoadKind, width: number, pts: Pt[], name?: string): MapRoad {
  const r: MapRoad = { id: id('r'), kind, width, line: flat(pts) };
  if (name) r.name = name;
  roads.push(r);
  return r;
}

/** Polygon around a polyline (simple per-vertex offset). */
function bufferLine(pts: Pt[], half: number): FlatPoints {
  const left: Pt[] = [], right: Pt[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    const nx = -dy / l, ny = dx / l;
    left.push([pts[i][0] + nx * half, pts[i][1] + ny * half]);
    right.push([pts[i][0] - nx * half, pts[i][1] - ny * half]);
  }
  return flat([...left, ...right.reverse()]);
}

function rect(cx: number, cy: number, angle: number, w: number, d: number): FlatPoints {
  const ux = Math.cos(angle), uy = Math.sin(angle), nx = -uy, ny = ux;
  const hw = w / 2, hd = d / 2;
  return [
    cx - ux * hw - nx * hd, cy - uy * hw - ny * hd,
    cx + ux * hw - nx * hd, cy + uy * hw - ny * hd,
    cx + ux * hw + nx * hd, cy + uy * hw + ny * hd,
    cx - ux * hw + nx * hd, cy - uy * hw + ny * hd,
  ];
}

// ---------- spatial indexes ----------
const CELL = 25;
interface Seg { ax: number; ay: number; bx: number; by: number; half: number }
const segGrid = new Map<string, Seg[]>();
const polyGrid = new Map<string, FlatPoints[]>();
const cellKey = (cx: number, cy: number) => `${cx},${cy}`;

function indexRoad(r: MapRoad | { line: FlatPoints; width: number }) {
  const l = r.line;
  for (let i = 0; i < l.length - 2; i += 2) {
    const s: Seg = { ax: l[i], ay: l[i + 1], bx: l[i + 2], by: l[i + 3], half: r.width / 2 };
    const pad = s.half + 2;
    for (let cx = Math.floor((Math.min(s.ax, s.bx) - pad) / CELL); cx <= Math.floor((Math.max(s.ax, s.bx) + pad) / CELL); cx++)
      for (let cy = Math.floor((Math.min(s.ay, s.by) - pad) / CELL); cy <= Math.floor((Math.max(s.ay, s.by) + pad) / CELL); cy++) {
        const k = cellKey(cx, cy);
        (segGrid.get(k) ?? segGrid.set(k, []).get(k)!).push(s);
      }
  }
}
function nearestSeg(x: number, y: number, radius: number): { seg: Seg; edge: number } | null {
  let best: Seg | null = null, bestD = Infinity;
  const r = Math.ceil(radius / CELL);
  const cx0 = Math.floor(x / CELL), cy0 = Math.floor(y / CELL);
  for (let cx = cx0 - r; cx <= cx0 + r; cx++)
    for (let cy = cy0 - r; cy <= cy0 + r; cy++)
      for (const s of segGrid.get(cellKey(cx, cy)) ?? []) {
        const d = distToSegment(x, y, s.ax, s.ay, s.bx, s.by) - s.half;
        if (d < bestD) { bestD = d; best = s; }
      }
  return best && bestD <= radius ? { seg: best, edge: bestD } : null;
}
function clearOfRoads(poly: FlatPoints, clearance: number): boolean {
  // test corners, edge midpoints and center
  const pts: number[] = [...poly];
  for (let i = 0; i < poly.length; i += 2) {
    const j = (i + 2) % poly.length;
    pts.push((poly[i] + poly[j]) / 2, (poly[i + 1] + poly[j + 1]) / 2);
  }
  for (let i = 0; i < pts.length; i += 2) {
    const n = nearestSeg(pts[i], pts[i + 1], clearance + 1);
    if (n && n.edge < clearance) return false;
  }
  return true;
}

function sat(a: FlatPoints, b: FlatPoints): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i += 2) {
      const j = (i + 2) % poly.length;
      const nx = poly[j + 1] - poly[i + 1], ny = poly[i] - poly[j];
      let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
      for (let k = 0; k < a.length; k += 2) { const p = a[k] * nx + a[k + 1] * ny; minA = Math.min(minA, p); maxA = Math.max(maxA, p); }
      for (let k = 0; k < b.length; k += 2) { const p = b[k] * nx + b[k + 1] * ny; minB = Math.min(minB, p); maxB = Math.max(maxB, p); }
      if (maxA <= minB || maxB <= minA) return false;
    }
  }
  return true;
}
function polyCells(p: FlatPoints): string[] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < p.length; i += 2) { minX = Math.min(minX, p[i]); maxX = Math.max(maxX, p[i]); minY = Math.min(minY, p[i + 1]); maxY = Math.max(maxY, p[i + 1]); }
  const out: string[] = [];
  for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++)
    for (let cy = Math.floor(minY / CELL); cy <= Math.floor(maxY / CELL); cy++) out.push(cellKey(cx, cy));
  return out;
}
function collides(p: FlatPoints): boolean {
  for (const k of polyCells(p)) for (const q of polyGrid.get(k) ?? []) if (sat(p, q)) return true;
  return false;
}
function reserve(p: FlatPoints) {
  for (const k of polyCells(p)) (polyGrid.get(k) ?? polyGrid.set(k, []).get(k)!).push(p);
}
const exclusions: FlatPoints[] = [];
function inExclusion(p: FlatPoints): boolean {
  for (let i = 0; i < p.length; i += 2) {
    if (Math.abs(p[i]) > HALF - 3 || Math.abs(p[i + 1]) > HALF - 3) return true;
    for (const e of exclusions) if (pointInPolygon(p[i], p[i + 1], e)) return true;
  }
  return false;
}

function tryPlace(poly: FlatPoints, b: Omit<MapBuilding, 'id' | 'poly'>, clearance = 1): boolean {
  if (inExclusion(poly) || !clearOfRoads(poly, clearance) || collides(poly)) return false;
  // Small gap between neighbours: test a slightly shrunk copy for reservation, real one for output
  reserve(poly);
  buildings.push({ id: id('b'), ...b, poly: roundPoints(poly) });
  return true;
}

// ---------- 1. river ----------
const riverPts: Pt[] = [];
for (let y = -HALF - 80; y <= HALF + 80; y += 20) riverPts.push([-270 + 55 * Math.sin(y / 150) + 15 * Math.sin(y / 47), y]);
const RIVER_W = 22;
const waterways = [{ id: id('ww'), kind: 'river', width: RIVER_W, line: flat(riverPts) }];
greens.push({ id: id('g'), kind: 'grass', poly: bufferLine(riverPts, RIVER_W / 2 + 9) });
indexRoad({ line: flat(riverPts), width: RIVER_W + 12 }); // keep buildings off the riverbank

// ---------- 2. road network ----------
const mainY = (x: number) => 30 + 18 * Math.sin(x / 260);
const mainPts: Pt[] = [];
for (let x = -HALF - 80; x <= HALF + 80; x += 30) mainPts.push([x, mainY(x)]);
indexRoad(addRoad('primary', 12, mainPts, 'Jalan Raya Merdeka'));

const secX = (y: number) => 170 + 12 * Math.sin(y / 190);
const secPts: Pt[] = [];
for (let y = -HALF - 80; y <= HALF + 80; y += 30) secPts.push([secX(y), y]);
indexRoad(addRoad('secondary', 10, secPts, 'Jalan Pahlawan'));

const streetNames = ['Jalan Melati', 'Jalan Kenanga', 'Jalan Mawar', 'Jalan Anggrek', 'Jalan Flamboyan', 'Jalan Cempaka',
  'Jalan Dahlia', 'Jalan Teratai', 'Jalan Kamboja', 'Jalan Sawo', 'Jalan Rambutan', 'Jalan Manggis'];
let sn = 0;
const streets: Pt[][] = [];
const street = (kind: RoadKind, w: number, a: Pt, b: Pt, amp = 6) => {
  const pts = wobblyLine(a, b, amp);
  streets.push(pts);
  indexRoad(addRoad(kind, w, pts, streetNames[sn++ % streetNames.length]));
};
// east of the river
street('tertiary', 8, [-215, -330], [HALF + 60, -350]);
street('residential', 6, [-205, -190], [HALF + 60, -175]);
street('residential', 6, [-200, 190], [HALF + 60, 205]);
street('residential', 6, [-215, 350], [HALF + 60, 330]);
street('residential', 6, [-60, -HALF - 60], [-75, HALF + 60], 8);
street('residential', 5.5, [50, -330], [55, 340], 5);
street('residential', 5.5, [330, -HALF - 60], [320, 205], 7);
street('residential', 5.5, [450, -350], [460, 30], 4);
// west of the river
street('residential', 6, [-HALF - 60, -240], [-325, -260]);
street('residential', 6, [-HALF - 60, 230], [-335, 250]);
street('residential', 5.5, [-420, -HALF - 60], [-415, HALF + 60], 6);

// Gang (narrow alleys) branching off streets
for (const pts of streets) {
  for (let i = 1; i < pts.length - 1; i++) {
    if (!rng.chance(0.55)) continue;
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    const t = rng.range(0.2, 0.8);
    const px = ax + (bx - ax) * t, py = ay + (by - ay) * t;
    const l = Math.hypot(bx - ax, by - ay);
    const side = rng.chance(0.5) ? 1 : -1;
    const nx = (-(by - ay) / l) * side, ny = ((bx - ax) / l) * side;
    const len = rng.range(35, 75);
    const end: Pt = [px + nx * len, py + ny * len];
    const start: Pt = [px + nx * 3, py + ny * 3];
    // stop gangs that would run into the river or off the map
    if (Math.abs(end[0]) > HALF || Math.abs(end[1]) > HALF) continue;
    const nr = nearestSeg(end[0], end[1], 8);
    if (nr && nr.seg.half > 10) continue;
    const g = wobblyLine(start, end, 2, 20);
    indexRoad(addRoad(rng.chance(0.7) ? 'service' : 'path', rng.chance(0.7) ? 3 : 1.8, g));
  }
}

// ---------- 3. green spaces, fields and exclusions ----------
const parkPoly = rect(-150, 120, 0.03, 95, 70);
greens.push({ id: id('g'), kind: 'park', poly: roundPoints(parkPoly) });
exclusions.push(parkPoly);
const pitch = rect(-150, 120, 0.03, 60, 38);
greens.push({ id: id('g'), kind: 'pitch', poly: roundPoints(pitch) });

const paddy: FlatPoints = roundPoints([340, 220, HALF, 210, HALF, HALF, 240, HALF, 250, 380]);
greens.push({ id: id('g'), kind: 'paddy', poly: paddy });
exclusions.push(paddy);
for (let i = 0; i < 4; i++) { // dykes between paddy fields
  const y = 260 + i * 60;
  addRoad('path', 1.4, [[260 + i * 4, y], [HALF + 10, y - 5]]);
}

const cemetery = rect(-470, -60, 0.05, 50, 70);
greens.push({ id: id('g'), kind: 'cemetery', poly: roundPoints(cemetery) });
exclusions.push(cemetery);

const grove = roundPoints([-350, 300, -300, 280, -290, 420, -380, 440, -400, 360]);
greens.push({ id: id('g'), kind: 'forest', poly: grove });
exclusions.push(grove);

// a few empty lots (no OSM buildings → state land in game)
for (const [x, y, w, d] of [[260, -260, 50, 40], [-10, 280, 45, 35], [400, -100, 40, 45]] as const) exclusions.push(rect(x, y, 0, w, d));

landuse.push({ id: id('l'), kind: 'residential', poly: [-HALF, -HALF, HALF, -HALF, HALF, HALF, -HALF, HALF] });
landuse.push({ id: id('l'), kind: 'commercial', poly: bufferLine(mainPts, 30) });

// ---------- 4. landmark buildings ----------
const mosque = rect(-20, -40, 0.0, 24, 24);
tryPlace(mosque, { type: 'mosque', use: 'place_of_worship', name: 'Masjid Al-Ikhlas', levels: 2 }, 0.5);
tryPlace(rect(-20, -64, 0.0, 14, 8), { type: 'yes', use: 'place_of_worship', name: 'Serambi Masjid' }, 0.5);
tryPlace(rect(260, 75, 0.02, 48, 34), { type: 'retail', use: 'marketplace', name: 'Pasar Sido Mulyo', levels: 1 }, 0.5);
tryPlace(rect(90, -110, 0, 44, 13), { type: 'school', use: 'school', name: 'SD Negeri 3', levels: 2 });
tryPlace(rect(90, -132, 0, 44, 13), { type: 'school', use: 'school', levels: 2 });
tryPlace(rect(395, -260, 0.04, 38, 26), { type: 'warehouse', use: 'industrial' });
tryPlace(rect(-140, -5, 0.01, 30, 18), { type: 'office', use: 'townhall', name: 'Kantor Kelurahan', levels: 2 });
tryPlace(rect(-470, 120, 0, 16, 18), { type: 'church', use: 'place_of_worship', name: 'Gereja Santo Yusup' });
tryPlace(rect(240, -40, 0.0, 22, 16), { type: 'commercial', use: 'shop:supermarket', name: 'Toko Makmur', levels: 2 });

// ---------- 5. buildings along every street ----------
function lineToPts(l: FlatPoints): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < l.length; i += 2) out.push([l[i], l[i + 1]]);
  return out;
}
for (const road of [...roads].sort((a, b) => b.width - a.width)) {
  if (road.kind === 'path') continue;
  const pts = lineToPts(road.line);
  const isMain = road.kind === 'primary' || road.kind === 'secondary';
  for (const side of [1, -1]) {
    let rowLeft = 0; // remaining shophouses in a ruko row
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
      const segLen = Math.hypot(bx - ax, by - ay);
      const ang = Math.atan2(by - ay, bx - ax);
      const nx = (-(by - ay) / segLen) * side, ny = ((bx - ax) / segLen) * side;
      let s = rng.range(0, 4);
      while (s < segLen) {
        let w: number, d: number, setback: number, gap: number;
        let b: Omit<MapBuilding, 'id' | 'poly'>;
        if (isMain && (rowLeft > 0 || rng.chance(0.75))) {
          if (rowLeft <= 0) rowLeft = rng.int(3, 8);
          rowLeft--;
          w = 5; d = rng.range(13, 16); setback = 2; gap = rowLeft === 0 ? rng.range(3, 8) : 0.05;
          b = { type: rng.chance(0.85) ? 'commercial' : 'retail', levels: rng.pick([2, 2, 3, 3, 4]) };
          if (rng.chance(0.25)) b.use = `shop:${rng.pick(['convenience', 'clothes', 'hardware', 'mobile_phone', 'bakery', 'motorcycle'])}`;
        } else {
          rowLeft = 0;
          w = rng.range(6, 11); d = rng.range(7, 13); setback = road.kind === 'service' ? 0.8 : rng.range(1.2, 4);
          gap = rng.range(0.3, 3);
          b = { type: rng.chance(0.6) ? 'house' : rng.chance(0.85) ? 'yes' : 'residential' };
          if (rng.chance(0.15)) b.levels = 2;
          if (rng.chance(0.05)) b.use = rng.pick(['restaurant', 'cafe', 'shop:convenience', 'shop:laundry']);
        }
        const along = s + w / 2;
        const off = road.width / 2 + setback + d / 2;
        const cx = ax + Math.cos(ang) * along + nx * off;
        const cy = ay + Math.sin(ang) * along + ny * off;
        const jitter = isMain ? 0 : rng.range(-0.06, 0.06);
        const poly = rect(cx, cy, ang + jitter, w, d);
        if (tryPlace(poly, b, 0.6)) s += w + gap;
        else { s += 2; rowLeft = 0; }
      }
    }
  }
}

// ---------- 6. fill block interiors (dense kampung) ----------
for (let attempt = 0; attempt < 26000; attempt++) {
  const x = rng.range(-HALF, HALF), y = rng.range(-HALF, HALF);
  const near = nearestSeg(x, y, 70);
  if (!near || near.seg.half > 10) continue; // too far from any access, or near the river
  if (rng.chance(0.12)) continue; // leave some open yards
  const ang = Math.atan2(near.seg.by - near.seg.ay, near.seg.bx - near.seg.ax) + rng.range(-0.08, 0.08);
  const poly = rect(x, y, ang, rng.range(5.5, 10), rng.range(6, 11));
  tryPlace(poly, { type: rng.chance(0.55) ? 'house' : 'yes' }, 1.0);
}

// ---------- 7. trees ----------
const inGreen = (x: number, y: number, kinds: string[]) => greens.some((g) => kinds.includes(g.kind) && pointInPolygon(x, y, g.poly));
for (let i = 0; i < 9000 && trees.length < 2400; i++) {
  const x = rng.range(-HALF, HALF), y = rng.range(-HALF, HALF);
  const forest = inGreen(x, y, ['forest']);
  const park = !forest && inGreen(x, y, ['park', 'grass', 'cemetery']) && !pointInPolygon(x, y, pitch);
  if (!forest && !park && !rng.chance(0.25)) continue;
  if (inGreen(x, y, ['paddy'])) continue;
  const near = nearestSeg(x, y, 4);
  if (near && near.edge < 1.5) continue;
  const probe = rect(x, y, 0, 2, 2);
  if (collides(probe)) continue;
  trees.push(Math.round(x * 10) / 10, Math.round(y * 10) / 10);
}

// ---------- write ----------
const [west, south] = ((ll) => [ll.lon, ll.lat])(proj.toLatLon(-HALF, HALF));
const [east, north] = ((ll) => [ll.lon, ll.lat])(proj.toLatLon(HALF, -HALF));
const map: MapData = {
  format: MAP_FORMAT,
  version: MAP_VERSION,
  name: 'Sample Kampung (synthetic)',
  country: 'ID',
  source: 'synthetic',
  attribution: 'Synthetic sample data (not a real place)',
  importedAt: new Date().toISOString(),
  center,
  bbox: { south, west, north, east },
  bounds: { minX: -HALF, minY: -HALF, maxX: HALF, maxY: HALF },
  buildings,
  roads,
  water: [],
  waterways,
  greens,
  landuse,
  trees,
};
await mkdir(path.join(ROOT, 'maps'), { recursive: true });
const out = path.join(ROOT, 'maps', 'sample-kampung.json');
const json = JSON.stringify(map);
await writeFile(out, json);
console.log(`✔ ${path.relative(ROOT, out)}: ${buildings.length} buildings, ${roads.length} roads, ${trees.length / 2} trees, ${(json.length / 1024).toFixed(0)} KB`);
