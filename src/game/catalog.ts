/** Things the player can build. Costs are multiples of the country's build cost per m² of floor area. */

export type BuildingTypeId =
  | 'house' | 'ruko' | 'apartment' | 'mall' | 'office' | 'school' | 'park' | 'mosque' | 'hall' | 'parking';

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
}

export const BUILDING_TYPES: BuildingType[] = [
  { id: 'house', icon: '🏠', width: 9, depth: 11, floors: 2, costFactor: 1.0, days: 45, setback: 1, roofed: true },
  { id: 'ruko', icon: '🏪', width: 20, depth: 15, floors: 3, costFactor: 1.0, days: 90, setback: 1, roofed: true },
  { id: 'apartment', icon: '🏢', width: 26, depth: 20, floors: 10, costFactor: 1.4, days: 300, setback: 4, roofed: true },
  { id: 'mall', icon: '🛍', width: 50, depth: 40, floors: 3, costFactor: 1.3, days: 360, setback: 4, roofed: true },
  { id: 'office', icon: '🏬', width: 24, depth: 24, floors: 8, costFactor: 1.6, days: 300, setback: 4, roofed: true },
  { id: 'school', icon: '🏫', width: 44, depth: 18, floors: 3, costFactor: 1.1, days: 180, setback: 3, roofed: true },
  { id: 'park', icon: '🌳', width: 30, depth: 30, floors: 1, costFactor: 0.08, days: 30, setback: 0, roofed: false },
  { id: 'mosque', icon: '🕌', width: 24, depth: 24, floors: 2, costFactor: 1.3, days: 150, setback: 3, roofed: true },
  { id: 'hall', icon: '🏛', width: 20, depth: 16, floors: 1, costFactor: 1.0, days: 60, setback: 2, roofed: true },
  { id: 'parking', icon: '🅿', width: 30, depth: 20, floors: 1, costFactor: 0.15, days: 20, setback: 0, roofed: false },
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
