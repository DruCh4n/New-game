/**
 * "New city" mode: once you own a large contiguous area you can zone it for
 * residential, commercial and green use. Matching buildings get more demand,
 * and a balanced district boosts everything inside it and speeds up permits.
 */
import type { Game } from './Game';
import type { NewBuilding } from './Development';
import { OWNED, ROAD } from './LandGrid';
import { buildingType } from './catalog';

export const DISTRICT_MIN_AREA = 20000; // m² of contiguous land you own
export type Zone = 0 | 1 | 2 | 3; // none, residential, commercial, green
export const ZONE_NAMES = ['none', 'residential', 'commercial', 'green'] as const;
/** Target share of each zone in a balanced district. */
const TARGET = { 1: 0.5, 2: 0.3, 3: 0.2 } as const;

/**
 * Largest connected area of land you own, in m². Streets between your plots join them
 * (road cells within 7 m of your land), so a district can span the roads inside it.
 */
export function largestOwnedArea(game: Game): number {
  const g = game.world.grid, f = g.flags, w = g.w, N = f.length;
  const q = new Int32Array(N);
  // distance (in cells, capped) from your land, to find streets that run between your plots
  const near = new Uint8Array(N).fill(255);
  let qh = 0, qt = 0;
  for (let i = 0; i < N; i++) if (f[i] & OWNED) { near[i] = 0; q[qt++] = i; }
  while (qh < qt) {
    const i = q[qh++];
    const d = near[i] + 1;
    if (d > 7) continue;
    const x = i % w;
    for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
      if (j >= 0 && j < N && near[j] > d && f[j] & ROAD) { near[j] = d; q[qt++] = j; }
    }
  }
  const passable = (j: number) => (f[j] & OWNED) !== 0 || ((f[j] & ROAD) !== 0 && near[j] <= 7);
  const seen = new Uint8Array(N);
  let best = 0;
  for (let s = 0; s < N; s++) {
    if (seen[s] || !(f[s] & OWNED)) continue;
    qh = 0;
    qt = 0;
    let n = 0;
    q[qt++] = s;
    seen[s] = 1;
    while (qh < qt) {
      const i = q[qh++];
      if (f[i] & OWNED) n++;
      const x = i % w;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
        if (j >= 0 && j < N && !seen[j] && passable(j)) { seen[j] = 1; q[qt++] = j; }
      }
    }
    if (n > best) best = n;
  }
  return best;
}

export function checkUnlock(game: Game) {
  if (game.districtUnlocked) return;
  if (largestOwnedArea(game) >= DISTRICT_MIN_AREA) {
    game.districtUnlocked = true;
    game.toast({ kind: 'good', key: 'toast.district' });
  }
}

/** Paints a round brush of zone on land you own (roads are skipped). Returns cells changed. */
export function paintZone(game: Game, x: number, y: number, radius: number, zone: Zone): number {
  if (!game.districtUnlocked) return 0;
  const g = game.world.grid, f = g.flags, Z = game.zones;
  let changed = 0;
  const r2 = radius * radius;
  for (let yy = Math.floor(y - radius); yy <= y + radius; yy++) {
    for (let xx = Math.floor(x - radius); xx <= x + radius; xx++) {
      const dx = xx + 0.5 - x, dy = yy + 0.5 - y;
      if (dx * dx + dy * dy > r2) continue;
      const i = g.index(xx + 0.5, yy + 0.5);
      if (i < 0 || !(f[i] & OWNED) || f[i] & ROAD || Z[i] === zone) continue;
      Z[i] = zone;
      changed++;
    }
  }
  return changed;
}

export function zoneAt(game: Game, x: number, y: number): Zone {
  const i = game.world.grid.index(x, y);
  return i < 0 ? 0 : (game.zones[i] as Zone);
}

export interface DistrictStats { area: [number, number, number, number]; zoned: number; balance: number }

/** Zoned areas and a 0..1 balance score (1 = 50% residential, 30% commercial, 20% green). */
export function districtStats(game: Game): DistrictStats {
  const area: [number, number, number, number] = [0, 0, 0, 0];
  for (let i = 0; i < game.zones.length; i++) area[game.zones[i]]++;
  const zoned = area[1] + area[2] + area[3];
  if (zoned < 2000) return { area, zoned, balance: 0 };
  const dev = Math.abs(area[1] / zoned - TARGET[1]) + Math.abs(area[2] / zoned - TARGET[2]) + Math.abs(area[3] / zoned - TARGET[3]);
  return { area, zoned, balance: Math.max(0, Math.round((1 - dev * 1.25) * 100) / 100) };
}

let cache = { day: -1, version: -1, balance: 0 };

/** Demand bonus for a building from the district plan. */
export function districtBonus(game: Game, b: NewBuilding): number {
  const z = zoneAt(game, b.cx, b.cy);
  if (!z) return 0;
  if (cache.day !== game.day || cache.version !== game.zoneVersion) cache = { day: game.day, version: game.zoneVersion, balance: districtStats(game).balance };
  const income = buildingType(b.type).income;
  const wanted = income === 'rent' || income === 'sale' ? 1 : income === 'lease' ? 2 : 3;
  const match = income === 'civic' || z === wanted ? 0.1 : -0.05;
  return match + cache.balance * 0.15;
}

/** Permits inside a planned district are faster. */
export function permitFactor(game: Game, x: number, y: number): number {
  return zoneAt(game, x, y) ? 0.6 : 1;
}

/** Run-length encoding for save files. */
export function encodeZones(z: Uint8Array): number[] {
  const out: number[] = [];
  let i = 0;
  while (i < z.length) {
    let j = i;
    while (j < z.length && z[j] === z[i] && j - i < 1e6) j++;
    out.push(z[i], j - i);
    i = j;
  }
  return out;
}

export function decodeZones(rle: number[], into: Uint8Array) {
  let p = 0;
  for (let k = 0; k + 1 < rle.length; k += 2) {
    into.fill(rle[k], p, p + rle[k + 1]);
    p += rle[k + 1];
  }
}
