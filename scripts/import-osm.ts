/**
 * One-time OpenStreetMap importer. Run while online; the game itself is fully offline.
 *
 *   npm run import-map -- --center -6.2297,106.8295 --size 1000 --name "Setiabudi"
 *   npm run import-map -- --bbox -6.234,106.825,-6.225,106.834 --name "Setiabudi"
 *   npm run import-map -- --input maps/raw/setiabudi.overpass.json --bbox ... --name "Setiabudi"
 *
 * Options:
 *   --bbox s,w,n,e       Bounding box in degrees (south, west, north, east)
 *   --center lat,lon     Alternative to --bbox: center point ...
 *   --size meters        ... and square size in meters (default 1000)
 *   --name "Name"        Map name (also used for the file name)
 *   --country XX         ISO country code (auto-detected if omitted)
 *   --input file.json    Use a saved Overpass response instead of downloading
 *   --save-raw           Also save the raw Overpass response to maps/raw/
 *   --endpoint URL       Custom Overpass API endpoint
 *   --print-query        Only print the Overpass query (to run it yourself on overpass-turbo.eu)
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BBox } from '../src/shared/mapTypes.ts';
import { buildOverpassQuery, processOverpass, type OverpassResponse } from '../src/shared/osm.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAPS_DIR = path.join(ROOT, 'maps');
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

function parseArgs(argv: string[]): Record<string, string | true> {
  const out: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) { out[a.slice(2)] = next; i++; }
    else out[a.slice(2)] = true;
  }
  return out;
}

function fail(msg: string): never {
  console.error(`\n✖ ${msg}\n\nRun with --help for usage.`);
  process.exit(1);
}

function nums(v: string | true | undefined, count: number, label: string): number[] {
  if (typeof v !== 'string') fail(`${label} is required`);
  const n = v.split(',').map((s) => parseFloat(s.trim()));
  if (n.length !== count || n.some((x) => !Number.isFinite(x))) fail(`${label} must be ${count} comma-separated numbers`);
  return n;
}

function resolveBBox(args: Record<string, string | true>): BBox {
  if (args.bbox) {
    const [south, west, north, east] = nums(args.bbox, 4, '--bbox');
    if (south >= north || west >= east) fail('--bbox must be south,west,north,east (south < north, west < east)');
    return { south, west, north, east };
  }
  if (args.center) {
    const [lat, lon] = nums(args.center, 2, '--center');
    const size = typeof args.size === 'string' ? parseFloat(args.size) : 1000;
    if (!(size > 50 && size < 10000)) fail('--size must be between 50 and 10000 meters');
    const dLat = size / 2 / 111320;
    const dLon = size / 2 / (111320 * Math.cos((lat * Math.PI) / 180));
    return { south: lat - dLat, west: lon - dLon, north: lat + dLat, east: lon + dLon };
  }
  fail('Provide either --bbox s,w,n,e or --center lat,lon [--size m]');
}

function slugify(s: string): string {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'map';
}

async function overpass(query: string, endpoints: string[]): Promise<unknown> {
  let lastErr: unknown;
  for (const url of endpoints) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        console.log(`  → ${url} (attempt ${attempt})`);
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'city-redevelopment-game-importer/0.1' },
          body: 'data=' + encodeURIComponent(query),
        });
        if (res.status === 429 || res.status === 504) throw new Error(`server busy (HTTP ${res.status})`);
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
        return await res.json();
      } catch (e) {
        lastErr = e;
        console.warn(`    failed: ${(e as Error).message}`);
        await new Promise((r) => setTimeout(r, 3000 * attempt));
      }
    }
  }
  throw lastErr;
}

async function detectCountry(lat: number, lon: number, endpoints: string[]): Promise<string | undefined> {
  try {
    const q = `[out:json][timeout:30];is_in(${lat},${lon})->.a;area.a["admin_level"="2"];out tags;`;
    const res = (await overpass(q, endpoints)) as { elements: { tags?: Record<string, string> }[] };
    for (const el of res.elements) {
      const code = el.tags?.['ISO3166-1'] || el.tags?.['ISO3166-1:alpha2'];
      if (code) return code.toUpperCase();
    }
  } catch {
    /* optional */
  }
  return undefined;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    console.log((await readFile(fileURLToPath(import.meta.url), 'utf8')).split('*/')[0]);
    return;
  }
  const bbox = resolveBBox(args);
  if (args['print-query']) {
    console.log(buildOverpassQuery(bbox));
    return;
  }
  const name = typeof args.name === 'string' ? args.name : `Map ${bbox.south.toFixed(4)},${bbox.west.toFixed(4)}`;
  const slug = slugify(name);
  const endpoints = typeof args.endpoint === 'string' ? [args.endpoint] : ENDPOINTS;

  const widthM = (bbox.east - bbox.west) * 111320 * Math.cos((((bbox.south + bbox.north) / 2) * Math.PI) / 180);
  const heightM = (bbox.north - bbox.south) * 111320;
  const km2 = (widthM * heightM) / 1e6;
  console.log(`\nImporting "${name}"  (${Math.round(widthM)} m × ${Math.round(heightM)} m ≈ ${km2.toFixed(2)} km²)`);
  if (km2 > 4) console.warn('⚠ Large area. Start with ~1 km² for good performance; this may be slow.');

  let raw: OverpassResponse;
  if (typeof args.input === 'string') {
    console.log(`Reading Overpass data from ${args.input}`);
    raw = JSON.parse(await readFile(args.input, 'utf8'));
  } else {
    console.log('Downloading from Overpass API (can take up to a minute)…');
    raw = (await overpass(buildOverpassQuery(bbox), endpoints)) as OverpassResponse;
    if (args['save-raw']) {
      await mkdir(path.join(MAPS_DIR, 'raw'), { recursive: true });
      const rawPath = path.join(MAPS_DIR, 'raw', `${slug}.overpass.json`);
      await writeFile(rawPath, JSON.stringify(raw));
      console.log(`Saved raw response → ${path.relative(ROOT, rawPath)}`);
    }
  }
  if (!raw || !Array.isArray(raw.elements)) fail('Unexpected Overpass response (no "elements" array)');

  let country = typeof args.country === 'string' ? args.country.toUpperCase() : undefined;
  if (!country && typeof args.input !== 'string') {
    console.log('Detecting country…');
    country = await detectCountry((bbox.south + bbox.north) / 2, (bbox.west + bbox.east) / 2, endpoints);
  }

  const { map, stats } = processOverpass(raw, { name, bbox, country });
  await mkdir(MAPS_DIR, { recursive: true });
  const outPath = path.join(MAPS_DIR, `${slug}.json`);
  const json = JSON.stringify(map);
  await writeFile(outPath, json);

  console.log(`\n✔ Saved ${path.relative(ROOT, outPath)}  (${(json.length / 1024).toFixed(0)} KB)`);
  console.log(`  country: ${map.country ?? 'unknown (use --country XX)'}${country ? '' : ' (guessed from coordinates)'}`);
  const { warnings, ...counts } = stats;
  console.table(counts);
  for (const w of warnings) console.warn(`⚠ ${w}`);
  console.log('Restart or reload `npm run dev` and pick the map from the map menu.\n');
}

main().catch((e) => {
  console.error('\n✖ Import failed:', (e as Error).message ?? e);
  process.exit(1);
});
