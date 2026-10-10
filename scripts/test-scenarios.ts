/** Scenario rules: winning, deadlines, bankruptcy, being run out of town, score, save. */
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { World } from '../src/game/World.ts';
import { Game } from '../src/game/Game.ts';
import { SCENARIOS, TUTORIAL_STEPS, checkObjectives, computeScore, continuePlaying, homesProvided, newScenarioState, retire, scenario } from '../src/game/scenarios.ts';
import { restore, serialize } from '../src/game/save.ts';
import type { MapData } from '../src/shared/mapTypes.ts';
import type { ScenarioId } from '../src/game/scenarios.ts';

const map: MapData = JSON.parse(await readFile(new URL('../maps/sample-kampung.json', import.meta.url), 'utf8'));
const start = (id: ScenarioId) => {
  const g = new Game(new World(map), scenario(id).difficulty);
  g.scenario = newScenarioState(g, id);
  return g;
};

// 1. Tutorial: buy a plot and build a house → won.
{
  const g = start('tutorial');
  g.money = 1e14;
  const p = g.world.plots.find((x) => x.category === 'house' && x.road?.kind === 'residential' && x.road.distance < 2)!;
  g.setStatus([p.id], 'sold');
  g.demolish(p);
  for (let i = 0; i < 31; i++) g.advanceDay();
  let placed = false;
  for (let r = 0; r < 12 && !placed; r += 1) for (let a = 0; a < 6.28 && !placed; a += 0.4) {
    const x = p.cx + Math.cos(a) * r, y = p.cy + Math.sin(a) * r;
    placed = g.placeBuilding('house', Math.round(x), Math.round(y), g.dev.roadAngle(x, y) ?? 0).ok;
  }
  if (!placed) {
    // the parcel may be too small for a house: take the neighbours too
    g.setStatus(p.neighbors, 'sold');
    for (const n of p.neighbors) g.demolish(g.world.plot(n)!);
    for (let i = 0; i < 31; i++) g.advanceDay();
    for (let r = 0; r < 20 && !placed; r += 1) for (let a = 0; a < 6.28 && !placed; a += 0.3) {
      const x = p.cx + Math.cos(a) * r, y = p.cy + Math.sin(a) * r;
      placed = g.placeBuilding('house', Math.round(x), Math.round(y), g.dev.roadAngle(x, y) ?? 0).ok;
    }
  }
  assert.ok(placed, 'house placed');
  for (let i = 0; i < 60; i++) g.advanceDay();
  checkObjectives(g);
  assert.equal(g.scenario.outcome, 'playing', 'not won until the guided steps are done');
  g.scenario.tutorialStep = TUTORIAL_STEPS;
  checkObjectives(g);
  assert.equal(g.scenario.outcome, 'won');
  assert.ok(computeScore(g).lines.some((l) => l.key === 'victory'));
  assert.equal(homesProvided(g), 1);
}

// 2. Deadline: doing nothing in the ruko scenario loses after two years.
{
  const g = start('ruko');
  for (let i = 0; i < 735; i++) g.advanceDay();
  assert.equal(g.scenario.outcome, 'lost');
  assert.equal(g.scenario.reason, 'deadline');
  continuePlaying(g);
  for (let i = 0; i < 40; i++) g.advanceDay();
  assert.equal(g.scenario.outcome, 'lost', 'free play continues after an ending');
}

// 3. Bankruptcy: three month-ends in a row below zero.
{
  const g = start('tower');
  g.money = -5e9;
  for (let i = 0; i < 100 && g.scenario.outcome === 'playing'; i++) { g.money = Math.min(g.money, -5e9); g.advanceDay(); }
  assert.equal(g.scenario.outcome, 'lost');
  assert.equal(g.scenario.reason, 'bankrupt');
  assert.ok(computeScore(g).lines.some((l) => l.key === 'bankrupt'));
}

// 4. Run out of town: reputation under 5 for six months.
{
  const g = start('renewal');
  for (let i = 0; i < 200 && g.scenario.outcome === 'playing'; i++) { g.reputation = 2; g.advanceDay(); }
  assert.equal(g.scenario.reason, 'reputation');
}

// 5. Sandbox never ends on its own; retiring gives a score; scenario state is saved.
{
  const g = start('sandbox');
  for (let i = 0; i < 400; i++) g.advanceDay();
  assert.equal(g.scenario.outcome, 'playing');
  retire(g);
  assert.equal(g.scenario.outcome, 'retired');
  const s = computeScore(g);
  assert.ok(s.total > 0 && s.rank);
  const g2 = restore(JSON.parse(JSON.stringify(serialize(g, 'sample-kampung'))), map);
  assert.deepEqual(g2.scenario, g.scenario);
}

// 6. Harder difficulty multiplies the score.
{
  const easy = start('ruko'), hard = start('district');
  retire(easy); retire(hard);
  assert.ok(computeScore(hard).lines.some((l) => l.key === 'difficulty' && l.points > 0));
  assert.ok(computeScore(easy).lines.some((l) => l.key === 'difficulty' && l.points < 0));
}

// 7. The tutorial picks a willing owner whose land fits a house, and they sell near market value.
{
  const { prepareTutorial } = await import('../src/game/tutorialSetup.ts');
  const { startVisit, listen, makeOffer, acceptCounter } = await import('../src/game/negotiation.ts');
  const g = start('tutorial');
  const p = prepareTutorial(g)!;
  assert.ok(p, 'a tutorial plot was found');
  g.money = 1e14;
  const s = startVisit(g, p);
  listen(g, s);
  const r = makeOffer(g, s, s.value, []);
  if (r === 'countered') {
    assert.ok(s.askCash! <= s.value * 1.25, `fair counter (${s.askCash} vs ${s.value})`);
    acceptCounter(g, s);
  }
  assert.ok(g.ownsPlot(p.id), 'bought');
  for (const id of g.world.ownerOf(p).plotIds) g.demolish(g.world.plot(id)!);
  for (let i = 0; i < 31; i++) g.advanceDay();
  let ok = false;
  for (const id of g.world.ownerOf(p).plotIds) {
    const q = g.world.plot(id)!;
    const [x0, y0, x1, y1] = q.cellBox;
    for (let y = y0; y <= y1 && !ok; y += 2) for (let x = x0; x <= x1 && !ok; x += 2) {
      const wx = g.world.grid.minX + x + 0.5, wy = g.world.grid.minY + y + 0.5;
      ok = g.dev.buildingCheck('house', wx, wy, g.dev.roadAngle(wx, wy) ?? 0).ok;
    }
  }
  assert.ok(ok, 'a house fits on the tutorial land');
}

assert.equal(SCENARIOS.length, 6);
console.log('✔ scenario test passed');

// Milestone 12: inheritance grants a starting plot the player owns.
{
  const { grantInheritance } = await import('../src/game/scenarios.ts');
  const g = new Game(new World(map), 'normal');
  const id = grantInheritance(g);
  assert.ok(id, 'granted a plot');
  assert.ok(g.ownsPlot(id!), 'player owns it');
  assert.equal(g.scenario.inheritedPlot, id);
  assert.ok(g.papers.checked.has(id!), 'papers known');
  console.log('inheritance ok:', id);
}
