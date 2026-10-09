import { CanvasSource, Container, Sprite, Texture } from 'pixi.js';
import type { World } from '../game/World';
import { BUILDING, NEWBLD, ROAD, WATER } from '../game/LandGrid';
import { fbm, hash01, smoothstep } from './noise';
import { Rng } from '../util/random';
import { seaSampler } from '../shared/sea';

/** Green area kinds rasterised into the terrain. */
const GK: Record<string, number> = { park: 1, garden: 1, pitch: 2, grass: 3, forest: 4, scrub: 4, wetland: 5, farmland: 6, paddy: 6, orchard: 7, cemetery: 8 };

interface Tree { x: number; y: number; r: number; c: number }

const CROWNS = [0x2f5a28, 0x37652d, 0x3f6f31, 0x467a36, 0x52843b, 0x5b8a3e, 0x3b5f2a];

/**
 * Bakes the map's ground (yards, grass, vegetation, fields) and tree canopy into textures,
 * so open land looks like a satellite view instead of a flat colour.
 */
export class Terrain {
  /** Containers of tiles; add these to the scene. */
  readonly ground = new Container();
  readonly canopy = new Container();
  private tiles: Tile[] = [];
  private trees: Tree[] = [];
  /** Tree visibility at the last bake (trees vanish where land is cleared). */
  private visible: Uint8Array = new Uint8Array(0);
  private seed: number;
  /** Scale of the canopy texture (pixels per meter). */
  private readonly cps = 2;

  constructor(private world: World) {
    this.seed = world.seed % 100000;
    const g = world.grid;
    const N = g.w * g.h;

    // ----- rasters: greens, distance to buildings, distance to roads -----
    const green = new Uint8Array(N);
    const sorted = [...world.map.greens].sort((a, b) => area(b.poly) - area(a.poly));
    for (const a of sorted) g.forPolygon(a.poly, (i) => (green[i] = GK[a.kind] ?? 3));
    const dBuild = distanceField(g.w, g.h, (i) => (g.flags[i] & BUILDING) !== 0, 20);
    const dRoad = distanceField(g.w, g.h, (i) => (g.flags[i] & ROAD) !== 0, 12);
    const s = this.seed;
    const isSea = seaSampler(world.map);
    // smooth noise fields, computed on a coarse grid and interpolated (much faster than per pixel)
    const N1 = coarseNoise(g.w, g.h, 4, 28, s, 3), N2 = coarseNoise(g.w, g.h, 2, 9, s + 31, 2);

    // ----- trees: the map's own plus procedural clusters -----
    const rng = new Rng(world.seed ^ 0x7ee5);
    const t = world.map.trees;
    for (let k = 0; k < t.length; k += 2) this.trees.push({ x: t[k], y: t[k + 1], r: 1.8 + rng.next() * 2.2, c: rng.int(0, CROWNS.length - 1) });
    const step = 3.2;
    for (let y = g.minY + 1; y < g.minY + g.h - 1; y += step) {
      for (let x = g.minX + 1; x < g.minX + g.w - 1; x += step) {
        const jx = x + (rng.next() - 0.5) * step, jy = y + (rng.next() - 0.5) * step;
        const i = g.index(jx, jy);
        if (i < 0 || g.flags[i] & (ROAD | WATER | BUILDING)) continue;
        if (dRoad[i] < 2) continue;
        const kind = green[i];
        const cluster = smoothstep(0.42, 0.72, fbm(jx / 45, jy / 45, s + 7));
        let p: number;
        if (kind === 4) p = 0.9;
        else if (kind === 1 || kind === 8) p = 0.3 + 0.3 * cluster;
        else if (kind === 3 || kind === 5) p = 0.25 + 0.45 * cluster;
        else if (kind === 6 || kind === 2) p = 0.01;
        else if (kind === 7) p = 0.55;
        else {
          const d = dBuild[i];
          // gardens between houses are leafy; open land far from any house is mostly grass
          p = d < 2 ? 0.02 : d < 4 ? 0.12 + 0.2 * cluster : d < 20 ? 0.15 + 0.7 * cluster : 0.04 + 0.3 * cluster;
        }
        if (rng.next() > p) continue;
        const r = (kind === 4 ? 2.6 : 1.7) + rng.next() * 2.6;
        if (kind === 0 && dBuild[i] < r * 0.45) continue;
        this.trees.push({ x: jx, y: jy, r, c: rng.int(0, CROWNS.length - 1) });
      }
    }

    // ----- tiles: ground at 1 px/m, canopy at 2 px/m (small textures fit every GPU) -----
    for (let ty = 0; ty < g.h; ty += TILE) {
      for (let tx = 0; tx < g.w; tx += TILE) {
        const w = Math.min(TILE, g.w - tx), h = Math.min(TILE, g.h - ty);
        const gc = document.createElement('canvas');
        gc.width = w;
        gc.height = h;
        const ctx = gc.getContext('2d')!;
        const img = ctx.createImageData(w, h);
        const px = new Uint32Array(img.data.buffer);
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const i = (ty + y) * g.w + tx + x;
            const wx = tx + x + g.minX, wy = ty + y + g.minY;
            px[y * w + x] = isSea && isSea(wx + 0.5, wy + 0.5) ? seaColor(wx, wy, s)
              : groundColor(wx, wy, green[i], dBuild[i], dRoad[i], g.flags[i], s, sample(N1, tx + x, ty + y), sample(N2, tx + x, ty + y));
          }
        }
        ctx.putImageData(img, 0, 0);
        const groundSprite = new Sprite(new Texture({ source: new CanvasSource({ resource: gc, autoGenerateMipmaps: true, scaleMode: 'linear' }) }));
        groundSprite.position.set(g.minX + tx, g.minY + ty);
        // a 1 px overlap hides seams between tiles when zoomed out
        groundSprite.width = w + 0.5;
        groundSprite.height = h + 0.5;
        this.ground.addChild(groundSprite);

        const cc = document.createElement('canvas');
        cc.width = w * this.cps;
        cc.height = h * this.cps;
        const source = new CanvasSource({ resource: cc, autoGenerateMipmaps: true, scaleMode: 'linear' });
        const canopySprite = new Sprite(new Texture({ source }));
        canopySprite.position.set(g.minX + tx, g.minY + ty);
        canopySprite.scale.set(1 / this.cps);
        this.canopy.addChild(canopySprite);
        this.tiles.push({ x0: g.minX + tx, y0: g.minY + ty, w, h, canvas: cc, source, trees: [] });
      }
    }
    // each tree goes into every tile its crown or shadow touches
    const cols = Math.ceil(g.w / TILE);
    this.trees.forEach((t, k) => {
      const pad = t.r * 1.6;
      const x0 = Math.floor((t.x - pad - g.minX) / TILE), x1 = Math.floor((t.x + pad - g.minX) / TILE);
      const y0 = Math.floor((t.y - pad - g.minY) / TILE), y1 = Math.floor((t.y + pad - g.minY) / TILE);
      for (let ty = Math.max(0, y0); ty <= y1; ty++) for (let tx = Math.max(0, x0); tx <= Math.min(cols - 1, x1); tx++) {
        const tile = this.tiles[ty * cols + tx];
        if (tile) tile.trees.push(k);
      }
    });
    this.visible = new Uint8Array(this.trees.length);
    this.bakeCanopy(() => false);
  }

  get treeCount() { return this.trees.length; }

  /**
   * Updates the canopy, leaving out trees where `cleared(cellIndex)` is true.
   * Only tiles whose trees changed are redrawn.
   */
  bakeCanopy(cleared: (i: number) => boolean) {
    const g = this.world.grid;
    const changed = new Uint8Array(this.trees.length);
    let any = false;
    this.trees.forEach((t, k) => {
      const i = g.index(t.x, t.y);
      const v = i >= 0 && !cleared(i) && !(g.flags[i] & NEWBLD) ? 1 : 0;
      if (v !== this.visible[k]) { this.visible[k] = v; changed[k] = 1; any = true; }
    });
    if (!any) return;
    for (const tile of this.tiles) if (tile.trees.some((k) => changed[k])) this.drawTile(tile);
  }

  private drawTile(tile: Tile) {
    const ctx = tile.canvas.getContext('2d')!;
    const k = this.cps;
    ctx.clearRect(0, 0, tile.canvas.width, tile.canvas.height);
    const live = tile.trees.filter((i) => this.visible[i]).map((i) => this.trees[i]);
    const X = (x: number) => (x - tile.x0) * k, Y = (y: number) => (y - tile.y0) * k;
    // shadows (sun from the north-west)
    ctx.fillStyle = 'rgba(16, 28, 10, 0.32)';
    ctx.beginPath();
    for (const t of live) {
      const r = t.r * k;
      ctx.moveTo(X(t.x) + r * 0.45 + r, Y(t.y) + r * 0.55);
      ctx.ellipse(X(t.x) + r * 0.45, Y(t.y) + r * 0.55, r, r * 0.92, 0, 0, Math.PI * 2);
    }
    ctx.fill();
    // crowns: dark base, lighter inner crown, small highlight → leafy and round
    for (const pass of [0, 1, 2]) {
      for (let ci = 0; ci < CROWNS.length; ci++) {
        const base = CROWNS[ci];
        ctx.fillStyle = pass === 0 ? hex(base) : pass === 1 ? hex(tint(base, 1.12)) : `rgba(170, 205, 120, 0.13)`;
        ctx.beginPath();
        for (const t of live) {
          if (t.c !== ci) continue;
          const r = t.r * k;
          const cx = X(t.x), cy = Y(t.y);
          if (pass === 0) { ctx.moveTo(cx + r, cy); ctx.arc(cx, cy, r, 0, Math.PI * 2); }
          else if (pass === 1) { const rr = r * 0.7; ctx.moveTo(cx - r * 0.2 + rr, cy - r * 0.22); ctx.arc(cx - r * 0.2, cy - r * 0.22, rr, 0, Math.PI * 2); }
          else { const rr = r * 0.33; ctx.moveTo(cx - r * 0.38 + rr, cy - r * 0.42); ctx.arc(cx - r * 0.38, cy - r * 0.42, rr, 0, Math.PI * 2); }
        }
        ctx.fill();
      }
    }
    tile.source.update();
    tile.source.updateMipmaps();
  }

  destroy() {
    this.ground.destroy({ children: true, texture: true, textureSource: true });
    this.canopy.destroy({ children: true, texture: true, textureSource: true });
  }
}

const TILE = 256;
interface Tile { x0: number; y0: number; w: number; h: number; canvas: HTMLCanvasElement; source: CanvasSource; trees: number[] }

// ------------------------------------------------------------------ ground colours

const YARD = [0xbdb3a0, 0xc8c0b0, 0xb1a58e, 0xa99a7d];
const GRASS = 0x7c9f53, GRASS_LIGHT = 0x93b362, VEG = 0x4f7a36, VEG_DARK = 0x3d6530, DRY = 0xa2a06a, DIRT = 0xa48c66;

function groundColor(x: number, y: number, kind: number, dB: number, dR: number, flags: number, s: number, n1: number, n2: number): number {
  const fine = hash01(Math.floor(x * 1.7), Math.floor(y * 1.7), s) * 0.08 - 0.04;
  let c: number;
  if (flags & WATER) c = 0x55705a;
  else if (kind === 6) c = fieldColor(x, y, s);
  else if (kind === 7) c = mix(0x7a9a52, 0x6a8a48, n2);
  else if (kind === 4) c = mix(VEG_DARK, VEG, n2);
  else if (kind === 5) c = mix(0x6f8f62, 0x5e7f58, n2);
  else if (kind === 2) c = Math.floor(x / 5) % 2 ? 0x86b45e : 0x7cab56;
  else if (kind === 1 || kind === 3) c = mix(GRASS, GRASS_LIGHT, n2 * 0.8 + n1 * 0.2);
  else if (kind === 8) c = mix(0x8fa66a, 0xa7ad83, n2);
  else {
    // built-up land: paved/tiled yards near houses, trodden earth, then grass and scrub
    if (dB <= 1) c = YARD[Math.floor(hash01(Math.floor(x / 4), Math.floor(y / 4), s + 3) * YARD.length)];
    else if (dB <= 3) c = n2 > 0.55 ? mix(DIRT, 0xb5a587, n1) : mix(0x9aa064, GRASS, n1);
    else {
      const veg = smoothstep(0.45, 0.75, n1);
      c = mix(mix(GRASS, DRY, smoothstep(0.55, 0.8, n2) * 0.7), mix(VEG, VEG_DARK, n2), veg);
      if (n2 < 0.22) c = mix(c, DIRT, 0.6);
    }
    if (dR <= 1 && !(flags & ROAD)) c = mix(c, 0xb0a88f, 0.5); // dusty road verge
  }
  return rgba32(tint(c, 1 + fine));
}

/** Open water: deep blue with soft swell. */
function seaColor(x: number, y: number, s: number): number {
  const n = fbm(x / 35, y / 35, s + 77, 3);
  const swell = Math.sin((x * 0.3 + y * 0.12) + n * 6) * 0.03;
  return rgba32(tint(mix(0x3f7fae, 0x5a98c4, n), 1 + swell));
}

/** Rice fields: patches at different growth stages, with planting rows. */
function fieldColor(x: number, y: number, s: number): number {
  const wx = x + (fbm(x / 60, y / 60, s + 9) - 0.5) * 14, wy = y + (fbm(x / 60, y / 60, s + 19) - 0.5) * 14;
  const patch = hash01(Math.floor(wx / 26), Math.floor(wy / 22), s + 5);
  const stage = patch < 0.18 ? 0x8a9a86 /* flooded */ : patch < 0.32 ? 0xa48f63 /* harvested */ : patch < 0.6 ? 0x7fb04f : patch < 0.85 ? 0x95b65a : 0xb4b45e;
  const row = Math.sin((x * 0.94 + y * 0.34) * 2.2) > 0.55 ? 0.9 : 1;
  const dyke = (Math.abs((wx % 26) + 26) % 26 < 0.9 || Math.abs((wy % 22) + 22) % 22 < 0.9) ? 0x8f9b5c : 0;
  return dyke || tint(stage, row);
}

// ------------------------------------------------------------------ helpers

interface Coarse { step: number; cw: number; data: Float32Array }

/** fBm sampled every `step` meters over the map. */
function coarseNoise(w: number, h: number, step: number, scale: number, seed: number, octaves: number): Coarse {
  const cw = Math.ceil(w / step) + 2, ch = Math.ceil(h / step) + 2;
  const data = new Float32Array(cw * ch);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) data[y * cw + x] = fbm((x * step) / scale, (y * step) / scale, seed, octaves);
  return { step, cw, data };
}

/** Bilinear lookup in a coarse noise grid (map-relative meters). */
function sample(c: Coarse, x: number, y: number): number {
  const fx = x / c.step, fy = y / c.step;
  const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
  const i = y0 * c.cw + x0, d = c.data;
  const a = d[i] + (d[i + 1] - d[i]) * tx, b = d[i + c.cw] + (d[i + c.cw + 1] - d[i + c.cw]) * tx;
  return a + (b - a) * ty;
}

function distanceField(w: number, h: number, seed: (i: number) => boolean, cap: number): Uint8Array {
  const N = w * h;
  const d = new Uint8Array(N).fill(cap);
  const q = new Int32Array(N);
  let qh = 0, qt = 0;
  for (let i = 0; i < N; i++) if (seed(i)) { d[i] = 0; q[qt++] = i; }
  while (qh < qt) {
    const i = q[qh++];
    const nd = d[i] + 1;
    if (nd >= cap) continue;
    const x = i % w;
    if (x > 0 && d[i - 1] > nd) { d[i - 1] = nd; q[qt++] = i - 1; }
    if (x < w - 1 && d[i + 1] > nd) { d[i + 1] = nd; q[qt++] = i + 1; }
    if (i >= w && d[i - w] > nd) { d[i - w] = nd; q[qt++] = i - w; }
    if (i + w < N && d[i + w] > nd) { d[i + w] = nd; q[qt++] = i + w; }
  }
  return d;
}

function area(p: number[]): number {
  let a = 0;
  for (let i = 0; i < p.length; i += 2) {
    const j = (i + 2) % p.length;
    a += p[i] * p[j + 1] - p[j] * p[i + 1];
  }
  return Math.abs(a / 2);
}

function mix(a: number, b: number, t: number): number {
  t = Math.max(0, Math.min(1, t));
  const ch = (c: number, sh: number) => (c >> sh) & 0xff;
  const m = (sh: number) => Math.round(ch(a, sh) + (ch(b, sh) - ch(a, sh)) * t) << sh;
  return m(16) | m(8) | m(0);
}

function tint(c: number, f: number): number {
  const ch = (sh: number) => Math.max(0, Math.min(255, Math.round(((c >> sh) & 0xff) * f))) << sh;
  return ch(16) | ch(8) | ch(0);
}

function rgba32(c: number): number {
  return ((255 << 24) | ((c & 0xff) << 16) | (c & 0xff00) | ((c >> 16) & 0xff)) >>> 0;
}

function hex(c: number): string {
  return `#${c.toString(16).padStart(6, '0')}`;
}
