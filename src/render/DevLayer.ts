import { Container, Graphics } from 'pixi.js';
import type { Game } from '../game/Game';
import type { NewBuilding } from '../game/Development';
import { buildingType, roadType, type BuildingTypeId, type RoadTypeId } from '../game/catalog';
import type { FlatPoints } from '../shared/mapTypes';
import { centroid } from '../shared/geometry';
import { hashString } from '../util/random';
import { shade } from './styles';
import { RasterOverlay, rgba } from './RasterOverlay';
import { BUILDING, OWNED } from '../game/LandGrid';

const EARTH = 0xc6b18a;
const SCAFFOLD = 0xf2c14e;

/** Draws everything the player has changed, plus placement previews. */
export class DevLayer {
  private ground = new Graphics();
  private owned = new Graphics();
  private top = new Container();
  private ghost = new Graphics();
  private game: Game | null = null;
  private ownedRaster: RasterOverlay | null = null;
  private earthRaster: RasterOverlay | null = null;
  private zoneRaster: RasterOverlay | null = null;
  zoneStrong = false;
  private earthCount = -1;
  showOwned = false;

  constructor(groundParent: Container, topParent: Container) {
    groundParent.addChild(this.ground, this.owned);
    topParent.addChild(this.top, this.ghost);
  }

  setGame(g: Game) {
    this.game = g;
    this.ownedRaster?.destroy();
    this.earthRaster?.destroy();
    const grid = g.world.grid;
    this.ownedRaster = new RasterOverlay(grid.w, grid.h, grid.minX, grid.minY);
    this.earthRaster = new RasterOverlay(grid.w, grid.h, grid.minX, grid.minY);
    this.zoneRaster?.destroy();
    this.zoneRaster = new RasterOverlay(grid.w, grid.h, grid.minX, grid.minY);
    this.earthCount = -1;
    const parent = this.owned.parent!;
    parent.addChildAt(this.earthRaster.sprite, 0);
    parent.addChildAt(this.ownedRaster.sprite, parent.getChildIndex(this.owned));
    parent.addChild(this.zoneRaster.sprite);
    this.redrawZones();
    this.redraw();
  }

  redraw() {
    const g = this.game;
    this.ground.clear();
    this.owned.clear();
    this.top.removeChildren().forEach((c) => c.destroy());
    if (!g) return;
    const w = g.world, dev = g.dev;

    // Your land (shown while a building tool is active), exact to the metre
    if (this.ownedRaster) {
      this.ownedRaster.sprite.visible = this.showOwned;
      if (this.showOwned) {
        const f = dev.grid.flags, gw = dev.grid.w, n = f.length;
        const fill = rgba(0x4caf7d, 0.28), edge = rgba(0x4caf7d, 0.95);
        this.ownedRaster.update((i) => {
          if (!(f[i] & OWNED)) return 0;
          const x = i % gw;
          const e = (x + 1 < gw && !(f[i + 1] & OWNED)) || (x > 0 && !(f[i - 1] & OWNED)) || (i + gw < n && !(f[i + gw] & OWNED)) || (i >= gw && !(f[i - gw] & OWNED));
          return e ? edge : fill;
        });
      }
    }

    // Cleared lots: the whole parcel becomes bare earth (with a faint speckle)
    if (this.earthRaster && this.earthCount !== dev.demolished.size) {
      this.earthCount = dev.demolished.size;
      const r = this.earthRaster;
      r.clear();
      const a = rgba(EARTH, 1), b = rgba(shade(EARTH, 0.94), 1);
      const f = dev.grid.flags;
      for (const id of dev.demolished) {
        const p = w.plot(`p_${id}`);
        if (p) w.forEachCell(p, (i) => { if (!(f[i] & BUILDING)) r.set(i, (i * 2654435761) % 7 === 0 ? b : a); });
      }
      r.flush();
    }

    // New roads: earth bed while under construction, asphalt when done
    for (const r of dev.roads) {
      const rt = roadType(r.type);
      linePath(this.ground, r.line);
      this.ground.stroke({ width: rt.width + 1.4, color: r.daysLeft > 0 ? 0xa48a5c : 0x6f6f6a, cap: 'round', join: 'round' });
    }
    for (const r of dev.roads) {
      const rt = roadType(r.type);
      linePath(this.ground, r.line);
      this.ground.stroke({ width: rt.width, color: r.daysLeft > 0 ? 0xc8ad7c : 0xa9a9a4, cap: 'round', join: 'round' });
      if (r.daysLeft === 0 && rt.width >= 7) {
        linePath(this.ground, r.line);
        this.ground.stroke({ width: 0.25, color: 0xf2efe6, alpha: 0.8 });
      }
    }

    // Demolitions in progress: dusty footprint with an orange hazard outline
    const demo = new Graphics();
    for (const d of dev.demolishing.values()) {
      const b = w.map.buildings.find((x) => x.id === d.buildingId);
      if (!b) continue;
      demo.poly(b.poly).fill({ color: 0x8a7a64, alpha: 0.95 }).poly(b.poly).stroke({ width: 0.6, color: 0xff8a3d });
      const [cx, cy] = centroid(b.poly);
      const r = 1.6;
      demo.moveTo(cx - r, cy - r).lineTo(cx + r, cy + r).moveTo(cx + r, cy - r).lineTo(cx - r, cy + r).stroke({ width: 0.5, color: 0xff8a3d });
    }
    this.top.addChild(demo);

    for (const b of dev.buildings) this.top.addChild(drawNewBuilding(b));
  }

  /** District zones: yellow residential, blue commercial, green open space. */
  redrawZones() {
    const g = this.game, r = this.zoneRaster;
    if (!g || !r) return;
    const Z = g.zones, gw = g.world.grid.w, n = Z.length;
    let any = false;
    for (let i = 0; i < n; i++) if (Z[i]) { any = true; break; }
    r.sprite.visible = any;
    if (!any) return;
    const a = this.zoneStrong ? 0.38 : 0.16, e = this.zoneStrong ? 0.95 : 0.5;
    const cols = [0, 0xf2c14e, 0x5f8fd9, 0x4caf7d];
    const fill = cols.map((c) => (c ? rgba(c, a) : 0)), edge = cols.map((c) => (c ? rgba(c, e) : 0));
    r.update((i) => {
      const z = Z[i];
      if (!z) return 0;
      const x = i % gw;
      const isEdge = (x + 1 < gw && Z[i + 1] !== z) || (x > 0 && Z[i - 1] !== z) || (i + gw < n && Z[i + gw] !== z) || (i >= gw && Z[i - gw] !== z);
      return isEdge ? edge[z] : fill[z];
    });
  }

  /** Brush outline for zone painting. */
  ghostBrush(x: number, y: number, radius: number, zone: number) {
    const c = [0xffffff, 0xf2c14e, 0x5f8fd9, 0x4caf7d][zone];
    this.ghost.clear().circle(x, y, radius).fill({ color: c, alpha: 0.18 }).circle(x, y, radius).stroke({ width: 0.6, color: c });
  }

  clearGhost() {
    this.ghost.clear();
  }

  ghostBuilding(game: Game, type: BuildingTypeId, cx: number, cy: number, angle: number, ok: boolean) {
    const bt = buildingType(type);
    const poly = game.dev.footprint(type, cx, cy, angle);
    const c = ok ? 0x4caf7d : 0xd9655b;
    this.ghost.clear();
    if (bt.setback > 0) {
      // setback outline: an enlarged rectangle
      const ux = Math.cos(angle), uy = Math.sin(angle);
      const hw = bt.width / 2 + bt.setback, hd = bt.depth / 2 + bt.setback;
      const nx = -uy, ny = ux;
      const ring = [
        cx - ux * hw - nx * hd, cy - uy * hw - ny * hd, cx + ux * hw - nx * hd, cy + uy * hw - ny * hd,
        cx + ux * hw + nx * hd, cy + uy * hw + ny * hd, cx - ux * hw + nx * hd, cy - uy * hw + ny * hd,
      ];
      this.ghost.poly(ring).stroke({ width: 0.4, color: c, alpha: 0.8 });
    }
    this.ghost.poly(poly).fill({ color: c, alpha: 0.45 }).poly(poly).stroke({ width: 0.8, color: c });
    // front marker: the side facing the road (negative normal)
    const ux = Math.cos(angle), uy = Math.sin(angle), nx = -uy, ny = ux;
    const fx = cx - nx * (bt.depth / 2), fy = cy - ny * (bt.depth / 2);
    this.ghost.moveTo(fx - ux * 2, fy - uy * 2).lineTo(fx + ux * 2, fy + uy * 2).stroke({ width: 1.2, color: 0xffffff, alpha: 0.9 });
  }

  ghostRoad(points: FlatPoints, type: RoadTypeId, ok: boolean) {
    const rt = roadType(type);
    const c = ok ? 0x4caf7d : 0xd9655b;
    this.ghost.clear();
    if (points.length >= 4) {
      linePath(this.ghost, points);
      this.ghost.stroke({ width: rt.width, color: c, alpha: 0.5, cap: 'round', join: 'round' });
      linePath(this.ghost, points);
      this.ghost.stroke({ width: 0.4, color: 0xffffff, alpha: 0.9 });
    }
    for (let i = 0; i < points.length; i += 2) this.ghost.circle(points[i], points[i + 1], 1.2).fill(0xffffff);
  }

  /** Red/green outline over a demolition target. */
  ghostTarget(poly: FlatPoints | null, line: { line: FlatPoints; width: number } | null, ok: boolean) {
    const c = ok ? 0xff8a3d : 0xd9655b;
    this.ghost.clear();
    if (poly) this.ghost.poly(poly).fill({ color: c, alpha: 0.3 }).poly(poly).stroke({ width: 0.8, color: c });
    if (line) {
      linePath(this.ghost, line.line);
      this.ghost.stroke({ width: line.width + 1, color: c, alpha: 0.5, cap: 'round', join: 'round' });
    }
  }
}

function linePath(g: Graphics, line: FlatPoints) {
  g.moveTo(line[0], line[1]);
  for (let i = 2; i < line.length; i += 2) g.lineTo(line[i], line[i + 1]);
}

/** One new building in local coordinates (x along the street, y toward the back). */
function drawNewBuilding(b: NewBuilding): Container {
  const bt = buildingType(b.type);
  const c = new Container();
  c.position.set(b.cx, b.cy);
  c.rotation = b.angle;
  const g = new Graphics();
  c.addChild(g);
  const hw = bt.width / 2, hd = bt.depth / 2;
  const rect = (x: number, y: number, w: number, h: number) => g.rect(x, y, w, h);

  if (b.daysLeft > 0) {
    // construction site
    const progress = 1 - b.daysLeft / b.total;
    rect(-hw, -hd, bt.width, bt.depth).fill(EARTH);
    const iw = bt.width * (0.3 + 0.7 * progress), id = bt.depth * (0.3 + 0.7 * progress);
    rect(-iw / 2, -id / 2, iw, id).fill(0x9d9d97);
    for (let x = -hw + 2; x < hw; x += 3) g.moveTo(x, -hd).lineTo(x, hd);
    g.stroke({ width: 0.15, color: 0x6f6a5f, alpha: 0.6 });
    rect(-hw, -hd, bt.width, bt.depth).stroke({ width: 0.7, color: SCAFFOLD });
    // tower crane for tall buildings
    if (bt.floors >= 3) {
      g.circle(-hw + 3, -hd + 3, 1.2).fill(SCAFFOLD);
      g.moveTo(-hw + 3, -hd + 3).lineTo(-hw + 3 + bt.width * 0.7, -hd + 3).stroke({ width: 0.6, color: SCAFFOLD });
    }
    // progress bar along the front
    rect(-hw, -hd - 2.5, bt.width, 1.2).fill({ color: 0x1b1f26, alpha: 0.7 });
    rect(-hw, -hd - 2.5, bt.width * progress, 1.2).fill(0x4caf7d);
    return c;
  }

  // shadow (world sun from north-west → offset in local space)
  if (bt.roofed) {
    const off = 0.8 + 0.6 * Math.min(bt.floors, 14);
    const ca = Math.cos(-b.angle), sa = Math.sin(-b.angle);
    const sx = off * ca - off * 1.2 * sa, sy = off * sa + off * 1.2 * ca;
    rect(-hw + sx, -hd + sy, bt.width, bt.depth).fill({ color: 0x000000, alpha: 0.22 });
  }

  switch (bt.style) {
    case 'house':
    case 'hall':
    case 'school': {
      if (bt.style === 'house') {
        // varied, modern-looking houses so new builds don't all look the same
        const h = hashString(b.id);
        const modern = (h % 10) > 4;
        const roofs = [0xc4683f, 0xa8502f, 0x8a5a3c, 0x55606b, 0x3f454d, 0x6b7a52];
        const walls = [0xe8e4da, 0xd9d4c7, 0xcdd3d6, 0xe0d2bd, 0xc9ccce];
        const roof = roofs[h % roofs.length];
        const wall = walls[(h >> 3) % walls.length];
        if (modern) {
          // flat-roofed modern house: walls with a roof slab and a small terrace
          rect(-hw, -hd, bt.width, bt.depth).fill(wall);
          rect(-hw, -hd, bt.width, bt.depth).stroke({ width: 0.3, color: shade(wall, 0.8) });
          rect(-hw + 0.6, -hd + 0.6, bt.width - 1.2, bt.depth * 0.42).fill(shade(roof, 1.05));
          if ((h >> 6) % 2) rect(hw - bt.width * 0.33, hd - bt.depth * 0.3, bt.width * 0.28, bt.depth * 0.22).fill(0x6f9bc0); // rooftop panel/terrace
        } else {
          rect(-hw, -hd, bt.width, hd).fill(roof);
          rect(-hw, 0, bt.width, hd).fill(shade(roof, 0.8));
          g.moveTo(-hw, 0).lineTo(hw, 0).stroke({ width: 0.2, color: shade(roof, 0.6) });
        }
        break;
      }
      const col = bt.style === 'school' ? 0xc8743c : 0xb5562f;
      rect(-hw, -hd, bt.width, hd).fill(col);
      rect(-hw, 0, bt.width, hd).fill(shade(col, 0.8));
      if (bt.style === 'school') rect(-hw * 0.3, -hd - 0.01, hw * 0.6, bt.depth).fill({ color: 0xd8cbb0, alpha: 0.9 });
      break;
    }
    case 'ruko': {
      const units = Math.max(2, Math.round(bt.width / 5)), uw = bt.width / units;
      for (let i = 0; i < units; i++) {
        const col = [0x9a9c9e, 0xc4683f, 0xb6b8b9, 0xa95a38][i % 4];
        rect(-hw + i * uw, -hd, uw, hd).fill(col);
        rect(-hw + i * uw, 0, uw, hd).fill(shade(col, 0.8));
      }
      for (let i = 1; i < units; i++) g.moveTo(-hw + i * uw, -hd).lineTo(-hw + i * uw, hd);
      g.stroke({ width: 0.25, color: 0x3a3a3a, alpha: 0.6 });
      break;
    }
    case 'apartment': {
      rect(-hw, -hd, bt.width, bt.depth).fill(0xd9d6cf);
      rect(-hw + 1.2, -hd + 1.2, bt.width - 2.4, bt.depth - 2.4).fill(0xc9c5bc);
      rect(-3, -2.5, 6, 5).fill(0x9d9a92);
      g.circle(hw - 4, -hd + 4, 1.6).fill(0x6f9bc0).circle(hw - 8, -hd + 4, 1.6).fill(0x6f9bc0);
      break;
    }
    case 'mall': {
      rect(-hw, -hd, bt.width, bt.depth).fill(0xe8e6e0);
      for (let y = -hd + 5; y < hd - 3; y += 8) rect(-hw + 5, y, bt.width - 10, 2.5).fill(0x9fc3da);
      for (let x = -hw + 4; x < hw - 2; x += 9) rect(x, hd - 4, 2.5, 2.5).fill(0xa4a39e);
      break;
    }
    case 'office': {
      rect(-hw, -hd, bt.width, bt.depth).fill(0x5f88ab);
      for (let x = -hw + 3; x < hw; x += 3) g.moveTo(x, -hd).lineTo(x, hd);
      for (let y = -hd + 3; y < hd; y += 3) g.moveTo(-hw, y).lineTo(hw, y);
      g.stroke({ width: 0.2, color: 0xb9d3e8, alpha: 0.7 });
      g.circle(0, 0, Math.min(hw, hd) * 0.45).stroke({ width: 0.5, color: 0xf2efe6 });
      break;
    }
    case 'park': {
      rect(-hw, -hd, bt.width, bt.depth).fill(0x9cc47f);
      g.moveTo(-hw, 0).lineTo(hw, 0).moveTo(0, -hd).lineTo(0, hd).stroke({ width: 2, color: 0xe6dcc4 });
      for (const [x, y] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.55], [-0.25, 0.3], [0.3, -0.3]]) {
        g.circle(x * hw, y * hd, 2.6).fill(0x4f7d3f).circle(x * hw - 0.5, y * hd - 0.5, 1.5).fill(0x6e9b52);
      }
      break;
    }
    case 'mosque': {
      rect(-hw, -hd, bt.width, bt.depth).fill(0xe8e6e0);
      rect(-hw + 3, -hd + 3, bt.width - 6, bt.depth - 6).fill(0x3f7f5a);
      g.circle(0, 0, Math.min(hw, hd) * 0.4).fill(0xd9b44a).circle(-1, -1, Math.min(hw, hd) * 0.15).fill(0xf0d27a);
      g.circle(hw - 2, -hd + 2, 1.4).fill(0xd9b44a);
      break;
    }
    case 'kost': {
      // three-storey boarding house: flat roof with a laundry terrace
      rect(-hw, -hd, bt.width, bt.depth).fill(0xb6b8b9);
      rect(-hw + 1, -hd + 1, bt.width * 0.45, bt.depth - 2).fill(0xc4683f);
      rect(-hw + 1, 0, bt.width * 0.45, hd - 1).fill(shade(0xc4683f, 0.8));
      for (let x = 2; x < hw - 1; x += 1.6) g.moveTo(x, -hd + 2).lineTo(x, hd - 2);
      g.stroke({ width: 0.12, color: 0xf2efe6, alpha: 0.9 });
      break;
    }
    case 'clinic': {
      rect(-hw, -hd, bt.width, bt.depth).fill(0xeeeeea);
      rect(-hw + 1.2, -hd + 1.2, bt.width - 2.4, bt.depth - 2.4).fill(0xdcdcd6);
      rect(-1, -4, 2, 8).fill(0xc62828);
      rect(-4, -1, 8, 2).fill(0xc62828);
      break;
    }
    case 'hotel': {
      rect(-hw, -hd, bt.width, bt.depth).fill(0xcfc6b5);
      rect(-hw + 1.4, -hd + 1.4, bt.width - 2.8, bt.depth - 2.8).fill(0xbdb3a0);
      rect(hw - 11, -hd + 3, 8, 5).fill(0x4fb3d9); // rooftop pool
      rect(hw - 11, -hd + 3, 8, 5).stroke({ width: 0.3, color: 0xffffff });
      rect(-hw + 3, -2, 5, 4).fill(0x8f8a80);
      break;
    }
    case 'market': {
      // traditional market: rows of zinc roofs over the stalls
      const rows = 5, rh = bt.depth / rows;
      for (let i = 0; i < rows; i++) {
        const col = i % 2 ? 0xa5a7a8 : 0x8f9193;
        rect(-hw, -hd + i * rh, bt.width, rh / 2).fill(col);
        rect(-hw, -hd + i * rh + rh / 2, bt.width, rh / 2).fill(shade(col, 0.82));
      }
      rect(-hw, -hd + bt.depth * 0.45, bt.width, 2).fill(0xc9c4b8);
      break;
    }
    case 'warehouse': {
      rect(-hw, -hd, bt.width, bt.depth).fill(0xb7bcc0);
      for (let x = -hw + 2; x < hw; x += 2) g.moveTo(x, -hd).lineTo(x, hd);
      g.stroke({ width: 0.15, color: 0x8a9aa6, alpha: 0.8 });
      rect(-hw, -hd, bt.width, 1.2).fill(0x9fb0bd);
      break;
    }
    case 'futsal': {
      rect(-hw, -hd, bt.width, bt.depth).fill(0x3f8f4f);
      rect(-hw + 1.5, -hd + 1.5, bt.width - 3, bt.depth - 3).stroke({ width: 0.25, color: 0xffffff });
      g.moveTo(-hw + 1.5, 0).lineTo(hw - 1.5, 0).stroke({ width: 0.25, color: 0xffffff });
      g.circle(0, 0, 3).stroke({ width: 0.25, color: 0xffffff });
      rect(-3, -hd + 1.5, 6, 3).stroke({ width: 0.25, color: 0xffffff });
      rect(-3, hd - 4.5, 6, 3).stroke({ width: 0.25, color: 0xffffff });
      break;
    }
    case 'parking': {
      rect(-hw, -hd, bt.width, bt.depth).fill(0x5c5f63);
      for (let x = -hw + 2.5; x < hw - 1; x += 2.5) {
        g.moveTo(x, -hd + 1).lineTo(x, -hd + 6).moveTo(x, hd - 6).lineTo(x, hd - 1);
      }
      g.stroke({ width: 0.15, color: 0xf2efe6 });
      break;
    }
  }
  if (bt.roofed) rect(-hw, -hd, bt.width, bt.depth).stroke({ width: 0.3, color: 0x000000, alpha: 0.35 });
  return c;
}
