/** Offline sanity test for the OSM processor using a hand-made Overpass fixture. */
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { processOverpass } from './lib/osm.ts';
import { LocalProjection } from '../src/shared/projection.ts';
import { polygonArea } from '../src/shared/geometry.ts';

const raw = JSON.parse(await readFile(new URL('./fixtures/overpass-sample.json', import.meta.url), 'utf8'));
const bbox = { south: -6.2325, west: 106.8275, north: -6.2275, east: 106.8325 };
const { map, stats } = processOverpass(raw, { name: 'Fixture', bbox, country: 'ID' });

assert.equal(stats.buildings, 2, 'building outside bbox is dropped');
const house = map.buildings.find((b) => b.id === 'w10')!;
assert.equal(house.levels, 2);
assert.equal(house.poly.length, 8, 'closing point removed');
const area = polygonArea(house.poly);
assert.ok(area > 100 && area < 150, `house area ~121 m², got ${area}`);
assert.equal(map.buildings.find((b) => b.id === 'w11')!.use, 'place_of_worship');

assert.equal(stats.roads, 2, 'primary + footway, proposed skipped');
const main = map.roads.find((r) => r.kind === 'primary')!;
assert.equal(main.name, 'Jalan Raya');
assert.ok(main.width >= 12, 'lanes increase width');
assert.equal(map.roads.find((r) => r.id === 'w21')!.kind, 'path');

assert.equal(map.waterways[0].kind, 'river');
assert.equal(map.greens[0].kind, 'park');
assert.equal(map.landuse[0].kind, 'residential');
assert.equal(map.water.length, 1, 'multipolygon assembled from two open ways');
assert.equal(map.water[0].holes?.length, 1, 'inner ring kept as hole');
assert.equal(stats.trees, 1);

const p = new LocalProjection(map.center);
const [x, y] = p.toLocal(bbox.north, bbox.east);
const back = p.toLatLon(x, y);
assert.ok(Math.abs(back.lat - bbox.north) < 1e-9 && Math.abs(back.lon - bbox.east) < 1e-9, 'projection round-trips');
assert.ok(y < 0, 'north is negative y (screen up)');
assert.ok(Math.abs(map.bounds.maxX - map.bounds.minX - 552) < 5, `width ≈ 552 m, got ${map.bounds.maxX - map.bounds.minX}`);

console.log('✔ import test passed', stats);
