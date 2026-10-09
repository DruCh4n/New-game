/**
 * People message you between visits: someone short of money reconsiders, a neighbour gets curious,
 * a former owner asks about a promise. Checked once a month.
 */
import { Rng, hashString } from '../util/random';
import type { Game } from './Game';
import type { Owner } from './types';
import { neighborsSoldShare } from './negotiation';

const MAX_PER_MONTH = 4;

const lastContact = (game: Game, id: string) => {
  const log = game.records.get(id)?.log;
  return log?.length ? log[log.length - 1].day : -999;
};

const unsold = (game: Game, o: Owner) => o.plotIds.some((id) => !game.ownsPlot(id));

export function monthlyMessages(game: Game) {
  const rng = new Rng(hashString(`msg|${game.day}|${game.world.seed}`));
  const w = game.world;
  let sent = 0;
  const send = (o: Owner, key: string, params?: Record<string, string | number>) => {
    const rec = game.record(o.id);
    rec.log.push({ day: game.day, who: 'owner', key, v: rng.int(0, 9999), ...(params ? { params } : {}) });
    game.toast({ kind: 'info', key: 'toast.message', params: { ownerId: o.id } });
    sent++;
  };

  // people you have talked to
  for (const [id, rec] of game.records) {
    if (sent >= MAX_PER_MONTH) break;
    const o = w.owner(id);
    if (!o || o.kind !== 'person' || !rec.visits) continue;
    const quiet = game.day - lastContact(game, id);
    if (quiet < 25) continue;
    if (game.soldOwners.has(id)) {
      const waiting = game.obligations.find((ob) => ob.ownerId === id && !ob.fulfilled && !ob.broken && game.day - ob.day > 300);
      if (waiting && rng.chance(0.25)) {
        send(o, `msg.promise.${waiting.kind}`);
        game.changeMood(o, -4);
      }
      continue;
    }
    if (o.holdout || rec.finalRefusal || !unsold(game, o)) continue;
    if (rec.insults > 0 && o.mood < 30) {
      if (rng.chance(0.1)) send(o, 'msg.angry');
      continue;
    }
    if (o.finances === 'needs_money' && o.mood >= 30 && rng.chance(0.18)) {
      send(o, 'msg.reconsider');
      rec.cooldownUntil = Math.min(rec.cooldownUntil, game.day);
      rec.pressureDiscount = Math.min(0.25, rec.pressureDiscount + 0.06);
      continue;
    }
    if (neighborsSoldShare(game, o).share > 0.5 && rng.chance(0.15)) {
      send(o, 'msg.lastOne');
      rec.cooldownUntil = Math.min(rec.cooldownUntil, game.day);
      game.changeMood(o, 6);
    }
  }

  // strangers next to your land get curious
  if (sent < MAX_PER_MONTH && game.soldOwners.size) {
    let curious = 0;
    const candidates = new Set<string>();
    for (const sid of game.soldOwners) {
      const so = w.owner(sid);
      for (const r of so?.relations ?? []) candidates.add(r.ownerId);
    }
    for (const id of candidates) {
      if (curious >= 2 || sent >= MAX_PER_MONTH) break;
      const o = w.owner(id);
      if (!o || o.kind !== 'person' || o.holdout || game.soldOwners.has(id) || game.records.get(id)?.visits) continue;
      if (o.mood < 50 || !unsold(game, o)) continue;
      if (!rng.chance(0.04 + (o.finances === 'needs_money' ? 0.05 : 0) + (o.stories.some((s) => s.key === 'wantsMove') ? 0.08 : 0))) continue;
      send(o, 'msg.curious');
      game.changeMood(o, 3);
      curious++;
    }
  }
}

/** Unread entries in an owner's room. */
export function unreadCount(game: Game, ownerId: string): number {
  const rec = game.records.get(ownerId);
  if (!rec) return 0;
  return rec.log.slice(rec.read ?? 0).filter((e) => e.who === 'owner').length;
}

export function markRead(game: Game, ownerId: string) {
  const rec = game.records.get(ownerId);
  if (rec) rec.read = rec.log.length;
}

/** Rooms with something new. */
export function unreadRooms(game: Game): number {
  let n = 0;
  for (const id of game.records.keys()) if (unreadCount(game, id)) n++;
  return n;
}
