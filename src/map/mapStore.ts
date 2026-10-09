import { isMapData, type MapData } from '../shared/mapTypes';

/** Every JSON in /maps is bundled at build time, so the game needs no network or server. */
const modules = import.meta.glob<unknown>('/maps/*.json', { import: 'default' });

export interface MapEntry {
  key: string; // e.g. "sample-kampung"
  load: () => Promise<MapData>;
}

export function listBundledMaps(): MapEntry[] {
  return Object.keys(modules)
    .sort()
    .map((path) => ({
      key: path.replace(/^.*\//, '').replace(/\.json$/, ''),
      load: async () => validate(await modules[path]()),
    }));
}

export async function loadMapFile(file: File): Promise<MapData> {
  let data: unknown;
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw new Error(`${file.name} is not a JSON file`);
  }
  return validate(data);
}

function validate(v: unknown): MapData {
  if (!isMapData(v)) throw new Error('not a processed map file (expected format "citymap"; run the importer first)');
  return v;
}

const LAST_KEY = 'kotabaru.lastMap';
export function rememberMap(key: string) {
  try { localStorage.setItem(LAST_KEY, key); } catch { /* ignore */ }
}
export function lastMap(): string | null {
  try { return localStorage.getItem(LAST_KEY); } catch { return null; }
}
