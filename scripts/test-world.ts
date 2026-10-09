/** Checks plot/owner generation on the sample map: determinism, consistency and sane distributions. */
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { World } from '../src/game/World.ts';
import { formatMoney } from '../src/game/regional.ts';
import type { MapData } from '../src/shared/mapTypes.ts';

const map: MapData = JSON.parse(await readFile(new URL('../maps/sample-kampung.json', import.meta.url), 'utf8'));
const t0 = performance.now();
const w = new World(map);
const ms = performance.now() - t0;
const w2 = new World(map);

assert.equal(w.plots.length, w2.plots.length);
assert.deepEqual(w.owners.map((o) => [o.id, o.name, o.minFactor]), w2.owners.map((o) => [o.id, o.name, o.minFactor]), 'deterministic');

for (const p of w.plots) {
  const o = w.owner(p.ownerId);
  assert.ok(o, `plot ${p.id} has owner`);
  assert.ok(o!.plotIds.includes(p.id), 'owner lists plot');
  assert.ok(p.value > 0, 'positive value');
  for (const n of p.neighbors) assert.ok(w.plot(n)!.neighbors.includes(p.id), 'neighbors symmetric');
}
for (const o of w.owners) for (const r of o.relations) assert.ok(w.owner(r.ownerId)!.relations.some((x) => x.ownerId === o.id), 'relations symmetric');

// hit test: a building centroid returns that building's plot
const b = w.plots.find((p) => p.kind === 'building')!;
assert.equal(w.plotAt(b.cx, b.cy)?.id, b.id);

const count = <T,>(arr: T[], key: (t: T) => string) => arr.reduce<Record<string, number>>((m, t) => ((m[key(t)] = (m[key(t)] ?? 0) + 1), m), {});
const persons = w.owners.filter((o) => o.kind === 'person');
const values = w.plots.filter((p) => p.category === 'house').map((p) => p.value).sort((a, b) => a - b);
const fmt = (v: number) => formatMoney(v, w.region, 'en');
console.log(`generated in ${ms.toFixed(0)} ms`);
console.log('plots by category', count(w.plots, (p) => p.category));
console.log('owners by kind', count(w.owners, (o) => o.kind));
console.log('holdouts', persons.filter((o) => o.holdout).length, 'of', persons.length, 'persons');
console.log('finances', count(persons, (o) => o.finances));
console.log('relations', count(w.owners.flatMap((o) => o.relations), (r) => r.kind));
console.log('house value p10/p50/p90', fmt(values[Math.floor(values.length * 0.1)]), fmt(values[Math.floor(values.length / 2)]), fmt(values[Math.floor(values.length * 0.9)]));
console.log('avg neighbors', (w.plots.reduce((a, p) => a + p.neighbors.length, 0) / w.plots.length).toFixed(1));
console.log('sample owners:', persons.slice(0, 4).map((o) => `${o.honorific} ${o.name} (${o.age}, ${o.occupation}) [${o.stories.map((s) => s.key)}]`));
console.log('✔ world test passed');
