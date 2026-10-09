import type { FlatPoints, RoadKind } from '../shared/mapTypes';
import type { Gender } from './names';

export type PlotStatus = 'not_approached' | 'negotiating' | 'sold' | 'refused';

export type BuildingCategory =
  | 'house' | 'shophouse' | 'shop' | 'office' | 'industrial' | 'apartment'
  | 'worship' | 'school' | 'civic' | 'market' | 'outbuilding';
export type LandCategory = 'state_land' | 'park' | 'field' | 'cemetery';
export type PlotCategory = BuildingCategory | LandCategory;

export interface RoadAccess {
  kind: RoadKind;
  name?: string;
  /** Distance from plot edge to the road edge, meters. */
  distance: number;
}

export interface Plot {
  id: string;
  /** Position in World.plots; also the value stored in the parcel raster. */
  index: number;
  kind: 'building' | 'land';
  category: PlotCategory;
  buildingId?: string;
  name?: string;
  /** Approximate outline (footprint + 2 m, or the 20 m square). The exact parcel lives in World.parcels. */
  poly: FlatPoints;
  footprint?: FlatPoints;
  cx: number;
  cy: number;
  area: number;
  footprintArea: number;
  floors: number;
  floorArea: number;
  /** Nearest road usable by cars (null = only footpaths nearby). */
  road: RoadAccess | null;
  /** Nearest road of any kind including footpaths. */
  access: RoadAccess | null;
  mainRoad: boolean;
  landValue: number;
  buildingValue: number;
  value: number;
  ownerId: string;
  neighbors: string[];
  /** Raster bounding box of the parcel: [x0, y0, x1, y1] in cell coordinates. */
  cellBox: [number, number, number, number];
}

export type OwnerKind = 'person' | 'company' | 'institution' | 'state';
export type Finances = 'needs_money' | 'comfortable' | 'wealthy';
export type RelationKind = 'family' | 'friend' | 'neutral' | 'rival';

export interface Relation {
  ownerId: string;
  kind: RelationKind;
  /** -100 (bitter) .. 100 (very close) */
  value: number;
}

/** A personal detail used for flavour text and (from Milestone 3) dialogue. */
export interface Story {
  key: string;
  params?: Record<string, string | number>;
}

export interface Owner {
  id: string;
  kind: OwnerKind;
  /** Display name for persons/companies. Institutions/state use nameKey (translated). */
  name: string;
  nameKey?: string;
  nameParams?: Record<string, string>;
  /** For persons: Pak / Bu / Mbah …  */
  honorific: string;
  gender?: Gender;
  age?: number;
  occupation?: string; // string key, e.g. "warung"
  familySize: number;
  yearsLived: number;
  /** 0-100 */
  attachment: number;
  /** 0-100 */
  greed: number;
  finances: Finances;
  /** Will never sell, whatever the offer. Hidden from the player. */
  holdout: boolean;
  /** Hidden: minimum acceptable price = market value × this factor (drifts over time from M3). */
  minFactor: number;
  /** 0-100, current mood toward the developer. */
  mood: number;
  plotIds: string[];
  relations: Relation[];
  stories: Story[];
}
