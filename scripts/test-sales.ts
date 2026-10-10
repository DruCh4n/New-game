/** Milestone 11: price levels, marketing, walk-in buyers. */
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { World } from '../src/game/World.ts';
import { Game } from '../src/game/Game.ts';
import { closeMonth } from '../src/game/Economy.ts';
import {
  acceptBuyer, counterBuyer, listPrice, marketingActive, monthlyBuyers, priceLevel, runCampaign, setPriceLevel, unitsLeft,
} from '../src/game/sales.ts';
import { restore, serialize } from '../src/game/save.ts';
import { buildingType } from '../src/game/catalog.ts';
import type { MapData } from '../src/shared/mapTypes.ts';

const map: MapData = JSON.parse(await readFile(new URL('../maps/sample-kampung.json', import.meta.url), 'utf8'));

/** A game with one finished apartment tower that has units to sell. */
function withTower(): Game {
  const g = new Game(new World(map));
  g.money *= 50;
  const p = g.world.plots.find((pl) => pl.category === 'house' && pl.road)!;
  g.setStatus([p.id], 'sold');
  const { cost, days } = g.dev.buildingCost('apartment');
  const b = g.dev.placeBuilding('apartment', p.cx, p.cy, 0, { ok: true, cost, days }, 0);
  b.daysLeft = 0; b.total = days; b.permitDays = 0; b.priceLevel = 1;
  return g;
}

// 1. Price level clamps and changes the list price.
{
  const g = withTower();
  const b = g.dev.buildings[0];
  setPriceLevel(g, b, 1.2);
  assert.equal(priceLevel(b), 1.2);
  const base = listPrice({ ...b, priceLevel: 1 } as never);
  assert.ok(listPrice(b) > base);
  setPriceLevel(g, b, 5); assert.equal(priceLevel(b), 1.3); // clamp
}

// 2. A higher price slows unit sales; a lower price speeds them up.
{
  const slow = withTower(); setPriceLevel(slow, slow.dev.buildings[0], 1.3);
  const fast = withTower(); setPriceLevel(fast, fast.dev.buildings[0], 0.8);
  for (let m = 0; m < 6; m++) { slow.day = 30 * (m + 1); fast.day = 30 * (m + 1); closeMonth(slow); closeMonth(fast); }
  assert.ok(fast.dev.buildings[0].unitsSold > slow.dev.buildings[0].unitsSold, `fast ${fast.dev.buildings[0].unitsSold} > slow ${slow.dev.buildings[0].unitsSold}`);
  console.log('sales pace: fast', fast.dev.buildings[0].unitsSold, 'slow', slow.dev.buildings[0].unitsSold);
}

// 3. A campaign costs money, lasts 120 days and boosts demand.
{
  const g = withTower();
  const m0 = g.money;
  assert.ok(runCampaign(g));
  assert.ok(g.money < m0 && marketingActive(g));
  assert.ok(!runCampaign(g), 'not while active');
  g.day = 130;
  assert.ok(!marketingActive(g));
}

// 4. A buyer appears, haggles and buys; direct sales reduce units left.
{
  const g = withTower();
  g.reputation = 80;
  let lead = null;
  for (let m = 1; m <= 12 && !lead; m++) { g.day = 30 * m; monthlyBuyers(g); lead = g.sales.leads.find((l) => !l.ended); }
  assert.ok(lead, 'a buyer appeared');
  const b = g.dev.buildings[0];
  const left0 = unitsLeft(b);
  const m0 = g.money;
  // counter at list price: succeeds if within their max, else haggle/accept their offer
  const res = counterBuyer(g, lead!, 1);
  if (res !== 'accepted') assert.ok(acceptBuyer(g, lead!));
  assert.equal(lead!.ended, 'bought');
  assert.ok(g.money > m0, 'got paid');
  assert.ok(unitsLeft(b) < left0, 'units reduced');
  console.log('buyer bought', lead!.units, 'unit(s)');
}

// 5. Round-trips through a save.
{
  const g = withTower();
  setPriceLevel(g, g.dev.buildings[0], 1.15);
  runCampaign(g);
  monthlyBuyers(g);
  const g2 = restore(JSON.parse(JSON.stringify(serialize(g, 'sample-kampung'))), map);
  assert.equal(priceLevel(g2.dev.buildings[0]), 1.15);
  assert.equal(marketingActive(g2), marketingActive(g));
  assert.equal(g2.sales.leads.length, g.sales.leads.length);
}

console.log('✔ sales test passed');
