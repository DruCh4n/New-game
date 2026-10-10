/** Things the player can build. Costs are multiples of the country's build cost per m² of floor area. */

export type BuildingTypeId =
  | 'house' | 'house_small' | 'house_large' | 'villa'
  | 'ruko' | 'ruko_pair' | 'ruko_block'
  | 'apartment' | 'apartment_block'
  | 'mall' | 'office' | 'school' | 'park' | 'mosque' | 'hall' | 'parking'
  | 'kost' | 'kost_large' | 'clinic' | 'hotel' | 'market' | 'warehouse' | 'futsal';

/** Render style (several size variants share one). */
export type BuildStyle =
  | 'house' | 'ruko' | 'apartment' | 'mall' | 'office' | 'school' | 'park' | 'mosque' | 'hall' | 'parking'
  | 'kost' | 'clinic' | 'hotel' | 'market' | 'warehouse' | 'futsal';

export interface BuildingType {
  id: BuildingTypeId;
  /** Palette group: size variants share a group; the first in a group is its default. */
  group: string;
  /** Short size label (S / M / L / XL), empty for one-size types. */
  size: string;
  /** Which drawing routine to use. */
  style: BuildStyle;
  icon: string;
  width: number; // meters along the street
  depth: number;
  floors: number;
  /** Cost multiplier per m² of floor area (park/parking use footprint only). */
  costFactor: number;
  days: number;
  /** Owned land required around the footprint (meters). */
  setback: number;
  /** Building outline is drawn as a roof (false = open ground like park/parking). */
  roofed: boolean;
  /** How it earns money: rented out, shop leases, units sold, or none (civic). */
  income: 'rent' | 'lease' | 'sale' | 'civic';
  /** Annual gross yield on construction cost when fully let (rent/lease). */
  yield: number;
  /** Lettable or sellable units; promised apartments/shops are taken from these. */
  units: number;
  /** Reputation gained when a civic building opens. */
  rep: number;
}

/** Needs a building permit (reputation-dependent) before construction starts. */
export function needsPermit(b: BuildingType): boolean {
  return b.floors >= 3 || b.width * b.depth >= 900;
}

export const BUILDING_TYPES: BuildingType[] = [
  // ---- houses ----
  { id: 'house_small', group: 'house', size: 'S', style: 'house', icon: '🏠', width: 6, depth: 8, floors: 1, costFactor: 0.95, days: 30, setback: 1, roofed: true, income: 'rent', yield: 0.1, units: 1, rep: 0 },
  { id: 'house', group: 'house', size: 'M', style: 'house', icon: '🏠', width: 9, depth: 11, floors: 2, costFactor: 1.0, days: 45, setback: 1, roofed: true, income: 'rent', yield: 0.1, units: 1, rep: 0 },
  { id: 'house_large', group: 'house', size: 'L', style: 'house', icon: '🏠', width: 12, depth: 14, floors: 2, costFactor: 1.05, days: 60, setback: 2, roofed: true, income: 'rent', yield: 0.1, units: 1, rep: 0 },
  { id: 'villa', group: 'house', size: 'XL', style: 'house', icon: '🏡', width: 16, depth: 18, floors: 2, costFactor: 1.2, days: 90, setback: 3, roofed: true, income: 'rent', yield: 0.09, units: 1, rep: 0 },
  // ---- shophouses ----
  { id: 'ruko_pair', group: 'ruko', size: 'S', style: 'ruko', icon: '🏪', width: 10, depth: 15, floors: 2, costFactor: 1.0, days: 60, setback: 1, roofed: true, income: 'lease', yield: 0.14, units: 2, rep: 0 },
  { id: 'ruko', group: 'ruko', size: 'M', style: 'ruko', icon: '🏪', width: 20, depth: 15, floors: 3, costFactor: 1.0, days: 90, setback: 1, roofed: true, income: 'lease', yield: 0.14, units: 4, rep: 0 },
  { id: 'ruko_block', group: 'ruko', size: 'L', style: 'ruko', icon: '🏪', width: 32, depth: 16, floors: 3, costFactor: 1.0, days: 140, setback: 1, roofed: true, income: 'lease', yield: 0.14, units: 7, rep: 0 },
  // ---- apartments ----
  { id: 'apartment', group: 'apartment', size: 'M', style: 'apartment', icon: '🏢', width: 26, depth: 20, floors: 10, costFactor: 1.4, days: 300, setback: 4, roofed: true, income: 'sale', yield: 0, units: 80, rep: 0 },
  { id: 'apartment_block', group: 'apartment', size: 'L', style: 'apartment', icon: '🏢', width: 36, depth: 24, floors: 14, costFactor: 1.4, days: 420, setback: 5, roofed: true, income: 'sale', yield: 0, units: 150, rep: 0 },
  // ---- boarding houses ----
  { id: 'kost', group: 'kost', size: 'M', style: 'kost', icon: '🛏', width: 16, depth: 12, floors: 3, costFactor: 0.9, days: 100, setback: 1, roofed: true, income: 'rent', yield: 0.2, units: 24, rep: 0 },
  { id: 'kost_large', group: 'kost', size: 'L', style: 'kost', icon: '🛏', width: 22, depth: 16, floors: 4, costFactor: 0.9, days: 150, setback: 2, roofed: true, income: 'rent', yield: 0.2, units: 48, rep: 0 },
  // ---- one-size types ----
  { id: 'mall', group: 'mall', size: '', style: 'mall', icon: '🛍', width: 50, depth: 40, floors: 3, costFactor: 1.3, days: 360, setback: 4, roofed: true, income: 'lease', yield: 0.13, units: 40, rep: 1 },
  { id: 'office', group: 'office', size: '', style: 'office', icon: '🏬', width: 24, depth: 24, floors: 8, costFactor: 1.6, days: 300, setback: 4, roofed: true, income: 'rent', yield: 0.13, units: 16, rep: 0 },
  { id: 'hotel', group: 'hotel', size: '', style: 'hotel', icon: '🏨', width: 30, depth: 20, floors: 7, costFactor: 1.5, days: 280, setback: 4, roofed: true, income: 'rent', yield: 0.14, units: 60, rep: 0 },
  { id: 'market', group: 'market', size: '', style: 'market', icon: '🧺', width: 40, depth: 30, floors: 2, costFactor: 0.9, days: 180, setback: 3, roofed: true, income: 'lease', yield: 0.16, units: 60, rep: 2 },
  { id: 'warehouse', group: 'warehouse', size: '', style: 'warehouse', icon: '📦', width: 32, depth: 24, floors: 1, costFactor: 0.6, days: 60, setback: 2, roofed: true, income: 'lease', yield: 0.1, units: 4, rep: 0 },
  { id: 'parking', group: 'parking', size: '', style: 'parking', icon: '🅿', width: 30, depth: 20, floors: 1, costFactor: 0.15, days: 20, setback: 0, roofed: false, income: 'rent', yield: 0.15, units: 1, rep: 0 },
  // ---- civic ----
  { id: 'school', group: 'school', size: '', style: 'school', icon: '🏫', width: 44, depth: 18, floors: 3, costFactor: 1.1, days: 180, setback: 3, roofed: true, income: 'civic', yield: 0, units: 0, rep: 5 },
  { id: 'mosque', group: 'mosque', size: '', style: 'mosque', icon: '🕌', width: 24, depth: 24, floors: 2, costFactor: 1.3, days: 150, setback: 3, roofed: true, income: 'civic', yield: 0, units: 0, rep: 5 },
  { id: 'clinic', group: 'clinic', size: '', style: 'clinic', icon: '⚕', width: 22, depth: 16, floors: 2, costFactor: 1.3, days: 120, setback: 2, roofed: true, income: 'civic', yield: 0, units: 0, rep: 4 },
  { id: 'park', group: 'park', size: '', style: 'park', icon: '🌳', width: 30, depth: 30, floors: 1, costFactor: 0.08, days: 30, setback: 0, roofed: false, income: 'civic', yield: 0, units: 0, rep: 3 },
  { id: 'hall', group: 'hall', size: '', style: 'hall', icon: '🏛', width: 20, depth: 16, floors: 1, costFactor: 1.0, days: 60, setback: 2, roofed: true, income: 'civic', yield: 0, units: 0, rep: 3 },
  { id: 'futsal', group: 'futsal', size: '', style: 'futsal', icon: '⚽', width: 22, depth: 36, floors: 1, costFactor: 0.12, days: 30, setback: 1, roofed: false, income: 'civic', yield: 0, units: 0, rep: 2 },
];

export function buildingType(id: BuildingTypeId): BuildingType {
  return BUILDING_TYPES.find((b) => b.id === id)!;
}

/** Palette groups in order, each with its size variants. */
export function buildingGroups(): { group: string; variants: BuildingType[] }[] {
  const out: { group: string; variants: BuildingType[] }[] = [];
  for (const b of BUILDING_TYPES) {
    let g = out.find((x) => x.group === b.group);
    if (!g) { g = { group: b.group, variants: [] }; out.push(g); }
    g.variants.push(b);
  }
  return out;
}

/** The size variants that share a type's group. */
export function variantsOf(id: BuildingTypeId): BuildingType[] {
  const group = buildingType(id).group;
  return BUILDING_TYPES.filter((b) => b.group === group);
}

export type RoadTypeId = 'gang' | 'street' | 'avenue';

export interface RoadType {
  id: RoadTypeId;
  width: number;
  /** Cost multiplier per m² of road surface. */
  costFactor: number;
  /** Counts as car access for buildings. */
  car: boolean;
}

export const ROAD_TYPES: RoadType[] = [
  { id: 'gang', width: 4, costFactor: 0.12, car: true },
  { id: 'street', width: 7, costFactor: 0.15, car: true },
  { id: 'avenue', width: 12, costFactor: 0.18, car: true },
];

export function roadType(id: RoadTypeId): RoadType {
  return ROAD_TYPES.find((r) => r.id === id)!;
}
