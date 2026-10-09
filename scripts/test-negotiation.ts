/** Simulated negotiations on the sample map: checks the rules behave as designed. */
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { World } from '../src/game/World.ts';
import { Game } from '../src/game/Game.ts';
import {
  acceptCounter, giveGift, listen, makeOffer, minimumPrice, neighborsSoldShare, optionWeights, preferredOption, pressure, startVisit,
} from '../src/game/negotiation.ts';
import type { MapData } from '../src/shared/mapTypes.ts';
import { dialogue } from '../src/i18n/dialogue.ts';
import { Rng } from '../src/util/random.ts';
import { leave } from '../src/game/negotiation.ts';

const map: MapData = JSON.parse(await readFile(new URL('../maps/sample-kampung.json', import.meta.url), 'utf8'));
const fresh = () => new Game(new World(map));
const houses = (g: Game) => g.world.plots.filter((p) => p.category === 'house' && g.world.ownerOf(p).kind === 'person' && g.world.ownerOf(p).plotIds.length === 1);

// 1. Holdouts never sell, whatever the offer.
{
  const g = fresh();
  const p = houses(g).find((p) => g.world.ownerOf(p).holdout)!;
  const s = startVisit(g, p);
  assert.equal(makeOffer(g, s, s.value * 5, ['apartment', 'relocation']), 'refused');
  assert.equal(g.world.statusOf(p.id), 'refused');
}

// 2. A generous offer is accepted; money is paid; reputation rises.
{
  const g = fresh();
  const p = houses(g).find((p) => !g.world.ownerOf(p).holdout)!;
  const money0 = g.money, rep0 = g.reputation;
  const s = startVisit(g, p);
  assert.equal(makeOffer(g, s, Math.round(s.value * 3), []), 'accepted');
  assert.equal(g.world.statusOf(p.id), 'sold');
  assert.ok(g.money < money0);
  assert.ok(g.reputation > rep0);
}

// 3. Lowballing insults, costs reputation, and sours the neighbours.
{
  const g = fresh();
  const p = houses(g).find((p) => !g.world.ownerOf(p).holdout && g.world.ownerOf(p).relations.length >= 2)!;
  const o = g.world.ownerOf(p);
  const friend = g.world.owner(o.relations[0].ownerId)!;
  const mood0 = friend.mood, rep0 = g.reputation;
  const s = startVisit(g, p);
  assert.equal(makeOffer(g, s, s.value * 0.2, []), 'insulted');
  assert.ok(g.reputation < rep0, 'reputation drops');
  assert.ok(friend.mood < mood0, 'word spreads');
}

// 4. Counter-offers converge and accepting the counter closes the deal.
{
  const g = fresh();
  g.money = 1e15;
  let tested = 0;
  for (const p of houses(g)) {
    const o = g.world.ownerOf(p);
    if (o.holdout || g.world.statusOf(p.id) !== 'not_approached') continue;
    const s = startVisit(g, p);
    const min = minimumPrice(g, o, s.value);
    const r = makeOffer(g, s, min * 0.85, []);
    if (r !== 'countered') continue;
    const ask1 = s.askCash!;
    assert.ok(ask1 >= min * 0.99, 'ask is at least the minimum');
    const r2 = makeOffer(g, s, min * 0.9, []);
    if (r2 === 'countered') assert.ok(s.askCash! <= ask1, 'second ask is not higher');
    if (!s.ended) assert.equal(acceptCounter(g, s), 'accepted');
    if (++tested >= 20) break;
  }
  assert.ok(tested >= 10, `tested ${tested} counter-offer negotiations`);
}

// 5. Neighbours selling lowers the minimum price.
{
  const g = fresh();
  const p = houses(g).find((p) => !g.world.ownerOf(p).holdout && g.world.ownerOf(p).relations.length >= 3)!;
  const o = g.world.ownerOf(p);
  const before = minimumPrice(g, o, p.value);
  for (const r of o.relations) g.soldOwners.add(r.ownerId);
  assert.equal(neighborsSoldShare(g, o).share, 1);
  const after = minimumPrice(g, o, p.value);
  assert.ok(after < before * 0.85, `min price ${before} → ${after}`);
}

// 6. Deal options: a shopkeeper values a shop unit; listening reveals preferences and lifts mood.
{
  const g = fresh();
  const p = g.world.plots.find((p) => p.category === 'shophouse' && g.world.ownerOf(p).kind === 'person' && !g.world.ownerOf(p).holdout)!;
  const o = g.world.ownerOf(p);
  assert.ok(optionWeights(g, o).shop >= 2, 'shop owners love shop units');
  const s = startVisit(g, p);
  const mood0 = o.mood;
  listen(g, s);
  assert.ok(o.mood > mood0);
  assert.equal(g.record(o.id).knownPreference, preferredOption(g, o));
  giveGift(g, s);
  assert.ok(o.mood >= mood0 + 10);
}

// 7. Pressure always costs reputation.
{
  const g = fresh();
  const p = houses(g).find((p) => !g.world.ownerOf(p).holdout)!;
  const rep0 = g.reputation;
  const s = startVisit(g, p);
  pressure(g, s);
  assert.ok(g.reputation <= rep0 - 4);
}

// 8. Determinism: same actions → same log.
{
  const run = () => {
    const g = fresh();
    const p = houses(g)[5];
    const s = startVisit(g, p);
    makeOffer(g, s, p.value * 0.9, ['moving']);
    makeOffer(g, s, p.value * 1.0, ['moving']);
    return JSON.stringify(g.record(p.ownerId).log);
  };
  assert.equal(run(), run());
}

// 9. Time: moods recover; minimum price drifts.
{
  const g = fresh();
  const o = g.world.ownerOf(houses(g)[0]);
  o.mood = 20;
  const m0 = minimumPrice(g, o, 1e9);
  for (let i = 0; i < 10; i++) g.advanceDay();
  assert.equal(o.mood, 30);
  assert.notEqual(minimumPrice(g, o, 1e9), m0);
}

// 10. Random play: 600 conversations with random actions never crash, and every line exists in both languages.
{
  const g = fresh();
  g.money = 1e15;
  const rng = new Rng(7);
  const plots = g.world.plots;
  for (let i = 0; i < 600; i++) {
    const p = rng.pick(plots);
    const s = startVisit(g, p);
    for (let k = 0; k < 8 && !s.ended; k++) {
      const a = rng.int(0, 5);
      if (a <= 1) makeOffer(g, s, s.value * rng.range(0.2, 2.2), ['moving', 'relocation', 'apartment', 'shop'].filter(() => rng.chance(0.3)) as never);
      else if (a === 2 && s.askCash !== null) acceptCounter(g, s);
      else if (a === 3) listen(g, s);
      else if (a === 4) giveGift(g, s);
      else if (rng.chance(0.3)) pressure(g, s);
    }
    if (!s.ended) leave(g, s);
    if (i % 20 === 0) g.advanceDay();
  }
  const keys = new Set([...g.records.values()].flatMap((r) => r.log.map((e) => e.key)));
  for (const k of keys) {
    assert.ok(dialogue.en[k], `en dialogue has ${k}`);
    assert.ok(dialogue.id[k], `id dialogue has ${k}`);
  }
  console.log(`random play: ${keys.size} distinct line types, reputation ${g.reputation}, sold ${g.soldOwners.size}`);
}

// Stats: how many first offers at 100% of market value are accepted?
{
  const g = fresh();
  let acc = 0, n = 0;
  for (const p of houses(g).slice(0, 400)) {
    const s = startVisit(g, p);
    if (s.ended) continue;
    n++;
    if (makeOffer(g, s, p.value, []) === 'accepted') acc++;
    g.money = 1e15;
  }
  const f = g.world.owners.filter((o) => o.kind === 'person' && !o.holdout).map((o) => o.minFactor).sort((a, b) => a - b);
  console.log('minFactor p10/p50/p90', f[Math.floor(f.length * 0.1)], f[Math.floor(f.length / 2)], f[Math.floor(f.length * 0.9)]);
  console.log(`offers at market value accepted: ${acc}/${n} (${((acc / n) * 100).toFixed(0)}%)`);
}
console.log('✔ negotiation test passed');
