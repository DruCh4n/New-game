import type { FlatPoints, MapRoad, RoadKind } from '../shared/mapTypes';
import { distToSegment, offsetPolygon } from '../shared/geometry';
import { CAR_ROADS } from './plots';
import { BUILDING, CARROAD, NEWBLD, OWNED, ROAD, WATER, type LandGrid } from './LandGrid';
import { buildingType, roadType, type BuildingTypeId, type RoadTypeId } from './catalog';
import type { World } from './World';
import type { Plot } from './types';

export interface Demolition { buildingId: string; plotId: string; daysLeft: number; total: number }
export interface NewRoad { id: string; type: RoadTypeId; line: FlatPoints; daysLeft: number; total: number; cost: number }
export interface NewBuilding {
  id: string;
  type: BuildingTypeId;
  cx: number;
  cy: number;
  angle: number;
  poly: FlatPoints;
  daysLeft: number;
  total: number;
  cost: number;
  /** Days until the building permit is granted (construction waits). */
  permitDays: number;
  /** 0..1 share of units let (rent/lease). */
  occupancy: number;
  unitsSold: number;
  /** Units given away to fulfil promises (apartments / shop units). */
  reserved: number;
  incomeLastMonth: number;
}

export type Problem = 'outside' | 'water' | 'onRoad' | 'blocked' | 'notOwned' | 'setback' | 'noRoad' | 'money' | 'tooShort' | 'permit' | 'papers';
export interface Check { ok: boolean; problem?: Problem; cost: number; days: number }

export interface DevSave {
  nextId: number;
  demolished: string[];
  demolishing: Demolition[];
  removedRoads: string[];
  roads: NewRoad[];
  buildings: NewBuilding[];
}

export type DevEvent = 'roads' | 'buildings' | 'demolition' | 'progress';

/** Gang/footpaths that may be removed once you own the land along them. */
const REMOVABLE_ROADS = new Set<RoadKind>(['service', 'path', 'track', 'living_street', 'pedestrian']);

/**
 * Everything the player changes on the ground: demolitions, new roads, new buildings.
 * Rules are checked on a 1 m LandGrid.
 */
export class Development {
  readonly grid: LandGrid;
  /** Plots (by index) where building must wait for papers to be registered. */
  paperBlock: ((plotIndex: number) => boolean) | null = null;
  readonly demolished = new Set<string>();
  readonly demolishing = new Map<string, Demolition>();
  readonly removedRoads = new Set<string>();
  readonly roads: NewRoad[] = [];
  readonly buildings: NewBuilding[] = [];
  private nextId = 1;
  private origRoads: Map<string, MapRoad>;
  onChange: (e: DevEvent, detail?: { kind: 'road' | 'building' | 'demolition' | 'permit'; id: string }) => void = () => {};

  constructor(private world: World, private money: () => number) {
    this.grid = world.grid;
    this.origRoads = new Map(world.map.roads.map((r) => [r.id, r]));
  }

  private get region() { return this.world.region; }
  private round(v: number) {
    const s = this.region.priceStep;
    return Math.max(s, Math.round(v / s) * s);
  }

  // ------------------------------------------------------------ ownership
  onPlotsSold(plotIds: string[]) {
    const f = this.grid.flags;
    for (const id of plotIds) this.world.forEachCell(this.world.plot(id)!, (i) => (f[i] |= OWNED));
  }

  // ------------------------------------------------------------ demolition
  buildingState(plot: Plot): 'standing' | 'demolishing' | 'demolished' | 'none' {
    if (!plot.buildingId) return 'none';
    if (this.demolished.has(plot.buildingId)) return 'demolished';
    if (this.demolishing.has(plot.buildingId)) return 'demolishing';
    return 'standing';
  }

  demolitionCheck(plot: Plot, owned: boolean): Check {
    const floorArea = plot.floorArea || plot.footprintArea;
    const cost = this.round(floorArea * this.region.buildPerM2 * 0.06);
    const days = Math.min(30, Math.round(5 + floorArea / 40));
    if (this.buildingState(plot) !== 'standing') return { ok: false, problem: 'blocked', cost, days };
    if (!owned) return { ok: false, problem: 'notOwned', cost, days };
    if (cost > this.money()) return { ok: false, problem: 'money', cost, days };
    return { ok: true, cost, days };
  }

  startDemolition(plot: Plot, days: number) {
    this.demolishing.set(plot.buildingId!, { buildingId: plot.buildingId!, plotId: plot.id, daysLeft: days, total: days });
    this.onChange('demolition');
  }

  // ------------------------------------------------------------ roads
  roadCheck(line: FlatPoints, type: RoadTypeId): Check {
    const rt = roadType(type);
    let len = 0;
    for (let i = 0; i + 3 < line.length; i += 2) len += Math.hypot(line[i + 2] - line[i], line[i + 3] - line[i + 1]);
    const cost = this.round(len * rt.width * rt.costFactor * this.region.buildPerM2);
    const days = Math.max(3, Math.round(len / 15));
    if (len < 4) return { ok: false, problem: 'tooShort', cost, days };
    let problem: Problem | undefined;
    const g = this.grid;
    let outside = false;
    for (let i = 0; i < line.length; i += 2) if (g.index(line[i], line[i + 1]) < 0) outside = true;
    if (outside) return { ok: false, problem: 'outside', cost, days };
    g.forLine(line, rt.width / 2, (i) => {
      if (problem) return;
      const f = g.flags[i];
      if (f & WATER) problem = 'water';
      else if (f & (BUILDING | NEWBLD)) problem = 'blocked';
      else if (!(f & (OWNED | ROAD))) problem = 'notOwned';
    });
    if (!problem && cost > this.money()) problem = 'money';
    return { ok: !problem, problem, cost, days };
  }

  buildRoad(line: FlatPoints, type: RoadTypeId, check: Check): NewRoad {
    const rt = roadType(type);
    const r: NewRoad = { id: `nr${this.nextId++}`, type, line, daysLeft: check.days, total: check.days, cost: check.cost };
    this.roads.push(r);
    this.grid.addRoad(line, rt.width, rt.car, 1);
    this.onChange('roads');
    return r;
  }

  /** Nearest road under a point: an original one or one you built. */
  pickRoad(x: number, y: number): { kind: 'original' | 'new'; id: string } | null {
    let best: { kind: 'original' | 'new'; id: string } | null = null;
    let bestD = Infinity;
    const test = (line: FlatPoints, half: number, kind: 'original' | 'new', id: string) => {
      for (let i = 0; i + 3 < line.length; i += 2) {
        const d = distToSegment(x, y, line[i], line[i + 1], line[i + 2], line[i + 3]) - half;
        if (d < 0.5 && d < bestD) { bestD = d; best = { kind, id }; }
      }
    };
    for (const r of this.roads) test(r.line, roadType(r.type).width / 2, 'new', r.id);
    for (const r of this.world.map.roads) if (!this.removedRoads.has(r.id)) test(r.line, r.width / 2, 'original', r.id);
    return best;
  }

  /** An original gang/footpath can go once every cell beside it is yours. */
  canRemoveOriginalRoad(id: string): boolean {
    const r = this.origRoads.get(id);
    if (!r || !REMOVABLE_ROADS.has(r.kind) || this.removedRoads.has(id)) return false;
    let ok = true;
    let inside = 0;
    this.grid.forLine(r.line, r.width / 2 + 2.5, (i) => {
      inside++;
      const f = this.grid.flags[i];
      if (!(f & ROAD) && !(f & OWNED)) ok = false;
    });
    return ok && inside > 0;
  }

  originalRoad(id: string) { return this.origRoads.get(id); }

  removeRoad(target: { kind: 'original' | 'new'; id: string }): boolean {
    if (target.kind === 'new') {
      const i = this.roads.findIndex((r) => r.id === target.id);
      if (i < 0) return false;
      const [r] = this.roads.splice(i, 1);
      const rt = roadType(r.type);
      this.grid.addRoad(r.line, rt.width, rt.car, -1);
    } else {
      if (!this.canRemoveOriginalRoad(target.id)) return false;
      const r = this.origRoads.get(target.id)!;
      this.removedRoads.add(r.id);
      this.grid.addRoad(r.line, r.width, CAR_ROADS.has(r.kind), -1);
      // the old alley becomes part of your land
      this.grid.forLine(r.line, r.width / 2, (i) => { if (!(this.grid.flags[i] & ROAD)) this.grid.flags[i] |= OWNED; });
    }
    this.onChange('roads');
    return true;
  }

  /** Snap a point to a road vertex, then to a road centreline, then to the 1 m grid. */
  snap(x: number, y: number, radius = 6): [number, number] {
    let best: [number, number] | null = null;
    let bestD = radius;
    for (const r of this.roads) {
      for (let i = 0; i < r.line.length; i += 2) {
        const d = Math.hypot(r.line[i] - x, r.line[i + 1] - y);
        if (d < bestD) { bestD = d; best = [r.line[i], r.line[i + 1]]; }
      }
    }
    if (best) return best;
    bestD = radius;
    const lines = [...this.roads.map((r) => r.line), ...this.world.map.roads.filter((r) => !this.removedRoads.has(r.id) && r.kind !== 'rail').map((r) => r.line)];
    for (const line of lines) {
      for (let i = 0; i + 3 < line.length; i += 2) {
        const ax = line[i], ay = line[i + 1], dx = line[i + 2] - ax, dy = line[i + 3] - ay;
        const l2 = dx * dx + dy * dy;
        const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
        const px = ax + t * dx, py = ay + t * dy;
        const d = Math.hypot(px - x, py - y);
        if (d < bestD) { bestD = d; best = [px, py]; }
      }
    }
    return best ?? [Math.round(x), Math.round(y)];
  }

  /** Direction of the nearest drivable road, for auto-aligning buildings. */
  roadAngle(x: number, y: number, radius = 40): number | null {
    let best: number | null = null;
    let bestD = radius;
    const consider = (line: FlatPoints, half: number) => {
      for (let i = 0; i + 3 < line.length; i += 2) {
        const d = distToSegment(x, y, line[i], line[i + 1], line[i + 2], line[i + 3]) - half;
        if (d < bestD) { bestD = d; best = Math.atan2(line[i + 3] - line[i + 1], line[i + 2] - line[i]); }
      }
    };
    for (const r of this.roads) consider(r.line, roadType(r.type).width / 2);
    for (const r of this.world.map.roads) if (CAR_ROADS.has(r.kind) && !this.removedRoads.has(r.id)) consider(r.line, r.width / 2);
    return best;
  }

  // ------------------------------------------------------------ buildings
  footprint(type: BuildingTypeId, cx: number, cy: number, angle: number): FlatPoints {
    const bt = buildingType(type);
    const ux = Math.cos(angle), uy = Math.sin(angle), nx = -uy, ny = ux;
    const hw = bt.width / 2, hd = bt.depth / 2;
    return [
      cx - ux * hw - nx * hd, cy - uy * hw - ny * hd,
      cx + ux * hw - nx * hd, cy + uy * hw - ny * hd,
      cx + ux * hw + nx * hd, cy + uy * hw + ny * hd,
      cx - ux * hw + nx * hd, cy - uy * hw + ny * hd,
    ];
  }

  buildingCost(type: BuildingTypeId): { cost: number; days: number } {
    const bt = buildingType(type);
    return { cost: this.round(bt.width * bt.depth * bt.floors * bt.costFactor * this.region.buildPerM2), days: bt.days };
  }

  buildingCheck(type: BuildingTypeId, cx: number, cy: number, angle: number): Check {
    const bt = buildingType(type);
    const { cost, days } = this.buildingCost(type);
    const poly = this.footprint(type, cx, cy, angle);
    const g = this.grid;
    for (let i = 0; i < poly.length; i += 2) if (g.index(poly[i], poly[i + 1]) < 0) return { ok: false, problem: 'outside', cost, days };
    const rank: Problem[] = ['water', 'onRoad', 'blocked', 'notOwned'];
    let worst = -1;
    g.forPolygon(poly, (i) => {
      const f = g.flags[i];
      const p = f & WATER ? 0 : f & ROAD ? 1 : f & (BUILDING | NEWBLD) ? 2 : !(f & OWNED) ? 3 : -1;
      if (p >= 0 && (worst < 0 || p < worst)) worst = p;
    });
    if (worst >= 0) return { ok: false, problem: rank[worst], cost, days };
    if (this.paperBlock) {
      let blocked = false;
      const P = this.world.parcels;
      g.forPolygon(poly, (i) => { if (!blocked && P[i] >= 0 && this.paperBlock!(P[i])) blocked = true; });
      if (blocked) return { ok: false, problem: 'papers', cost, days };
    }
    if (bt.setback > 0) {
      const inner = new Set<number>();
      g.forPolygon(poly, (i) => inner.add(i));
      let bad = false;
      g.forPolygon(offsetPolygon(poly, bt.setback), (i) => {
        if (bad || inner.has(i)) return;
        const f = g.flags[i];
        if (f & (BUILDING | NEWBLD | WATER) || !(f & (OWNED | ROAD))) bad = true;
      });
      if (bad) return { ok: false, problem: 'setback', cost, days };
    }
    let access = false;
    g.forPolygon(offsetPolygon(poly, bt.setback + 4), (i) => { if (g.flags[i] & CARROAD) access = true; });
    if (!access) return { ok: false, problem: 'noRoad', cost, days };
    if (cost > this.money()) return { ok: false, problem: 'money', cost, days };
    return { ok: true, cost, days };
  }

  placeBuilding(type: BuildingTypeId, cx: number, cy: number, angle: number, check: Check, permitDays = 0): NewBuilding {
    const poly = this.footprint(type, cx, cy, angle);
    const b: NewBuilding = {
      id: `nb${this.nextId++}`, type, cx, cy, angle, poly, daysLeft: check.days, total: check.days, cost: check.cost,
      permitDays, occupancy: 0, unitsSold: 0, reserved: 0, incomeLastMonth: 0,
    };
    this.buildings.push(b);
    this.grid.setPolygon(poly, NEWBLD, true);
    this.onChange('buildings');
    return b;
  }

  removeBuilding(id: string): boolean {
    const i = this.buildings.findIndex((b) => b.id === id);
    if (i < 0) return false;
    const [b] = this.buildings.splice(i, 1);
    this.grid.setPolygon(b.poly, NEWBLD, false);
    this.onChange('buildings');
    return true;
  }

  buildingAt(x: number, y: number): NewBuilding | null {
    for (const b of this.buildings) if (pointInRect(b, x, y)) return b;
    return null;
  }

  // ------------------------------------------------------------ save / load
  serialize(): DevSave {
    return {
      nextId: this.nextId,
      demolished: [...this.demolished],
      demolishing: [...this.demolishing.values()],
      removedRoads: [...this.removedRoads],
      roads: this.roads,
      buildings: this.buildings,
    };
  }

  /** Re-applies saved changes to a fresh world (ownership must already be restored). */
  restore(d: DevSave) {
    this.nextId = d.nextId;
    const g = this.grid;
    for (const id of d.demolished) {
      this.demolished.add(id);
      const bl = this.world.map.buildings.find((b) => b.id === id);
      if (bl) g.setPolygon(bl.poly, BUILDING, false);
    }
    for (const x of d.demolishing) this.demolishing.set(x.buildingId, x);
    for (const id of d.removedRoads) {
      const r = this.origRoads.get(id);
      if (!r) continue;
      this.removedRoads.add(id);
      g.addRoad(r.line, r.width, CAR_ROADS.has(r.kind), -1);
      g.forLine(r.line, r.width / 2, (i) => { if (!(g.flags[i] & ROAD)) g.flags[i] |= OWNED; });
    }
    for (const r of d.roads) {
      const rt = roadType(r.type);
      this.roads.push(r);
      g.addRoad(r.line, rt.width, rt.car, 1);
    }
    for (const b of d.buildings) {
      this.buildings.push(b);
      g.setPolygon(b.poly, NEWBLD, true);
    }
  }

  // ------------------------------------------------------------ time
  advanceDay() {
    let changed = false;
    for (const d of [...this.demolishing.values()]) {
      d.daysLeft--;
      changed = true;
      if (d.daysLeft <= 0) {
        this.demolishing.delete(d.buildingId);
        this.demolished.add(d.buildingId);
        const bl = this.world.map.buildings.find((b) => b.id === d.buildingId);
        if (bl) this.grid.setPolygon(bl.poly, BUILDING, false);
        this.onChange('demolition', { kind: 'demolition', id: d.plotId });
      }
    }
    for (const r of this.roads) if (r.daysLeft > 0) {
      r.daysLeft--;
      changed = true;
      if (r.daysLeft === 0) this.onChange('roads', { kind: 'road', id: r.id });
    }
    for (const b of this.buildings) if (b.permitDays > 0) {
      b.permitDays--;
      changed = true;
      if (b.permitDays === 0) this.onChange('progress', { kind: 'permit', id: b.id });
    } else if (b.daysLeft > 0) {
      b.daysLeft--;
      changed = true;
      if (b.daysLeft === 0) this.onChange('buildings', { kind: 'building', id: b.id });
    }
    if (changed) this.onChange('progress');
  }

  ownedArea(): number {
    let n = 0;
    for (let i = 0; i < this.grid.flags.length; i++) if (this.grid.flags[i] & OWNED) n++;
    return n;
  }
}

function pointInRect(b: NewBuilding, x: number, y: number): boolean {
  const bt = buildingType(b.type);
  const dx = x - b.cx, dy = y - b.cy;
  const u = dx * Math.cos(b.angle) + dy * Math.sin(b.angle);
  const v = -dx * Math.sin(b.angle) + dy * Math.cos(b.angle);
  return Math.abs(u) <= bt.width / 2 && Math.abs(v) <= bt.depth / 2;
}

