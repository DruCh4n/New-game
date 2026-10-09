import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { Game } from '../game/Game';
import { CAR_ROADS } from '../game/plots';
import { roadType } from '../game/catalog';
import type { FlatPoints, RoadKind } from '../shared/mapTypes';
import { Rng } from '../util/random';

interface Lane { line: FlatPoints; cum: number[]; len: number; width: number; kind: RoadKind | 'new'; ends: [number[], number[]] }
interface Vehicle { lane: number; s: number; dir: 1 | -1; speed: number; moto: boolean; color: number }

const CAR_COLORS = [0xf2f2f0, 0xf2f2f0, 0x2b2d30, 0x9aa0a6, 0xc8ccd0, 0xb3261e, 0x1f4e8c, 0x3c3c3c, 0xd9c9a3];
const MOTO_COLORS = [0x1b1b1b, 0xb3261e, 0x1f4e8c, 0xe0e0e0, 0x2b6b3a];
const DENSITY: Partial<Record<RoadKind | 'new', number>> = {
  trunk: 22, primary: 24, secondary: 30, tertiary: 50, residential: 75, unclassified: 80, living_street: 110, service: 120, new: 70,
};

/**
 * Small moving things that make the map feel alive: traffic (driving on the left),
 * drifting cloud shadows, swinging cranes on building sites and dust from demolitions.
 */
export class Life {
  readonly below = new Container(); // traffic (under the tree canopy)
  readonly above = new Container(); // cranes, dust, clouds
  private traffic = new Graphics();
  private sites = new Graphics();
  private clouds: Sprite[] = [];
  private lanes: Lane[] = [];
  private vehicles: Vehicle[] = [];
  private rng = new Rng(42);
  private t = 0;
  private game: Game | null = null;
  private laneVersion = '';
  showTraffic = true;
  showClouds = true;

  constructor() {
    this.below.addChild(this.traffic);
    this.above.addChild(this.sites);
  }

  setGame(g: Game) {
    this.game = g;
    this.laneVersion = '';
    this.rebuildLanes();
    for (const c of this.clouds) c.destroy();
    this.clouds = [];
    const tex = cloudTexture();
    const b = g.world.map.bounds;
    for (let i = 0; i < 7; i++) {
      const s = new Sprite(tex);
      s.anchor.set(0.5);
      const size = 160 + this.rng.next() * 260;
      s.width = size * (1.2 + this.rng.next() * 0.8);
      s.height = size;
      s.position.set(b.minX + this.rng.next() * (b.maxX - b.minX), b.minY + this.rng.next() * (b.maxY - b.minY));
      s.alpha = 0.1 + this.rng.next() * 0.08;
      this.clouds.push(s);
      this.above.addChild(s);
    }
  }

  /** Recompute drivable lanes when roads change. */
  rebuildLanes() {
    const g = this.game;
    if (!g) return;
    const v = `${g.dev.roads.filter((r) => r.daysLeft === 0).length}|${g.dev.removedRoads.size}`;
    if (v === this.laneVersion) return;
    this.laneVersion = v;
    const lanes: Lane[] = [];
    const add = (line: FlatPoints, width: number, kind: Lane['kind']) => {
      const cum = [0];
      for (let i = 2; i < line.length; i += 2) cum.push(cum[cum.length - 1] + Math.hypot(line[i] - line[i - 2], line[i + 1] - line[i - 1]));
      const len = cum[cum.length - 1];
      if (len > 8) lanes.push({ line, cum, len, width, kind, ends: [[], []] });
    };
    for (const r of g.world.map.roads) if (CAR_ROADS.has(r.kind) && r.kind !== 'track' && !g.dev.removedRoads.has(r.id)) add(r.line, r.width, r.kind);
    for (const r of g.dev.roads) if (r.daysLeft === 0) add(r.line, roadType(r.type).width, 'new');
    // connect lane ends to lanes passing nearby, so vehicles turn instead of reversing
    for (let a = 0; a < lanes.length; a++) {
      for (const end of [0, 1] as const) {
        const L = lanes[a].line;
        const ex = end ? L[L.length - 2] : L[0], ey = end ? L[L.length - 1] : L[1];
        for (let b = 0; b < lanes.length; b++) {
          if (b === a) continue;
          const M = lanes[b].line;
          for (let i = 0; i < M.length; i += 2) if (Math.abs(M[i] - ex) < 6 && Math.abs(M[i + 1] - ey) < 6) { lanes[a].ends[end].push(b, i / 2); break; }
        }
      }
    }
    this.lanes = lanes;
    // vehicles proportional to road length and class
    this.vehicles = [];
    lanes.forEach((l, i) => {
      const n = Math.round(l.len / (DENSITY[l.kind] ?? 90));
      for (let k = 0; k < n; k++) this.vehicles.push(this.spawn(i));
    });
  }

  private spawn(lane: number): Vehicle {
    const l = this.lanes[lane];
    const moto = l.kind === 'service' || l.kind === 'living_street' || this.rng.chance(0.45); // lots of motorbikes
    return {
      lane, s: this.rng.next() * l.len, dir: this.rng.chance(0.5) ? 1 : -1,
      speed: moto ? 5 + this.rng.next() * 5 : 6 + this.rng.next() * 6, moto,
      color: moto ? this.rng.pick(MOTO_COLORS) : this.rng.pick(CAR_COLORS),
    };
  }

  update(dt: number, zoom: number, gameSpeed: number) {
    this.t += dt;
    const g = this.game;
    if (!g) return;
    const move = gameSpeed === 0 ? 0 : Math.sqrt(gameSpeed);
    // clouds drift east-north-east and wrap around the map
    const b = g.world.map.bounds;
    for (const c of this.clouds) {
      c.visible = this.showClouds;
      c.x += dt * 4 * move;
      c.y -= dt * 1.2 * move;
      if (c.x - c.width / 2 > b.maxX + 100) c.x = b.minX - c.width / 2;
      if (c.y + c.height / 2 < b.minY - 100) c.y = b.maxY + c.height / 2;
    }
    this.drawTraffic(dt * move, zoom);
    this.drawSites();
  }

  private drawTraffic(dt: number, zoom: number) {
    const gr = this.traffic;
    gr.clear();
    if (!this.showTraffic || zoom < 0.9) return;
    const bodies = new Map<number, number[][]>();
    const shadows: number[][] = [];
    for (const v of this.vehicles) {
      const l = this.lanes[v.lane];
      v.s += v.speed * dt * v.dir;
      if (v.s < 0 || v.s > l.len) this.turn(v);
      const p = this.pointAt(this.lanes[v.lane], v.s);
      if (!p) continue;
      const [x, y, fx0, fy0] = p;
      const fx = fx0 * v.dir, fy = fy0 * v.dir;
      // drive on the left: offset to the left of the travel direction
      const lx = fy, ly = -fx;
      const off = this.lanes[v.lane].width * 0.24;
      const cx = x + lx * off, cy = y + ly * off;
      const len = v.moto ? 1.9 : 4.2, wid = v.moto ? 0.7 : 1.8;
      const poly = box(cx, cy, fx, fy, len, wid);
      shadows.push(box(cx + 0.35, cy + 0.45, fx, fy, len, wid));
      (bodies.get(v.color) ?? bodies.set(v.color, []).get(v.color)!).push(poly);
      if (!v.moto) (bodies.get(0x1c2733) ?? bodies.set(0x1c2733, []).get(0x1c2733)!).push(box(cx + fx * 0.7, cy + fy * 0.7, fx, fy, 1.1, wid * 0.82));
    }
    for (const p of shadows) gr.poly(p);
    gr.fill({ color: 0x000000, alpha: 0.25 });
    for (const [c, polys] of bodies) {
      for (const p of polys) gr.poly(p);
      gr.fill(c);
    }
  }

  private turn(v: Vehicle) {
    const l = this.lanes[v.lane];
    const end = v.s > l.len ? 1 : 0;
    const links = l.ends[end];
    if (links.length && this.rng.chance(0.85)) {
      const k = this.rng.int(0, links.length / 2 - 1) * 2;
      const nl = this.lanes[links[k]], vi = links[k + 1];
      v.lane = links[k];
      v.s = nl.cum[vi];
      v.dir = vi === 0 ? 1 : vi === nl.cum.length - 1 ? -1 : this.rng.chance(0.5) ? 1 : -1;
    } else {
      v.dir = (v.dir * -1) as 1 | -1;
      v.s = Math.max(0, Math.min(l.len, v.s));
    }
  }

  private pointAt(l: Lane, s: number): [number, number, number, number] | null {
    s = Math.max(0, Math.min(l.len, s));
    let i = 1;
    while (i < l.cum.length - 1 && l.cum[i] < s) i++;
    const a = (i - 1) * 2, segLen = l.cum[i] - l.cum[i - 1] || 1;
    const t = (s - l.cum[i - 1]) / segLen;
    const dx = l.line[a + 2] - l.line[a], dy = l.line[a + 3] - l.line[a + 1];
    const d = Math.hypot(dx, dy) || 1;
    return [l.line[a] + dx * t, l.line[a + 1] + dy * t, dx / d, dy / d];
  }

  /** Cranes swing on building sites; dust rises from demolitions. */
  private drawSites() {
    const g = this.game, gr = this.sites;
    gr.clear();
    if (!g) return;
    for (const b of g.dev.buildings) {
      if (b.daysLeft === 0 || b.permitDays > 0) continue;
      const bt = g.dev.footprint(b.type, b.cx, b.cy, b.angle);
      const hw = Math.hypot(bt[2] - bt[0], bt[3] - bt[1]) / 2;
      // crane mast at the back-left corner, boom sweeping slowly
      const mx = bt[0] * 0.8 + b.cx * 0.2, my = bt[1] * 0.8 + b.cy * 0.2;
      const a = b.angle + Math.sin(this.t * 0.25 + b.cx) * 1.2;
      const L = Math.max(12, hw * 1.5);
      gr.moveTo(mx - Math.cos(a) * 4, my - Math.sin(a) * 4).lineTo(mx + Math.cos(a) * L, my + Math.sin(a) * L).stroke({ width: 0.9, color: 0xf2c14e });
      gr.moveTo(mx + 1.2, my + 1.6).lineTo(mx + Math.cos(a) * L + 1.2, my + Math.sin(a) * L + 1.6).stroke({ width: 0.9, color: 0x000000, alpha: 0.2 });
      gr.rect(mx - 1, my - 1, 2, 2).fill(0xd9a23a);
      gr.rect(mx - Math.cos(a) * 4 - 1, my - Math.sin(a) * 4 - 1, 2, 2).fill(0x6f6a5f);
    }
    for (const d of g.dev.demolishing.values()) {
      const p = g.world.plot(`p_${d.buildingId}`);
      if (!p) continue;
      for (let k = 0; k < 6; k++) {
        const ph = (this.t * 0.6 + k / 6) % 1;
        const ang = k * 1.7 + p.cx;
        const r = 1.5 + ph * 6;
        gr.circle(p.cx + Math.cos(ang) * r, p.cy + Math.sin(ang) * r - ph * 3, 1.2 + ph * 2.5).fill({ color: 0xd8cbb0, alpha: 0.45 * (1 - ph) });
      }
    }
  }
}

function box(cx: number, cy: number, fx: number, fy: number, len: number, wid: number): number[] {
  const lx = fy, ly = -fx, hl = len / 2, hw = wid / 2;
  return [
    cx + fx * hl + lx * hw, cy + fy * hl + ly * hw, cx + fx * hl - lx * hw, cy + fy * hl - ly * hw,
    cx - fx * hl - lx * hw, cy - fy * hl - ly * hw, cx - fx * hl + lx * hw, cy - fy * hl + ly * hw,
  ];
}

let cloudTex: Texture | null = null;
/** A soft round shadow, generated once. */
function cloudTexture(): Texture {
  if (cloudTex) return cloudTex;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d')!;
  const rng = new Rng(7);
  for (let i = 0; i < 9; i++) {
    const x = 70 + rng.next() * 116, y = 70 + rng.next() * 116, r = 40 + rng.next() * 50;
    const grd = ctx.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(10, 20, 30, 0.55)');
    grd.addColorStop(1, 'rgba(10, 20, 30, 0)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, 256, 256);
  }
  cloudTex = Texture.from(c);
  return cloudTex;
}
