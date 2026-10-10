/** Milestone 13: events, market modifiers, protests, rival developer. */
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { World } from '../src/game/World.ts';
import { Game } from '../src/game/Game.ts';
import { canVisit, minimumPrice } from '../src/game/negotiation.ts';
import { eventDemand, marketMult, maybeProtest, monthlyEvents, permitsBlocked, rivalOwns, rivalTurn } from '../src/game/events.ts';
import { restore, serialize } from '../src/game/save.ts';
import type { MapData } from '../src/shared/mapTypes.ts';

const map: MapData = JSON.parse(await readFile(new URL('../maps/sample-kampung.json', import.meta.url), 'utf8'));

// 1. A boom raises the market and owner prices; a crash lowers them.
{
  const g = new Game(new World(map));
  const p = g.world.plots.find((pl) => pl.category === 'house' && !g.world.ownerOf(pl).holdout)!;
  const base = minimumPrice(g, g.world.ownerOf(p), p.value);
  g.events.active.push({ kind: 'boom', day: 0, until: 999, market: 1.18, demand: 1.15 });
  assert.ok(marketMult(g) > 1 && eventDemand(g) > 1);
  assert.ok(minimumPrice(g, g.world.ownerOf(p), p.value) > base, 'boom raises prices');
  g.events.active[0] = { kind: 'crash', day: 0, until: 999, market: 0.8, demand: 0.8 };
  assert.ok(minimumPrice(g, g.world.ownerOf(p), p.value) < base, 'crash lowers prices');
}

// 2. Protests freeze permits.
{
  const g = new Game(new World(map));
  g.reputation = 20;
  g.events.protestsUntil = g.day + 10;
  assert.ok(permitsBlocked(g));
  assert.equal(g.permitDays('apartment'), null, 'no permits during protests');
}

// 3. The rival buys plots over time, and you can't buy what they own.
{
  const g = new Game(new World(map));
  for (let m = 1; m <= 12; m++) { g.day = 30 * m; rivalTurn(g); }
  assert.ok(g.events.rival.owned.length > 0, `rival bought (${g.events.rival.owned.length})`);
  const rid = g.events.rival.owned[0];
  assert.ok(rivalOwns(g, rid));
  assert.equal(canVisit(g, g.world.plot(rid)!).block, 'rival');
  console.log('rival owns', g.events.rival.owned.length, 'plots');
}

// 4. Events fire over time and round-trip through a save.
{
  const g = new Game(new World(map));
  for (let m = 1; m <= 60; m++) { g.day = 30 * m; monthlyEvents(g); maybeProtest(g); }
  const g2 = restore(JSON.parse(JSON.stringify(serialize(g, 'sample-kampung'))), map);
  assert.equal(g2.events.news.length, g.events.news.length);
  assert.equal(g2.events.rival.name, g.events.rival.name);
  console.log('news items after 5 years:', g.events.news.length);
}

console.log('✔ events test passed');
