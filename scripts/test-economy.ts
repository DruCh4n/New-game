/** Economy, permits, promises, loans and save/load round trip. */
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { World } from '../src/game/World.ts';
import { Game } from '../src/game/Game.ts';
import { borrow, closeMonth, creditLimit, debt, loanRate, repay, PROMISE_DAYS } from '../src/game/Economy.ts';
import { restore, serialize } from '../src/game/save.ts';
import type { MapData } from '../src/shared/mapTypes.ts';
import type { BuildingTypeId } from '../src/game/catalog.ts';

const map: MapData = JSON.parse(await readFile(new URL('../maps/sample-kampung.json', import.meta.url), 'utf8'));

/** Buys and clears a block, returns a game ready to build. */
function setup() {
  const g = new Game(new World(map));
  g.money = 1e14;
  const w = g.world;
  const centre = w.plots.find((p) => p.category === 'house' && p.road?.kind === 'residential' && p.road.distance < 3 && Math.hypot(p.cx - 100, p.cy - 120) < 80)!;
  const block = w.plots.filter((p) => Math.hypot(p.cx - centre.cx, p.cy - centre.cy) < 55 && w.ownerOf(p).kind !== 'state');
  g.setStatus(block.map((p) => p.id), 'sold');
  for (const o of new Set(block.map((p) => p.ownerId))) g.soldOwners.add(o);
  for (const p of block) if (p.kind === 'building') g.demolish(p);
  for (let i = 0; i < 31; i++) g.dev.advanceDay();
  return { g, centre };
}

function place(g: Game, type: BuildingTypeId, near: { cx: number; cy: number }) {
  for (let r = 0; r < 60; r += 2) for (let a = 0; a < 6.28; a += 0.3) {
    const x = Math.round((near.cx + Math.cos(a) * r) * 2) / 2, y = Math.round((near.cy + Math.sin(a) * r) * 2) / 2;
    const ang = g.dev.roadAngle(x, y) ?? 0;
    if (g.placeBuilding(type, x, y, ang).ok) return g.dev.buildings[g.dev.buildings.length - 1];
  }
  throw new Error(`could not place ${type}`);
}

// 1. Permits: a tower waits for its permit; a poor reputation is refused.
{
  const { g, centre } = setup();
  g.reputation = 20;
  assert.equal(g.permitDays('apartment'), null);
  g.reputation = 60;
  const b = place(g, 'apartment', centre);
  assert.ok(b.permitDays > 0, 'permit wait');
  const d0 = b.daysLeft;
  g.dev.advanceDay();
  assert.equal(b.daysLeft, d0, 'no construction while waiting for the permit');
  assert.equal(g.permitDays('house'), 0, 'houses need no permit');
}

// 2. Promises are kept when the tower opens; units are reserved; reputation rises.
{
  const { g, centre } = setup();
  g.obligations.push({ ownerId: 'o_x1', kind: 'apartment', day: 0 }, { ownerId: 'o_x2', kind: 'apartment', day: 0 }, { ownerId: 'o_x3', kind: 'shop', day: 0 });
  const b = place(g, 'apartment', centre);
  const rep0 = g.reputation;
  const total = b.permitDays + b.daysLeft + 2;
  for (let i = 0; i < total; i++) g.advanceDay();
  assert.equal(b.daysLeft, 0);
  assert.equal(b.reserved, 2);
  assert.equal(g.obligations.filter((o) => o.fulfilled !== undefined).length, 2);
  assert.ok(g.reputation >= rep0 + 2);
  // the shop promise is broken after two years without a mall or ruko
  g.day = PROMISE_DAYS + 5;
  closeMonth(g);
  assert.ok(g.obligations.find((o) => o.kind === 'shop')!.broken);
  // a sales tower sells units month by month
  const before = b.unitsSold;
  closeMonth(g);
  assert.ok(b.unitsSold > before, 'apartments sell');
}

// 3. Rentals fill up over months and pay; old houses you own pay a little rent; land tax is charged.
{
  const { g, centre } = setup();
  const b = place(g, 'house', centre);
  const days = b.daysLeft + 1;
  for (let i = 0; i < days; i++) g.dev.advanceDay();
  const r1 = closeMonth(g);
  const r2 = closeMonth(g);
  assert.ok(r1.income.rent > 0 && r2.income.rent >= r1.income.rent, 'rent ramps up');
  assert.ok(r1.costs.tax > 0, 'land tax');
}

// 4. Loans: limited by collateral, interest charged monthly, repayable.
{
  const g = new Game(new World(map));
  const limit = creditLimit(g);
  assert.ok(limit > 0, 'small unsecured line');
  assert.equal(borrow(g, limit * 2), null, 'cannot exceed the limit');
  const m0 = g.money;
  const loan = borrow(g, limit)!;
  assert.ok(g.money > m0);
  assert.equal(loan.rate, loanRate(g));
  const r = closeMonth(g);
  assert.ok(Math.abs(r.costs.interest - (loan.principal * loan.rate) / 12) < 2);
  repay(g, loan.id, loan.principal);
  assert.equal(debt(g), 0);
  g.reputation = 10;
  assert.ok(loanRate(g) > 0.1, 'bad reputation, expensive money');
}

// 5. Save → load reproduces the game exactly.
{
  const { g, centre } = setup();
  place(g, 'park', centre);
  g.dev.buildRoad([centre.cx - 10, centre.cy - 10, centre.cx + 10, centre.cy - 10], 'gang', g.dev.roadCheck([centre.cx - 10, centre.cy - 10, centre.cx + 10, centre.cy - 10], 'gang'));
  borrow(g, creditLimit(g) / 2);
  g.world.owners[10].mood = 17.5;
  for (let i = 0; i < 40; i++) g.advanceDay();
  const s1 = serialize(g, 'sample-kampung');
  const json = JSON.stringify(s1);
  const g2 = restore(JSON.parse(json), map);
  const s2 = serialize(g2, 'sample-kampung');
  s2.savedAt = s1.savedAt;
  assert.deepEqual(s2, s1, 'round trip');
  assert.deepEqual(g2.dev.grid.flags, g.dev.grid.flags, 'land grid restored');
  console.log(`save size ${(json.length / 1024).toFixed(0)} KB`);
}

console.log('✔ economy test passed');
