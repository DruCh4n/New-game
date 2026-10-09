import { isMapData, type BBox, type MapData } from '../shared/mapTypes';
import { inferBBox, isOverpassResponse, processOverpass, type ProcessStats } from '../shared/osm';
import { idb } from '../util/idb';

/** Every JSON in /maps is bundled at build time, so the game needs no network or server. */
const modules = import.meta.glob<unknown>('/maps/*.json', { import: 'default' });

export interface MapEntry {
  key: string; // "sample-kampung", or "idb:<slug>" for maps imported in the browser
  label: string;
  load: () => Promise<MapData>;
}

interface ImportedIndexRow { key: string; name: string; importedAt: string }
const INDEX_KEY = 'maps-index';

export function listBundledMaps(): MapEntry[] {
  return Object.keys(modules)
    .sort()
    .map((path) => {
      const key = path.replace(/^.*\//, '').replace(/\.json$/, '');
      return { key, label: key, load: async () => validate(await modules[path]()) };
    });
}

/** Bundled maps plus maps imported in this browser. */
export async function listMaps(): Promise<MapEntry[]> {
  const rows = (await idb.get<ImportedIndexRow[]>(INDEX_KEY)) ?? [];
  const imported: MapEntry[] = rows.map((r) => ({
    key: r.key,
    label: `★ ${r.name}`,
    load: async () => {
      const m = await idb.get<MapData>(`map:${r.key}`);
      if (!m) throw new Error('imported map is missing from browser storage');
      return validate(m);
    },
  }));
  return [...listBundledMaps(), ...imported];
}

/** Stores a converted map in the browser so it appears in the map list. */
export async function saveImportedMap(map: MapData): Promise<string> {
  const key = `idb:${slugify(map.name)}`;
  await idb.set(`map:${key}`, map);
  const rows = ((await idb.get<ImportedIndexRow[]>(INDEX_KEY)) ?? []).filter((r) => r.key !== key);
  rows.push({ key, name: map.name, importedAt: map.importedAt });
  await idb.set(INDEX_KEY, rows);
  return key;
}

export async function deleteImportedMap(key: string) {
  await idb.del(`map:${key}`);
  const rows = ((await idb.get<ImportedIndexRow[]>(INDEX_KEY)) ?? []).filter((r) => r.key !== key);
  await idb.set(INDEX_KEY, rows);
}

export interface FileLoadResult {
  map: MapData;
  /** Set when the file was a raw Overpass download that we converted. */
  stats?: ProcessStats;
}

/** Opens a processed map, or converts a raw Overpass JSON download (from overpass-turbo). */
export async function loadMapFile(file: File, bbox?: BBox, name?: string): Promise<FileLoadResult> {
  let data: unknown;
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw new Error(`${file.name} is not a JSON file`);
  }
  if (isMapData(data)) return { map: data };
  if (isOverpassResponse(data)) {
    const box = bbox ?? inferBBox(data);
    if (!box) throw new Error('the Overpass file has no buildings or roads to place the map');
    const { map, stats } = processOverpass(data, { name: name || file.name.replace(/\.json$/i, ''), bbox: box });
    return { map, stats };
  }
  throw new Error('not a map file or an Overpass export');
}

function validate(v: unknown): MapData {
  if (!isMapData(v)) throw new Error('not a processed map file (expected format "citymap"; run the importer first)');
  return v;
}

export function slugify(s: string): string {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'map';
}

/** A square bbox of `size` meters around a point. */
export function bboxAround(lat: number, lon: number, size: number): BBox {
  const dLat = size / 2 / 111320;
  const dLon = size / 2 / (111320 * Math.cos((lat * Math.PI) / 180));
  return { south: lat - dLat, west: lon - dLon, north: lat + dLat, east: lon + dLon };
}

const LAST_KEY = 'kotabaru.lastMap';
export function rememberMap(key: string) {
  try { localStorage.setItem(LAST_KEY, key); } catch { /* ignore */ }
}
export function lastMap(): string | null {
  try { return localStorage.getItem(LAST_KEY); } catch { return null; }
}
