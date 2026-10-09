import type { MapBuilding, RoadKind } from '../shared/mapTypes';
import { hashString } from '../util/random';

export const COLORS = {
  background: 0x23272e,
  land: 0xd8d2bf,
  outOfBounds: 0x10131a,
  boundsLine: 0xffffff,
  water: 0x6aa6cf,
  waterEdge: 0x4f88b3,
  shadow: 0x000000,
  treeDark: 0x4f7d3f,
  treeLight: 0x6e9b52,
};

export const LANDUSE_COLORS: Record<string, number> = {
  residential: 0xd9d1bd,
  commercial: 0xd8cbc4,
  retail: 0xdbcabf,
  industrial: 0xcfccd3,
  construction: 0xd6c9a6,
  religious: 0xd4cfbf,
  education: 0xd9d0b8,
  institutional: 0xd3cfc3,
};

export const GREEN_COLORS: Record<string, number> = {
  park: 0x9cc47f,
  garden: 0xa5cf86,
  pitch: 0x84b96c,
  grass: 0xadcb8c,
  forest: 0x6f9d5a,
  scrub: 0x9fb67a,
  wetland: 0x9dbfa6,
  farmland: 0xd3d8a0,
  orchard: 0xa7c27f,
  paddy: 0xb4d38a,
  cemetery: 0xb5c6a0,
};

export interface RoadStyle { fill: number; casing: number; rank: number; dash?: boolean }
export const ROAD_STYLES: Record<RoadKind, RoadStyle> = {
  motorway: { fill: 0xb3b3ad, casing: 0x6d6d68, rank: 10 },
  trunk: { fill: 0xb3b3ad, casing: 0x6d6d68, rank: 9 },
  primary: { fill: 0xadada8, casing: 0x6f6f6a, rank: 8 },
  secondary: { fill: 0xa8a8a3, casing: 0x72726d, rank: 7 },
  tertiary: { fill: 0xa3a39e, casing: 0x777772, rank: 6 },
  residential: { fill: 0x9d9d98, casing: 0x7b7b76, rank: 5 },
  unclassified: { fill: 0x9d9d98, casing: 0x7b7b76, rank: 5 },
  living_street: { fill: 0xa19e96, casing: 0x807d76, rank: 4 },
  service: { fill: 0x9a9893, casing: 0x84827c, rank: 3 },
  pedestrian: { fill: 0xc9c2b2, casing: 0x9f988a, rank: 3 },
  track: { fill: 0xb8a88a, casing: 0x9a8b6f, rank: 2 },
  path: { fill: 0xe6dcc4, casing: 0xb3a98f, rank: 1 },
  rail: { fill: 0x5c5c5c, casing: 0x3e3e3e, rank: 11 },
};

/** Roof palettes, weighted by repetition. Inspired by Southeast Asian towns from above. */
const RESIDENTIAL_ROOFS = [
  0xc4683f, 0xc4683f, 0xb5562f, 0xb5562f, 0xd07a4c, 0x9c4a2e, 0xa85a3a, 0xc97f5a, // terracotta
  0x8f9193, 0xa5a7a8, 0x6e7173, 0x7c7f80, // zinc / grey
  0xe6e4de, 0xd8d6cf, // white / light concrete
  0x7f97a8, 0x8d6f5a, // blue zinc, brown
];
const COMMERCIAL_ROOFS = [0x9a9c9e, 0xb6b8b9, 0xd9d8d2, 0xe8e6e0, 0x7f97a8, 0x6e7173, 0xc4683f, 0xa95a38];
const INDUSTRIAL_ROOFS = [0xb7bcc0, 0x9fb0bd, 0xc9cdd0, 0x8a9aa6];

const COMMERCIAL = new Set(['commercial', 'retail', 'office', 'supermarket', 'kiosk', 'hotel']);
const INDUSTRIAL = new Set(['industrial', 'warehouse', 'factory', 'hangar', 'manufacture']);

export function roofColor(b: MapBuilding): number {
  const h = hashString(b.id);
  if (b.type === 'mosque' || (b.use === 'place_of_worship' && b.type === 'yes')) return [0x3f7f5a, 0x2f6d8f, 0xe8e6e0][h % 3];
  if (b.type === 'church' || b.type === 'temple') return 0xa04a3a;
  if (b.type === 'school' || b.use === 'school') return 0xc8743c;
  if (INDUSTRIAL.has(b.type) || b.use === 'industrial') return INDUSTRIAL_ROOFS[h % INDUSTRIAL_ROOFS.length];
  if (COMMERCIAL.has(b.type) || b.use?.startsWith('shop:')) return COMMERCIAL_ROOFS[h % COMMERCIAL_ROOFS.length];
  return RESIDENTIAL_ROOFS[h % RESIDENTIAL_ROOFS.length];
}

export function shade(color: number, f: number): number {
  const r = Math.min(255, Math.round(((color >> 16) & 0xff) * f));
  const g = Math.min(255, Math.round(((color >> 8) & 0xff) * f));
  const b = Math.min(255, Math.round((color & 0xff) * f));
  return (r << 16) | (g << 8) | b;
}
