/** Milestone 11: building variants, grid, enclosed-road demolition. */
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { World } from '../src/game/World.ts';
import { Game } from '../src/game/Game.ts';
import { BUILDING_TYPES, buildingGroups, buildingType, variantsOf } from '../src/game/catalog.ts';

const map = JSON.parse(await readFile(new URL('../maps/sample-kampung.json', import.meta.url), 'utf8'));
const g = new Game(new World(map));

// every type resolves, has a valid style and group
for (const b of BUILDING_TYPES) {
  assert.ok(buildingType(b.id) === b, b.id);
  assert.ok(b.style && b.group, b.id);
}
// house group has 4 size variants, costs increase with size
const houses = variantsOf('house');
assert.equal(houses.length, 4);
const costs = houses.map((h) => g.dev.buildingCost(h.id).cost);
for (let i = 1; i < costs.length; i++) assert.ok(costs[i] >= costs[i - 1], `house cost grows: ${costs}`);
// groups cover all types once
const groups = buildingGroups();
assert.equal(groups.reduce((n, gr) => n + gr.variants.length, 0), BUILDING_TYPES.length);
assert.ok(groups.find((gr) => gr.group === 'house')!.variants.length === 4);
console.log('variants ok:', groups.map((gr) => `${gr.group}:${gr.variants.length}`).join(' '));
console.log('✔ building test passed');
