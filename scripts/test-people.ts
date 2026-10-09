/** Milestone 9: helpers, group meetings, messages, chat rooms and portraits. */
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { World } from '../src/game/World.ts';
import { Game } from '../src/game/Game.ts';
import { askHelp, makeOffer, minimumPrice, neighborHelper, rtHeadFor, startVisit } from '../src/game/negotiation.ts';
import { meetingCandidates, offerAll, signAll, startMeeting, tally, listenAll, presentPlan, communityFund } from '../src/game/meeting.ts';
import { monthlyMessages, unreadCount, unreadRooms, markRead } from '../src/game/messages.ts';
import { restore, serialize } from '../src/game/save.ts';
import { dialogue } from '../src/i18n/dialogue.ts';
import { emotionForLine, portrait } from '../src/ui/portrait.ts';
import type { MapData } from '../src/shared/mapTypes.ts';

const map: MapData = JSON.parse(await readFile(new URL('../maps/sample-kampung.json', import.meta.url), 'utf8'));
const fresh = () => { const g = new Game(new World(map)); g.money *= 20; return g; };

// 1. A neighbour who sold puts in a good word: their face appears in the room and the price softens.
{
  const g = fresh();
  const w = g.world;
  const pair = w.owners.find((o) => o.kind === 'person' && !o.holdout && o.relations.some((r) => {
    const n = w.owner(r.ownerId)!;
    return r.kind !== 'rival' && n.kind === 'person' && !n.holdout && n.plotIds.length === 1;
  }))!;
  const friend = w.owner(pair.relations.find((r) => r.kind !== 'rival' && w.owner(r.ownerId)!.kind === 'person' && !w.owner(r.ownerId)!.holdout && w.owner(r.ownerId)!.plotIds.length === 1)!.ownerId)!;
  const s1 = startVisit(g, w.plot(friend.plotIds[0])!);
  assert.equal(makeOffer(g, s1, s1.value * 3, []), 'accepted');
  friend.mood = 80;
  assert.equal(neighborHelper(g, pair)?.id, friend.id);
  const s = startVisit(g, w.plot(pair.plotIds[0])!);
  const before = minimumPrice(g, pair, s.value);
  assert.equal(askHelp(g, s, 'neighbor'), 'helped');
  assert.ok(minimumPrice(g, pair, s.value) < before, 'price softens');
  assert.ok(g.record(pair.id).log.some((e) => e.by === friend.id), 'helper speaks in the room');
  assert.equal(askHelp(g, s, 'neighbor'), 'unavailable', 'only once per visit');
  console.log(`helper: min ${Math.round(before / 1e6)}M → ${Math.round(minimumPrice(g, pair, s.value) / 1e6)}M`);
}

// 2. The RT head refuses when they dislike you.
{
  const g = fresh();
  const o = g.world.owners.find((x) => x.kind === 'person' && !x.holdout && rtHeadFor(g, x))!;
  const rt = rtHeadFor(g, o)!;
  rt.mood = 10;
  const s = startVisit(g, g.world.plot(o.plotIds[0])!);
  assert.equal(askHelp(g, s, 'rt'), 'refused');
  rt.mood = 90;
  const s2 = { ...s, helped: [] as string[] };
  assert.equal(askHelp(g, s2, 'rt'), 'helped');
}

// 3. A group meeting: a generous offer makes most sign; signing pays and transfers the land.
{
  const g = fresh();
  const w = g.world;
  const seed = w.plots.find((p) => p.category === 'house' && p.neighbors.length >= 6)!;
  const ids = [seed.id, ...seed.neighbors];
  const owners = meetingCandidates(g, ids);
  assert.ok(owners.length >= 2);
  for (const o of owners) o.mood = Math.max(o.mood, 50);
  const m = startMeeting(g, ids)!;
  assert.ok(m && !m.ended, 'meeting starts');
  presentPlan(g, m);
  listenAll(g, m);
  assert.ok(communityFund(g, m));
  offerAll(g, m, 190, []);
  const tl = tally(m);
  assert.ok(tl.yes >= 1, `someone agrees (${JSON.stringify(tl)})`);
  const money0 = g.money;
  const sold0 = g.soldOwners.size;
  assert.ok(signAll(g, m));
  assert.ok(m.ended && m.outcome === 'sold');
  assert.equal(g.soldOwners.size, sold0 + tl.yes);
  assert.ok(g.money < money0);
  assert.ok(m.meeting.log.some((e) => e.by), 'attendees speak with their own faces');
  console.log(`meeting: ${owners.length} invited, ${JSON.stringify(tl)}`);

  // saves keep the meeting room
  const g2 = restore(JSON.parse(JSON.stringify(serialize(g, 'sample-kampung'))), map);
  assert.equal(g2.meetings.length, 1);
  assert.equal(g2.meetings[0].log.length, m.meeting.log.length);
}

// 4. A lowball to the whole room insults people and costs reputation.
{
  const g = fresh();
  const seed = g.world.plots.find((p) => p.category === 'house' && p.neighbors.length >= 6)!;
  const m = startMeeting(g, [seed.id, ...seed.neighbors])!;
  const rep0 = g.reputation;
  offerAll(g, m, 40, []);
  assert.equal(tally(m).yes, 0);
  assert.ok(g.reputation < rep0);
}

// 5. People message you between visits; unread badges count them.
{
  const g = fresh();
  const w = g.world;
  const needy = w.owners.filter((o) => o.kind === 'person' && !o.holdout && o.finances === 'needs_money').slice(0, 25);
  for (const o of needy) {
    const s = startVisit(g, w.plot(o.plotIds[0])!);
    makeOffer(g, s, Math.round(s.value * 0.75), []);
    markRead(g, o.id);
  }
  assert.equal(unreadRooms(g), 0);
  let got = 0;
  for (let month = 0; month < 6; month++) {
    g.day += 30;
    for (const o of needy) o.mood = 60;
    monthlyMessages(g);
    got = needy.filter((o) => unreadCount(g, o.id) > 0).length;
    if (got) break;
  }
  assert.ok(got > 0, 'someone reconsiders and writes');
  console.log(`messages: ${unreadRooms(g)} unread room(s)`);
}

// 6. Every dialogue key exists in both languages; portraits render for everyone and every emotion.
{
  for (const k of Object.keys(dialogue.en)) assert.ok(dialogue.id[k], `id dialogue missing ${k}`);
  const g = fresh();
  for (const o of g.world.owners.slice(0, 300)) {
    for (const e of ['neutral', 'happy', 'delighted', 'thinking', 'worried', 'sad', 'angry', 'surprised'] as const) {
      const svg = portrait(o, e, 40);
      assert.ok(!/undefined|NaN/.test(svg), `portrait for ${o.id}`);
    }
  }
  for (const k of ['accept.happy', 'offer.insult', 'counter.first', 'meet.yes', 'msg.reconsider', 'persuade.react.yes']) assert.ok(emotionForLine(k), k);
}

console.log('✔ people test passed');
