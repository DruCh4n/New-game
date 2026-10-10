/**
 * Angled ("2.5D") illustrations of each building type, so you can see what you're about to build
 * from the side, not just from above. Parametric SVG: a box with a front and a side face, windows,
 * a roof, and per-style and per-seed variety so modern buildings look distinct.
 */
import { hashString } from '../util/random';
import { buildingType, type BuildingTypeId } from '../game/catalog';

const WALLS = ['#e8e4da', '#d9d4c7', '#cdd3d6', '#e0d2bd', '#d2c3b0', '#c9ccce'];
const ROOFS = ['#3a3f47', '#4a4038', '#5a5048', '#444a52', '#6b4a3a'];
const TERRACOTTA = ['#b9542f', '#c4683f', '#a8502f', '#9c5a3c'];
const GLASS = '#8fb5d6';

interface Opt { walls: string; roof: string; glass: string; floors: number; pitched: boolean; balcony: boolean; accent: string }

function opts(id: BuildingTypeId, seed: number): Opt {
  const r = (n: number) => ((hashString(`${id}|${seed}|${n}`) % 1000) / 1000);
  const bt = buildingType(id);
  const modern = r(9) > 0.4;
  return {
    walls: WALLS[Math.floor(r(1) * WALLS.length)],
    roof: (bt.style === 'house' && !modern) ? TERRACOTTA[Math.floor(r(2) * TERRACOTTA.length)] : ROOFS[Math.floor(r(3) * ROOFS.length)],
    glass: GLASS,
    floors: bt.floors,
    pitched: bt.style === 'house' && !modern,
    balcony: modern && bt.floors >= 3,
    accent: TERRACOTTA[Math.floor(r(4) * TERRACOTTA.length)],
  };
}

/** SVG illustration of a building type. `size` is the pixel box. */
export function buildingArt(id: BuildingTypeId, seed = 0, size = 96): string {
  const bt = buildingType(id);
  const o = opts(id, seed);
  const body = art(bt.style, id, o);
  return `<svg class="bldg-art" viewBox="0 0 120 108" width="${size}" height="${Math.round(size * 0.9)}" aria-hidden="true">
    <ellipse cx="60" cy="98" rx="52" ry="8" fill="#000" opacity="0.18"/>${body}</svg>`;
}

// angled box geometry: front face + right face + roof
const DX = 26, DY = -14; // depth skew

function box(x0: number, yBase: number, fw: number, bh: number, o: Opt, roofKind: 'flat' | 'pitch'): string {
  const front = `${x0},${yBase} ${x0 + fw},${yBase} ${x0 + fw},${yBase - bh} ${x0},${yBase - bh}`;
  const side = `${x0 + fw},${yBase} ${x0 + fw + DX},${yBase + DY} ${x0 + fw + DX},${yBase + DY - bh} ${x0 + fw},${yBase - bh}`;
  const shade = darken(o.walls, 0.82);
  let p = `<polygon points="${side}" fill="${shade}"/><polygon points="${front}" fill="${o.walls}"/>`;
  if (roofKind === 'flat') {
    const roof = `${x0},${yBase - bh} ${x0 + fw},${yBase - bh} ${x0 + fw + DX},${yBase - bh + DY} ${x0 + DX},${yBase - bh + DY}`;
    p += `<polygon points="${roof}" fill="${darken(o.roof, 1.1)}"/><polygon points="${roof}" fill="none" stroke="${o.roof}" stroke-width="1"/>`;
  } else {
    const ridgeY = yBase - bh - 12;
    const fcx = x0 + fw / 2;
    p += `<polygon points="${x0},${yBase - bh} ${fcx},${ridgeY} ${x0 + fw},${yBase - bh}" fill="${o.accent}"/>`;
    p += `<polygon points="${x0 + fw},${yBase - bh} ${fcx},${ridgeY} ${fcx + DX},${ridgeY + DY} ${x0 + fw + DX},${yBase - bh + DY}" fill="${darken(o.accent, 0.8)}"/>`;
  }
  return p;
}

/** Window grid on the front face. */
function windows(x0: number, yBase: number, fw: number, bh: number, o: Opt, cols: number, rows: number): string {
  const p: string[] = [];
  const mx = fw * 0.14, my = bh * 0.14;
  const gw = (fw - mx * 2) / cols, gh = (bh - my * 2) / rows;
  const ww = gw * 0.6, wh = gh * 0.6;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const wx = x0 + mx + c * gw + (gw - ww) / 2, wy = yBase - bh + my + r * gh + (gh - wh) / 2;
    p.push(`<rect x="${wx.toFixed(1)}" y="${wy.toFixed(1)}" width="${ww.toFixed(1)}" height="${wh.toFixed(1)}" rx="1" fill="${o.glass}" opacity="0.92"/>`);
  }
  return p.join('');
}

function art(style: string, id: BuildingTypeId, o: Opt): string {
  const tall = Math.min(o.floors, 12);
  switch (style) {
    case 'house': {
      const bh = o.pitched ? 26 : 30 + (o.floors - 1) * 10;
      let p = box(14, 90, 64, bh, o, o.pitched ? 'pitch' : 'flat');
      p += windows(14, 90, 64, bh, o, 2, Math.max(1, o.floors));
      // door
      p += `<rect x="38" y="74" width="11" height="16" rx="1" fill="${darken(o.accent, 0.7)}"/>`;
      if (o.balcony || !o.pitched) p += `<rect x="14" y="${90 - bh}" width="64" height="2.5" fill="${darken(o.walls, 0.7)}"/>`;
      // a bit of greenery
      p += `<circle cx="86" cy="86" r="6" fill="#4f7d3f"/><circle cx="90" cy="82" r="4" fill="#6e9b52"/>`;
      return p;
    }
    case 'kost': {
      const bh = 34 + tall * 7;
      return box(16, 90, 60, bh, o, 'flat') + windows(16, 90, 60, bh, o, 3, tall) +
        `<rect x="16" y="${90 - bh}" width="60" height="3" fill="${o.accent}"/>`;
    }
    case 'ruko': {
      const units = Math.max(2, Math.round(bt(id).width / 10));
      const bh = 30 + tall * 9;
      let p = box(12, 90, 72, bh, o, 'flat');
      p += windows(12, 90, 72, bh, o, units, Math.max(1, tall - 1));
      // shopfronts at ground
      const uw = 72 / units;
      for (let i = 0; i < units; i++) p += `<rect x="${(12 + i * uw + 2).toFixed(1)}" y="78" width="${(uw - 4).toFixed(1)}" height="12" fill="${i % 2 ? o.accent : darken(o.glass, 0.9)}"/>`;
      return p;
    }
    case 'apartment': case 'office': case 'hotel': {
      const bh = 34 + tall * 5.5;
      let p = box(22, 90, 50, bh, o, 'flat');
      const cols = style === 'office' ? 4 : 3;
      p += windows(22, 90, 50, bh, o, cols, tall);
      if (o.balcony || style === 'hotel') for (let r = 1; r < tall; r++) p += `<rect x="22" y="${(90 - bh + (bh / tall) * r).toFixed(1)}" width="50" height="2" fill="${darken(o.walls, 0.7)}"/>`;
      if (style === 'office') p += `<polygon points="22,${90 - bh} 72,${90 - bh} ${72 + DX},${90 - bh + DY} ${22 + DX},${90 - bh + DY}" fill="${darken(o.glass, 0.8)}" opacity="0.5"/>`;
      return p;
    }
    case 'mall': case 'market': case 'warehouse': {
      const bh = style === 'warehouse' ? 34 : 40;
      let p = box(10, 90, 80, bh, o, 'flat');
      if (style === 'mall') { p += windows(10, 90, 80, bh, o, 5, 2); p += `<rect x="40" y="72" width="20" height="18" fill="${o.glass}"/>`; }
      else if (style === 'market') { p += `<polygon points="10,${90 - bh} 50,${90 - bh - 8} 90,${90 - bh}" fill="${o.accent}"/>`; p += windows(10, 90, 80, bh, o, 6, 1); }
      else p += `<rect x="36" y="66" width="28" height="24" fill="${darken(o.walls, 0.75)}"/>`;
      return p;
    }
    case 'mosque': {
      let p = box(22, 90, 56, 36, o, 'flat');
      p += `<ellipse cx="50" cy="${90 - 36}" rx="16" ry="12" fill="${o.accent}"/><ellipse cx="50" cy="${90 - 40}" rx="4" ry="8" fill="#d9b44a"/>`;
      p += `<rect x="78" y="40" width="7" height="50" fill="${o.walls}"/><ellipse cx="81" cy="40" rx="4" ry="6" fill="#d9b44a"/>`;
      return p;
    }
    case 'school': case 'hall': case 'clinic': {
      const bh = 30 + tall * 7;
      let p = box(14, 90, 64, bh, o, 'flat') + windows(14, 90, 64, bh, o, 4, Math.max(1, tall));
      if (style === 'clinic') p += `<rect x="42" y="${90 - bh + 4}" width="4" height="12" fill="#c62828"/><rect x="38" y="${90 - bh + 8}" width="12" height="4" fill="#c62828"/>`;
      if (style === 'school') p += `<rect x="20" y="36" width="1.5" height="18" fill="#888"/><polygon points="21.5,36 32,40 21.5,44" fill="#c4683f"/>`;
      return p;
    }
    case 'park': {
      return `<ellipse cx="60" cy="92" rx="48" ry="12" fill="#9cc47f"/>` +
        [[40, 80], [72, 76], [56, 86], [86, 84], [30, 86]].map(([x, y], i) => `<rect x="${x - 1}" y="${y}" width="2" height="8" fill="#6b4a2a"/><circle cx="${x}" cy="${y}" r="${7 + (i % 2) * 2}" fill="#4f7d3f"/><circle cx="${x - 2}" cy="${y - 2}" r="4" fill="#6e9b52"/>`).join('');
    }
    case 'parking': case 'futsal': {
      let p = `<polygon points="12,90 96,90 108,76 24,76" fill="${style === 'futsal' ? '#3f7d4a' : '#7a7d82'}"/>`;
      if (style === 'parking') for (let i = 0; i < 5; i++) p += `<line x1="${28 + i * 14}" y1="88" x2="${40 + i * 14}" y2="78" stroke="#e6dcc4" stroke-width="1"/>`;
      else p += `<rect x="52" y="78" width="4" height="10" fill="none" stroke="#fff" stroke-width="1"/>`;
      return p;
    }
    default: {
      const bh = 30 + tall * 7;
      return box(16, 90, 60, bh, o, 'flat') + windows(16, 90, 60, bh, o, 3, Math.max(1, tall));
    }
  }
}

const bt = (id: BuildingTypeId) => buildingType(id);

function darken(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((n >> 8) & 255) * f));
  const b = Math.min(255, Math.round((n & 255) * f));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}
