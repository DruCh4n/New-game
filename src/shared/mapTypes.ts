/**
 * Processed map format shared by the importer (Node) and the game (browser).
 *
 * Coordinates are local meters around the map center:
 *   x grows to the east, y grows to the SOUTH (same direction as screen y).
 * Geometry is stored as flat arrays [x0, y0, x1, y1, ...] to keep files small.
 * Polygons are not closed (the last point is not repeated).
 */

export const MAP_FORMAT = 'citymap';
export const MAP_VERSION = 1;

export type FlatPoints = number[];

export interface LatLon {
  lat: number;
  lon: number;
}

export interface BBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface MapBuilding {
  id: string;
  /** OSM `building=*` value, e.g. "house", "yes", "retail", "mosque". */
  type: string;
  /** Extra usage hint from amenity/shop/office tags, e.g. "place_of_worship", "school". */
  use?: string;
  levels?: number;
  name?: string;
  poly: FlatPoints;
}

export type RoadKind =
  | 'motorway'
  | 'trunk'
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'residential'
  | 'unclassified'
  | 'living_street'
  | 'service'
  | 'track'
  | 'pedestrian'
  | 'path'
  | 'rail';

export interface MapRoad {
  id: string;
  kind: RoadKind;
  /** Carriageway width in meters. */
  width: number;
  name?: string;
  bridge?: boolean;
  line: FlatPoints;
}

export interface MapArea {
  id: string;
  kind: string;
  poly: FlatPoints;
  holes?: FlatPoints[];
}

export interface MapWaterway {
  id: string;
  kind: string;
  width: number;
  line: FlatPoints;
}

export interface MapData {
  format: typeof MAP_FORMAT;
  version: typeof MAP_VERSION;
  name: string;
  /** ISO 3166-1 alpha-2 country code (used later for owner names). */
  country?: string;
  source: 'osm' | 'synthetic';
  attribution: string;
  importedAt: string;
  center: LatLon;
  bbox: BBox;
  /** Map extent in local meters (x/y min/max of the requested bbox). */
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  buildings: MapBuilding[];
  roads: MapRoad[];
  water: MapArea[];
  waterways: MapWaterway[];
  /** Parks, grass, forest, farmland, ... */
  greens: MapArea[];
  /** Residential/commercial/industrial land-use zones (drawn as subtle tints). */
  landuse: MapArea[];
  /** Individual trees as flat [x, y, x, y, ...]. */
  trees: FlatPoints;
}

export function isMapData(v: unknown): v is MapData {
  const m = v as MapData;
  return !!m && m.format === MAP_FORMAT && typeof m.version === 'number' && Array.isArray(m.buildings);
}
