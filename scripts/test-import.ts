/** Offline sanity test for the OSM processor using a hand-made Overpass fixture. */
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { guessCountry, inferBBox, processOverpass } from '../src/shared/osm.ts';
import { LocalProjection } from '../src/shared/projection.ts';
import { polygonArea } from '../src/shared/geometry.ts';

const raw = JSON.parse(await readFile(new URL('./fixtures/overpass-sample.json', import.meta.url), 'utf8'));
const bbox = { south: -6.2325, west: 106.8275, north: -6.2275, east: 106.8325 };
const { map, stats } = processOverpass(raw, { name: 'Fixture', bbox, country: 'ID' });

const p0 = new LocalProjection(map.center);
assert.equal(stats.buildings, 3, 'building outside bbox is dropped');
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
assert.ok(stats.trees >= 30, `tree row adds trees (${stats.trees})`);
assert.equal(map.buildings.find((b) => b.id === 'w13')!.levels, 10, 'height 31 m → 10 floors');
assert.equal(house.use, 'cafe', 'shop point inside an untagged house enriches it');
assert.equal(house.name, 'Warung Bu Siti');
assert.equal(stats.pois, 1, 'points outside buildings are ignored');
assert.ok(map.sea, 'coastline produces sea');
// the coastline runs west→east, so the sea is on the south side
const { seaSampler } = await import('../src/shared/sea.ts');
const isSea = seaSampler(map)!;
const [sx, sy] = p0.toLocal(-6.2324, 106.83);
const [lx, ly] = p0.toLocal(-6.2290, 106.83);
assert.ok(isSea(sx, sy), 'south of the coastline is sea');
assert.ok(!isSea(lx, ly), 'north of the coastline is land');
assert.ok(stats.sea > 20000 && stats.sea < 40000, `sea area ${stats.sea}`);
assert.equal(guessCountry(-7.8, 110.37), 'ID');
assert.equal(guessCountry(3.14, 101.69), 'MY');
assert.equal(guessCountry(13.75, 100.5), 'TH');
assert.equal(guessCountry(14.6, 121.0), 'PH');
assert.equal(guessCountry(1.3, 103.85), 'SG');
assert.equal(guessCountry(21.03, 105.85), 'VN');
const inferred = inferBBox(raw)!;
assert.ok(inferred.south < -6.2299 && inferred.north > -6.2292, 'bbox inferred from buildings');
// a map with no country given guesses it from coordinates
assert.equal(processOverpass(raw, { name: 'x', bbox }).map.country, 'ID');

const p = new LocalProjection(map.center);
const [x, y] = p.toLocal(bbox.north, bbox.east);
const back = p.toLatLon(x, y);
assert.ok(Math.abs(back.lat - bbox.north) < 1e-9 && Math.abs(back.lon - bbox.east) < 1e-9, 'projection round-trips');
assert.ok(y < 0, 'north is negative y (screen up)');
assert.ok(Math.abs(map.bounds.maxX - map.bounds.minX - 552) < 5, `width ≈ 552 m, got ${map.bounds.maxX - map.bounds.minX}`);

console.log('✔ import test passed', stats);
