/** Things the player can build. Costs are multiples of the country's build cost per m² of floor area. */

export type BuildingTypeId =
  | 'house' | 'ruko' | 'apartment' | 'mall' | 'office' | 'school' | 'park' | 'mosque' | 'hall' | 'parking'
  | 'kost' | 'clinic' | 'hotel' | 'market' | 'warehouse' | 'futsal';

export interface BuildingType {
  id: BuildingTypeId;
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
  { id: 'house', icon: '🏠', width: 9, depth: 11, floors: 2, costFactor: 1.0, days: 45, setback: 1, roofed: true, income: 'rent', yield: 0.1, units: 1, rep: 0 },
  { id: 'ruko', icon: '🏪', width: 20, depth: 15, floors: 3, costFactor: 1.0, days: 90, setback: 1, roofed: true, income: 'lease', yield: 0.12, units: 4, rep: 0 },
  { id: 'apartment', icon: '🏢', width: 26, depth: 20, floors: 10, costFactor: 1.4, days: 300, setback: 4, roofed: true, income: 'sale', yield: 0, units: 80, rep: 0 },
  { id: 'mall', icon: '🛍', width: 50, depth: 40, floors: 3, costFactor: 1.3, days: 360, setback: 4, roofed: true, income: 'lease', yield: 0.13, units: 40, rep: 1 },
  { id: 'office', icon: '🏬', width: 24, depth: 24, floors: 8, costFactor: 1.6, days: 300, setback: 4, roofed: true, income: 'rent', yield: 0.11, units: 16, rep: 0 },
  { id: 'school', icon: '🏫', width: 44, depth: 18, floors: 3, costFactor: 1.1, days: 180, setback: 3, roofed: true, income: 'civic', yield: 0, units: 0, rep: 5 },
  { id: 'park', icon: '🌳', width: 30, depth: 30, floors: 1, costFactor: 0.08, days: 30, setback: 0, roofed: false, income: 'civic', yield: 0, units: 0, rep: 3 },
  { id: 'mosque', icon: '🕌', width: 24, depth: 24, floors: 2, costFactor: 1.3, days: 150, setback: 3, roofed: true, income: 'civic', yield: 0, units: 0, rep: 5 },
  { id: 'hall', icon: '🏛', width: 20, depth: 16, floors: 1, costFactor: 1.0, days: 60, setback: 2, roofed: true, income: 'civic', yield: 0, units: 0, rep: 3 },
  { id: 'parking', icon: '🅿', width: 30, depth: 20, floors: 1, costFactor: 0.15, days: 20, setback: 0, roofed: false, income: 'rent', yield: 0.15, units: 1, rep: 0 },
  { id: 'kost', icon: '🛏', width: 16, depth: 12, floors: 3, costFactor: 0.9, days: 100, setback: 1, roofed: true, income: 'rent', yield: 0.14, units: 24, rep: 0 },
  { id: 'clinic', icon: '⚕', width: 22, depth: 16, floors: 2, costFactor: 1.3, days: 120, setback: 2, roofed: true, income: 'civic', yield: 0, units: 0, rep: 4 },
  { id: 'hotel', icon: '🏨', width: 30, depth: 20, floors: 7, costFactor: 1.5, days: 280, setback: 4, roofed: true, income: 'rent', yield: 0.12, units: 60, rep: 0 },
  { id: 'market', icon: '🧺', width: 40, depth: 30, floors: 2, costFactor: 0.9, days: 180, setback: 3, roofed: true, income: 'lease', yield: 0.14, units: 60, rep: 2 },
  { id: 'warehouse', icon: '📦', width: 32, depth: 24, floors: 1, costFactor: 0.6, days: 60, setback: 2, roofed: true, income: 'lease', yield: 0.1, units: 4, rep: 0 },
  { id: 'futsal', icon: '⚽', width: 22, depth: 36, floors: 1, costFactor: 0.12, days: 30, setback: 1, roofed: false, income: 'civic', yield: 0, units: 0, rep: 2 },
];

export function buildingType(id: BuildingTypeId): BuildingType {
  return BUILDING_TYPES.find((b) => b.id === id)!;
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
