/** Demolish / road / build rules on the sample map. */
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { World } from '../src/game/World.ts';
import { Game } from '../src/game/Game.ts';
import { OWNED } from '../src/game/LandGrid.ts';
import type { MapData } from '../src/shared/mapTypes.ts';
import type { Plot } from '../src/game/types.ts';

const map: MapData = JSON.parse(await readFile(new URL('../maps/sample-kampung.json', import.meta.url), 'utf8'));
const g = new Game(new World(map));
g.money = 1e15;
const w = g.world;

// Buy a block: a house on a residential street and everything within 45 m of it (skip holdouts' land).
const centre = w.plots.find((p) => p.category === 'house' && p.road?.kind === 'residential' && p.road.distance < 3 && Math.abs(p.cx) < 300 && Math.abs(p.cy) < 300)!;
const block = w.plots.filter((p) => Math.hypot(p.cx - centre.cx, p.cy - centre.cy) < 45 && w.ownerOf(p).kind !== 'state' && !w.ownerOf(p).holdout);
g.setStatus(block.map((p) => p.id), 'sold');
assert.ok(g.dev.grid.get(centre.cx, centre.cy) & OWNED, 'sold land is owned on the grid');

// 1. Can't build on top of a standing building.
const angle = g.dev.roadAngle(centre.cx, centre.cy) ?? 0;
assert.ok(['blocked', 'onRoad'].includes(g.dev.buildingCheck('house', centre.cx, centre.cy, angle).problem!));

// 2. Demolish every building on the block; land frees up after the demolition days pass.
for (const p of block) if (p.kind === 'building') assert.ok(g.demolish(p).ok, `demolish ${p.id}`);
assert.ok(!g.dev.buildingCheck('house', centre.cx, centre.cy, angle).ok, 'still blocked while demolishing');
for (let i = 0; i < 31; i++) g.advanceDay();
assert.equal(g.dev.demolishing.size, 0);

// 3. A house fits on the cleared land facing the road.
let placed = false;
for (const p of [centre, ...block]) {
  const a = g.dev.roadAngle(p.cx, p.cy) ?? 0;
  const c = g.dev.buildingCheck('house', p.cx, p.cy, a);
  if (c.ok) { g.placeBuilding('house', p.cx, p.cy, a); placed = true; break; }
}
assert.ok(placed, 'a house can be placed on cleared owned land');

// 4. Can't build on land you don't own.
const foreign = w.plots.find((p) => p.kind === 'building' && !g.ownsPlot(p.id) && Math.hypot(p.cx - centre.cx, p.cy - centre.cy) > 200)!;
assert.ok(!g.dev.buildingCheck('house', foreign.cx, foreign.cy, 0).ok);
const stateCell = w.plots.find((p: Plot) => p.category === 'state_land' && p.cx > -150 && Math.abs(p.cx) < 400 && Math.abs(p.cy) < 400 && w.plotAt(p.cx, p.cy) === p)!;
assert.equal(g.dev.buildingCheck('house', stateCell.cx, stateCell.cy, 0).problem, 'notOwned');

// 5. Large buildings need enough land: a mall does not fit on a single house plot.
assert.ok(!g.dev.buildingCheck('mall', centre.cx, centre.cy, angle).ok);

// 6. Roads: only over owned land or existing roads; snapping works; can be removed again.
const road = g.dev.roadCheck([foreign.cx - 20, foreign.cy, foreign.cx + 20, foreign.cy], 'street');
assert.ok(!road.ok, 'no roads through land you do not own');
const [sx, sy] = g.dev.snap(centre.cx + 0.3, centre.cy + 0.4, 0);
assert.ok(Number.isInteger(sx), 'grid snap');
void sy;

// 7. Building completes after its construction days.
const nb = g.dev.buildings[0];
for (let i = 0; i < nb.total; i++) g.advanceDay();
assert.equal(nb.daysLeft, 0);
assert.ok(g.dev.removeBuilding(nb.id));

// 8. An alley can only be removed once you own both sides.
const alley = map.roads.find((r) => r.kind === 'service')!;
assert.equal(g.dev.canRemoveOriginalRoad(alley.id), false);
const mainRoad = map.roads.find((r) => r.kind === 'primary')!;
assert.equal(g.dev.canRemoveOriginalRoad(mainRoad.id), false, 'main roads are never removable');

console.log(`owned ${g.dev.ownedArea()} m², ${block.length} plots`);
console.log('✔ development test passed');
