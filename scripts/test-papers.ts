/** Milestone 10: land papers, registration, legal routes, officials. */
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { World } from '../src/game/World.ts';
import { Game } from '../src/game/Game.ts';
import { makeOffer, startVisit } from '../src/game/negotiation.ts';
import {
  OFFICIALS, checkPapers, legalRoutes, officialOwnerId, paperOf, papersKnown, requestService, serviceActive, startRoute, type PaperKind,
} from '../src/game/papers.ts';
import { restore, serialize } from '../src/game/save.ts';
import { dialogue } from '../src/i18n/dialogue.ts';
import type { MapData } from '../src/shared/mapTypes.ts';

const map: MapData = JSON.parse(await readFile(new URL('../maps/sample-kampung.json', import.meta.url), 'utf8'));
const fresh = () => { const g = new Game(new World(map)); g.money *= 20; return g; };
const persons = (g: Game, k: PaperKind) => g.world.plots.filter((p) => {
  const o = g.world.ownerOf(p);
  return o.kind === 'person' && !o.holdout && o.plotIds.length === 1 && p.kind === 'building' && paperOf(g.world, p) === k;
});

// 1. Paper mix is plausible and deterministic.
{
  const g = fresh(), g2 = fresh();
  const counts: Record<string, number> = {};
  for (const p of g.world.plots) { const k = paperOf(g.world, p); counts[k] = (counts[k] ?? 0) + 1; assert.equal(k, paperOf(g2.world, p)); }
  const n = g.world.plots.length;
  assert.ok(counts.shm / n > 0.35 && counts.shm / n < 0.8, `shm share ${counts.shm / n}`);
  for (const k of ['girik', 'ajb', 'heirs', 'none', 'double']) assert.ok(counts[k] > 0, k);
  console.log('papers:', JSON.stringify(counts));
}

// 2. Checking costs money and reveals the papers.
{
  const g = fresh();
  const p = persons(g, 'girik')[0];
  assert.ok(!papersKnown(g, p));
  const m0 = g.money;
  assert.ok(checkPapers(g, p));
  assert.ok(papersKnown(g, p) && g.money < m0);
}

// 3. Buying girik land starts registration; building there is blocked until it's done.
{
  const g = fresh();
  const p = persons(g, 'girik').find((x) => x.area > 200) ?? persons(g, 'girik')[0];
  const s = startVisit(g, p);
  assert.equal(makeOffer(g, s, s.value * 3, []), 'accepted');
  assert.ok(g.papers.registering.has(p.id));
  assert.ok(g.dev.paperBlock!(p.index));
  for (let i = 0; i < 61; i++) g.advanceDay();
  assert.ok(!g.papers.registering.has(p.id), 'registration finishes');
  assert.ok(!g.dev.paperBlock!(p.index));
}

// 4. An inheritance dispute blocks a sale until a notary mediates.
{
  const g = fresh();
  const p = persons(g, 'heirs')[0];
  const s = startVisit(g, p);
  assert.notEqual(makeOffer(g, s, s.value * 3, []), 'accepted', 'heirs must agree first');
  assert.ok(g.record(p.ownerId).log.some((e) => e.key === 'papers.heirs'));
  const route = legalRoutes(g, p).find((r) => r.kind === 'mediation')!;
  assert.ok(route);
  assert.ok(startRoute(g, p, 'mediation'));
  for (let i = 0; i < 15; i++) g.advanceDay();
  assert.ok(g.papers.heirsOk.has(p.ownerId));
  g.record(p.ownerId).cooldownUntil = 0;
  g.world.ownerOf(p).mood = 60;
  const s2 = startVisit(g, p);
  assert.equal(makeOffer(g, s2, s2.value * 3, []), 'accepted');
}

// 5. Land without papers can be cleared by the city (costly in reputation).
{
  const g = fresh();
  const p = persons(g, 'none')[0];
  checkPapers(g, p);
  const rep0 = g.reputation;
  assert.ok(startRoute(g, p, 'eviction'));
  assert.ok(g.reputation < rep0);
  for (let i = 0; i < 31; i++) g.advanceDay();
  assert.ok(g.ownsPlot(p.id), 'cleared land is yours');
  assert.ok(g.papers.news.some((n) => n.key === 'news.eviction'));
}

// 6. Court cases resolve one way or the other; full certificates can't be contested.
{
  const g = fresh();
  assert.equal(legalRoutes(g, persons(g, 'shm')[0]).length, 0);
  let won = 0, lost = 0;
  for (const p of persons(g, 'girik').slice(0, 12)) {
    if (startRoute(g, p, 'court')) { /* started */ }
  }
  for (let i = 0; i < 121; i++) g.advanceDay();
  for (const n of g.papers.news) { if (n.key === 'news.courtWin') won++; if (n.key === 'news.courtLose') lost++; }
  assert.ok(won + lost >= 10, `verdicts ${won}/${lost}`);
  console.log(`court: ${won} won, ${lost} lost`);
}

// 7. Officials: services, rooms and saves.
{
  const g = fresh();
  for (const c of OFFICIALS) assert.ok(g.world.owner(officialOwnerId(c)), c);
  const before = g.permitDays('apartment')!;
  assert.ok(requestService(g, 'camat'));
  assert.ok(serviceActive(g, 'camat'));
  assert.ok(g.permitDays('apartment')! < before);
  assert.ok(requestService(g, 'bpn'));
  assert.ok(papersKnown(g, g.world.plots[5]));
  assert.ok(!requestService(g, 'bpn'), 'not twice while active');
  const g2 = restore(JSON.parse(JSON.stringify(serialize(g, 'sample-kampung'))), map);
  assert.ok(serviceActive(g2, 'camat') && serviceActive(g2, 'bpn'));
  assert.equal(g2.record(officialOwnerId('camat')).log.length, g.record(officialOwnerId('camat')).log.length);
}

for (const k of Object.keys(dialogue.en)) assert.ok(dialogue.id[k], `id dialogue missing ${k}`);
console.log('✔ papers test passed');
