/**
 * The negotiation engine. Pure game logic (no DOM) so it can be tested in Node.
 *
 * Each owner has a hidden minimum price:
 *   value × minFactor (+ expectations − pressure) × mood × reputation × neighbours-sold × time drift
 * Offers are judged on *perceived* value: cash + each deal option's cost × how much this owner cares about it.
 */
import { Rng, hashString } from '../util/random';
import type { Game } from './Game';
import type { Owner, Plot, RelationKind } from './types';
import { afterPurchase, heirsBlock } from './papers';

export type DealOption = 'moving' | 'relocation' | 'apartment' | 'shop';
export const DEAL_OPTIONS: DealOption[] = ['moving', 'relocation', 'apartment', 'shop'];
/** Paid at signing; the others are promises fulfilled when you build. */
export const IMMEDIATE_OPTIONS: DealOption[] = ['moving', 'relocation'];

export interface LogEntry {
  day: number;
  who: 'owner' | 'player' | 'system';
  key: string;
  params?: Record<string, string | number>;
  /** Random variant index; the text table picks variants[v % n]. */
  v?: number;
  opts?: DealOption[];
  /** Someone else speaking in this room (a neighbour helping out, or a meeting attendee). */
  by?: string;
}

export interface Session {
  ownerId: string;
  plotIds: string[];
  /** Market value of everything in the deal. */
  value: number;
  patience: number;
  round: number;
  /** Owner's current asking price in perceived-value terms, and the matching cash amount. */
  ask: number | null;
  askCash: number | null;
  askOptions: DealOption[];
  listened: boolean;
  gifted: boolean;
  pressured: boolean;
  liked: Set<DealOption>;
  /** One extra round is allowed after patience runs out while they're countering. */
  graceUsed: boolean;
  /** Helpers already asked during this visit (owner ids). */
  helped?: string[];
  ended: boolean;
  outcome?: 'sold' | 'left' | 'tired' | 'angry' | 'refused' | 'closed';
}

export type OfferResult = 'accepted' | 'countered' | 'low' | 'insulted' | 'refused' | 'ended' | 'invalid';

const SHOP_JOBS = new Set(['warung', 'shopkeeper', 'trader', 'restaurateur', 'tailor', 'laundry', 'mechanic', 'pharmacist']);

// ------------------------------------------------------------------ helpers

const has = (o: Owner, story: string) => o.stories.some((s) => s.key === story);

function rngFor(game: Game, o: Owner, tag: string, round = 0) {
  return new Rng(hashString(`${o.id}|${game.day}|${round}|${tag}|${game.world.seed}`));
}

function say(game: Game, o: Owner, key: string, params?: LogEntry['params'], round = 0) {
  const v = rngFor(game, o, key, round).int(0, 9999);
  game.record(o.id).log.push({ day: game.day, who: 'owner', key, params, v });
}

function act(game: Game, o: Owner, key: string, params?: LogEntry['params'], opts?: DealOption[]) {
  game.record(o.id).log.push({ day: game.day, who: 'player', key, params, opts });
}

function note(game: Game, o: Owner, key: string, params?: LogEntry['params']) {
  game.record(o.id).log.push({ day: game.day, who: 'system', key, params });
}

/** Which plots a deal covers: everything a private owner still holds; a single parcel for state land. */
export function dealScope(game: Game, plot: Plot): string[] {
  const o = game.world.ownerOf(plot);
  if (o.kind === 'state') return [plot.id];
  return o.plotIds.filter((id) => !game.ownsPlot(id));
}

export function scopeValue(game: Game, plotIds: string[]): number {
  return plotIds.reduce((a, id) => a + game.world.plot(id)!.value, 0);
}

/** How much the owner values each option, as a multiple of what it costs you. */
export function optionWeights(game: Game, o: Owner): Record<DealOption, number> {
  if (o.kind === 'state') return { moving: 0, relocation: 0, apartment: 0, shop: 0 };
  if (o.kind !== 'person') {
    const shop = o.kind === 'company' ? 0.8 : 0.3;
    return { moving: 0.3, relocation: 0.2, apartment: 0.2, shop };
  }
  const age = o.age ?? 40;
  const ownsShop = o.plotIds.some((id) => ['shophouse', 'shop'].includes(game.world.plot(id)!.category));
  const w: Record<DealOption, number> = {
    moving: 0.9 + (o.finances === 'needs_money' ? 0.8 : 0) + (o.familySize >= 5 ? 0.4 : 0),
    relocation: 0.6 + (age > 60 ? 1.2 : 0) + (has(o, 'elderParent') ? 0.8 : 0) + (has(o, 'kidsSchool') ? 0.6 : 0) +
      (o.attachment > 60 ? 0.4 : 0) - (has(o, 'wantsMove') ? 0.3 : 0),
    apartment: 0.5 + (o.attachment > 55 ? 0.9 : 0) + (has(o, 'kidsSchool') ? 0.5 : 0) + (o.familySize >= 4 ? 0.3 : 0) -
      (has(o, 'elderParent') ? 0.5 : 0) - (has(o, 'wantsMove') ? 0.4 : 0) - (o.finances === 'wealthy' ? 0.3 : 0) -
      (o.occupation === 'landlord' ? 0.3 : 0),
    shop: SHOP_JOBS.has(o.occupation ?? '') || ownsShop ? 2.2 + (has(o, 'warung') ? 0.4 : 0) : 0.25,
  };
  for (const k of DEAL_OPTIONS) w[k] = Math.max(0.05, Math.round(w[k] * 100) / 100);
  return w;
}

/** What the owner would most like besides cash (revealed by listening). */
export function preferredOption(game: Game, o: Owner): DealOption | 'cash' {
  const w = optionWeights(game, o);
  let best: DealOption | 'cash' = 'cash';
  let bestW = 1.25;
  for (const k of DEAL_OPTIONS) if (w[k] > bestW) { best = k; bestW = w[k]; }
  return best;
}

/** Cost of an option to you. */
export function optionCost(game: Game, opt: DealOption, value: number): number {
  const r = game.world.region;
  const round = (v: number) => Math.max(r.priceStep, Math.round(v / r.priceStep) * r.priceStep);
  switch (opt) {
    case 'moving': return round(Math.min(value * 0.02, r.buildPerM2 * 15));
    case 'relocation': return round(value * 0.05);
    case 'apartment': return round(r.buildPerM2 * 54); // ~45 m² unit
    case 'shop': return round(r.buildPerM2 * 60); // ~30 m² unit over two floors
  }
}

export function perceivedValue(game: Game, o: Owner, value: number, cash: number, opts: DealOption[]): number {
  const w = optionWeights(game, o);
  return cash + opts.reduce((a, k) => a + optionCost(game, k, value) * w[k], 0);
}

export function immediateCost(game: Game, value: number, cash: number, opts: DealOption[]): number {
  return cash + opts.filter((k) => IMMEDIATE_OPTIONS.includes(k)).reduce((a, k) => a + optionCost(game, k, value), 0);
}

const REL_WEIGHT: Record<RelationKind, number> = { family: 2, friend: 1.5, neutral: 1, rival: 0.4 };

/** Weighted share (0..1) of an owner's neighbours who already sold to you. */
export function neighborsSoldShare(game: Game, o: Owner): { share: number; example?: Owner } {
  let total = 0, sold = 0;
  let example: Owner | undefined;
  for (const r of o.relations) {
    const n = game.world.owner(r.ownerId);
    if (!n) continue;
    const w = REL_WEIGHT[r.kind] * (has(n, 'rtHead') ? 3 : 1);
    total += w;
    if (game.soldOwners.has(n.id)) {
      sold += w;
      if (!example || r.kind === 'family' || r.kind === 'friend') example = n;
    }
  }
  return { share: total ? sold / total : 0, example };
}

/** The hidden minimum price right now. Infinity for holdouts. */
export function minimumPrice(game: Game, o: Owner, value: number): number {
  if (o.holdout) return Infinity;
  const rec = game.record(o.id);
  if (o.kind === 'state') return value * 1.1 * (game.reputation < 40 ? 1.25 : 1);
  const base = Math.max(0.6, o.minFactor + rec.expectationBoost - rec.pressureDiscount - (rec.persuadeDiscount ?? 0) + game.difficulty.ownerPriceOffset);
  const mood = o.mood >= 50 ? 1 - (o.mood - 50) * 0.0016 : 1 + (50 - o.mood) * 0.005;
  const rep = game.reputation >= 50 ? 1 - (game.reputation - 50) * 0.0014 : 1 + (50 - game.reputation) * 0.004;
  const neighbors = 1 - 0.2 * neighborsSoldShare(game, o).share;
  const ph = (hashString(o.id) % 1000) / 159;
  const drift = 1 + 0.05 * Math.sin(game.day / 17 + ph) + 0.03 * Math.sin(game.day / 41 + ph * 2);
  return value * base * mood * rep * neighbors * drift;
}

/** Word spreads: neighbours' mood drops after insults or pressure. */
function spreadWord(game: Game, o: Owner, neutral: number, close: number) {
  for (const r of o.relations) {
    const n = game.world.owner(r.ownerId);
    if (!n || r.kind === 'rival') continue;
    game.changeMood(n, -(r.kind === 'neutral' ? neutral : close));
  }
}

function moodKey(o: Owner) {
  return o.mood >= 65 ? 'warm' : o.mood < 35 ? 'cold' : 'neutral';
}

// ------------------------------------------------------------------ actions

export type VisitBlock = 'cooldown' | 'angry' | 'sold' | null;

export function canVisit(game: Game, plot: Plot): { block: VisitBlock; days?: number } {
  const o = game.world.ownerOf(plot);
  if (dealScope(game, plot).length === 0) return { block: 'sold' };
  const rec = game.record(o.id);
  if (game.day < rec.cooldownUntil) return { block: o.mood < 12 ? 'angry' : 'cooldown', days: rec.cooldownUntil - game.day };
  return { block: null };
}

export function startVisit(game: Game, plot: Plot): Session {
  const o = game.world.ownerOf(plot);
  const rec = game.record(o.id);
  const plotIds = dealScope(game, plot);
  const s: Session = {
    ownerId: o.id, plotIds, value: scopeValue(game, plotIds), patience: 0, round: 0, ask: null, askCash: null,
    askOptions: [], listened: false, gifted: false, pressured: false, liked: new Set(), graceUsed: false, ended: false,
  };
  game.session = s;
  const check = canVisit(game, plot);
  if (check.block) {
    say(game, o, check.block === 'angry' ? 'refuse.angry' : 'refuse.wontMeet', { days: check.days ?? 1 });
    end(game, s, 'closed');
    return s;
  }
  rec.visits++;
  note(game, o, 'system.visit', { n: rec.visits });
  if (o.mood < 12) {
    say(game, o, 'refuse.angry');
    rec.cooldownUntil = game.day + 14;
    game.setStatus(plotIds, 'refused');
    end(game, s, 'angry');
    return s;
  }
  game.setStatus(plotIds, rec.finalRefusal ? 'refused' : 'negotiating');

  if (o.kind === 'state') say(game, o, 'greet.state');
  else if (o.kind === 'company') say(game, o, 'greet.company');
  else if (o.kind === 'institution') say(game, o, 'greet.institution');
  else say(game, o, rec.visits > 1 ? `greet.again.${moodKey(o)}` : `greet.${moodKey(o)}`);

  if (o.kind === 'person') {
    const { share, example } = neighborsSoldShare(game, o);
    if (example) say(game, o, share > 0.5 ? 'remark.manySold' : 'remark.neighborSold', { neighbor: example.name });
    if (rec.expectationBoost > 0.05) say(game, o, 'remark.rumorGenerous');
    if (game.reputation < 30) say(game, o, 'remark.lowRep');
    else if (game.reputation > 75) say(game, o, 'remark.highRep');
  }
  s.patience = o.kind === 'state' ? 3 : 2 + Math.round((100 - o.greed) / 40) + (o.mood > 60 ? 1 : 0);
  return s;
}

export function makeOffer(game: Game, s: Session, cash: number, opts: DealOption[]): OfferResult {
  if (s.ended) return 'ended';
  const o = game.world.owner(s.ownerId)!;
  const rec = game.record(o.id);
  const region = game.world.region;
  cash = Math.max(region.priceStep, Math.round(cash / region.priceStep) * region.priceStep);
  if (immediateCost(game, s.value, cash, opts) > game.money) return 'invalid';
  s.round++;
  act(game, o, 'player.offer', { cash }, opts);
  rec.lastOffer = cash;
  const firstPlot = game.world.plot(s.plotIds[0])!;

  // Places that are never for sale
  if (o.kind === 'state' && firstPlot.category === 'park') {
    say(game, o, 'refuse.park', undefined, s.round);
    return finishRefusal(game, s, o);
  }
  if (o.holdout) {
    say(game, o, o.kind === 'institution' ? 'refuse.institution' : 'refuse.holdout', undefined, s.round);
    rec.finalRefusal = true;
    return finishRefusal(game, s, o);
  }
  if (o.kind === 'state') return stateOffer(game, s, o, cash);
  if (heirsBlock(game, o)) {
    say(game, o, 'papers.heirs', undefined, s.round);
    game.papers.checked.add(firstPlot.id);
    return afterRound(game, s, o, 'low');
  }

  const perceived = perceivedValue(game, o, s.value, cash, opts);
  const min = minimumPrice(game, o, s.value);
  const w = optionWeights(game, o);
  for (const k of opts) {
    if (s.liked.has(k)) continue;
    s.liked.add(k);
    if (w[k] >= 1.3) { say(game, o, `option.like.${k}`, undefined, s.round); game.changeMood(o, 3); }
    else if (w[k] < 0.5) say(game, o, `option.dislike.${k}`, undefined, s.round);
  }

  if (perceived >= min || (s.ask !== null && perceived >= s.ask * 0.97)) {
    closeDeal(game, s, o, cash, opts);
    return 'accepted';
  }

  const ratio = perceived / min;
  let result: OfferResult;
  if (ratio >= 0.72) {
    const ask = s.ask === null
      ? min * (1.06 + o.greed * 0.0015)
      : Math.max(min, s.ask - (s.ask - min) * 0.45);
    s.ask = Math.max(ask, perceived * 1.02);
    const optionPart = perceived - cash;
    s.askCash = Math.ceil((s.ask - optionPart) / region.priceStep) * region.priceStep;
    s.askOptions = opts;
    rec.lastAsk = s.askCash;
    const final = s.patience <= 1 || s.ask <= min * 1.01;
    say(game, o, final ? 'counter.final' : s.round === 1 ? 'counter.first' : 'counter.next', { price: s.askCash }, s.round);
    result = 'countered';
  } else if (ratio >= 0.5) {
    say(game, o, 'offer.low', undefined, s.round);
    game.changeMood(o, -4);
    result = 'low';
  } else {
    say(game, o, 'offer.insult', undefined, s.round);
    game.changeMood(o, -12);
    game.addReputation(-2);
    spreadWord(game, o, 2, 5);
    rec.insults++;
    s.patience -= 1;
    result = 'insulted';
    game.toast({ kind: 'bad', key: 'toast.lowball' });
  }
  return afterRound(game, s, o, result);
}

function stateOffer(game: Game, s: Session, o: Owner, cash: number): OfferResult {
  if (game.reputation < 20) {
    say(game, o, 'state.lowRep', undefined, s.round);
    return finishRefusal(game, s, o, false);
  }
  const required = minimumPrice(game, o, s.value);
  if (cash >= required) {
    closeDeal(game, s, o, cash, []);
    return 'accepted';
  }
  const step = game.world.region.priceStep;
  s.ask = s.askCash = Math.ceil(required / step) * step;
  s.askOptions = [];
  say(game, o, 'state.reject', { price: s.askCash }, s.round);
  return afterRound(game, s, o, 'countered');
}

function afterRound(game: Game, s: Session, o: Owner, result: OfferResult): OfferResult {
  s.patience -= 1;
  const rec = game.record(o.id);
  if (o.mood < 12) {
    say(game, o, 'refuse.angry', undefined, s.round);
    rec.cooldownUntil = game.day + 21;
    game.setStatus(s.plotIds, 'refused');
    end(game, s, 'angry');
    return 'ended';
  }
  if (s.patience <= 0 && (result !== 'countered' || s.graceUsed)) {
    say(game, o, 'refuse.tired', undefined, s.round);
    rec.cooldownUntil = game.day + 3;
    end(game, s, 'tired');
    return 'ended';
  }
  if (s.patience <= 0) {
    s.graceUsed = true; // they'll hear one more reply to their own counter-offer
    s.patience = 1;
  }
  return result;
}

function finishRefusal(game: Game, s: Session, o: Owner, permanent = true): OfferResult {
  if (permanent) game.setStatus(s.plotIds, 'refused');
  game.record(o.id).cooldownUntil = game.day + 7;
  end(game, s, 'refused');
  return 'refused';
}

export function acceptCounter(game: Game, s: Session): OfferResult {
  if (s.ended || s.askCash === null) return 'ended';
  const o = game.world.owner(s.ownerId)!;
  if (immediateCost(game, s.value, s.askCash, s.askOptions) > game.money) return 'invalid';
  act(game, o, 'player.acceptCounter', { cash: s.askCash }, s.askOptions);
  closeDeal(game, s, o, s.askCash, s.askOptions);
  return 'accepted';
}

function closeDeal(game: Game, s: Session, o: Owner, cash: number, opts: DealOption[]) {
  settle(game, o, s.plotIds, s.value, cash, opts, s.pressured);
  say(game, o, acceptKey(o), { price: cash }, s.round);
  note(game, o, 'system.sold', { price: cash, n: s.plotIds.length });
  end(game, s, 'sold');
  game.toast({ kind: 'good', key: 'toast.sold', params: { ownerId: o.id, price: cash } });
}

export function acceptKey(o: Owner): string {
  return o.kind === 'state' ? 'state.accept'
    : o.kind !== 'person' ? 'accept.company'
      : o.finances === 'needs_money' || has(o, 'wantsMove') ? 'accept.happy'
        : o.attachment > 65 ? 'accept.sad' : 'accept.neutral';
}

/** Pays for and transfers a deal (shared by one-on-one visits and group meetings). */
export function settle(game: Game, o: Owner, plotIds: string[], value: number, cash: number, opts: DealOption[], pressured = false) {
  const rec = game.record(o.id);
  game.addMoney(-immediateCost(game, value, cash, opts));
  for (const k of opts) if (k === 'apartment' || k === 'shop') game.obligations.push({ ownerId: o.id, kind: k, day: game.day });

  const perceived = perceivedValue(game, o, value, cash, opts);
  const ratio = perceived / value;
  if (o.kind !== 'state' && !pressured) {
    if (ratio >= 1.35) {
      game.addReputation(2);
      // Neighbours hear about the generous deal and raise their expectations.
      for (const r of o.relations) {
        const nr = game.record(r.ownerId);
        nr.expectationBoost = Math.min(0.2, nr.expectationBoost + (r.kind === 'neutral' || r.kind === 'rival' ? 0.03 : 0.05));
      }
    } else if (ratio >= 1) game.addReputation(1);
  }
  game.setStatus(plotIds, 'sold');
  if (o.kind !== 'state') game.soldOwners.add(o.id);
  rec.finalRefusal = false;
  afterPurchase(game, plotIds);
}

// ------------------------------------------------------------------ help from others

const PERSUADE_CAP = 0.16;

/** A neighbour who sold to you and is willing to put in a good word. */
export function neighborHelper(game: Game, o: Owner): Owner | null {
  if (o.kind !== 'person') return null;
  let best: Owner | null = null, bestScore = 0;
  for (const r of o.relations) {
    if (r.kind === 'rival' || !game.soldOwners.has(r.ownerId)) continue;
    const n = game.world.owner(r.ownerId);
    if (!n || n.mood < 45) continue;
    const score = REL_WEIGHT[r.kind] * (1 + r.value / 100) * (n.mood / 50);
    if (score > bestScore) { best = n; bestScore = score; }
  }
  return best;
}

/** The neighbourhood head (Ketua RT) nearest to this owner, if any. */
export function rtHeadFor(game: Game, o: Owner): Owner | null {
  if (o.kind !== 'person' || has(o, 'rtHead')) return null;
  const w = game.world;
  const home = w.plot(o.plotIds[0]);
  if (!home) return null;
  const rel = o.relations.map((r) => w.owner(r.ownerId)).find((n) => n && has(n, 'rtHead'));
  if (rel) return rel;
  let best: Owner | null = null, bestD = 260;
  for (const n of rtHeads(game)) {
    const p = w.plot(n.plotIds[0]);
    if (!p) continue;
    const d = Math.hypot(p.cx - home.cx, p.cy - home.cy);
    if (d < bestD) { best = n; bestD = d; }
  }
  return best;
}

const rtCache = new WeakMap<Game, Owner[]>();
function rtHeads(game: Game): Owner[] {
  let l = rtCache.get(game);
  if (!l) { l = game.world.owners.filter((n) => n.kind === 'person' && has(n, 'rtHead')); rtCache.set(game, l); }
  return l;
}

/** Will the RT head take your side? */
export function rtOnSide(game: Game, rt: Owner): boolean {
  return game.soldOwners.has(rt.id) ? rt.mood >= 40 : rt.mood >= 58;
}

export function helpCost(game: Game, s: Session, kind: 'neighbor' | 'rt'): number {
  const step = game.world.region.priceStep / 5;
  return Math.max(step, Math.round((s.value * (kind === 'rt' ? 0.008 : 0.004)) / step) * step);
}

function sayBy(game: Game, o: Owner, by: Owner, key: string, params?: LogEntry['params'], round = 0) {
  const v = rngFor(game, by, key, round).int(0, 9999);
  game.record(o.id).log.push({ day: game.day, who: 'owner', key, params, v, by: by.id });
}

/** Ask a neighbour who sold, or the RT head, to talk to this owner. */
export function askHelp(game: Game, s: Session, kind: 'neighbor' | 'rt'): 'helped' | 'refused' | 'unavailable' {
  if (s.ended) return 'unavailable';
  const o = game.world.owner(s.ownerId)!;
  const helper = kind === 'neighbor' ? neighborHelper(game, o) : rtHeadFor(game, o);
  if (!helper || s.helped?.includes(helper.id)) return 'unavailable';
  const cost = helpCost(game, s, kind);
  if (game.money < cost) return 'unavailable';
  const rec = game.record(o.id);
  (s.helped ??= []).push(helper.id);
  act(game, o, kind === 'rt' ? 'player.askRt' : 'player.askNeighbor', { neighbor: helper.name, cost });
  if (kind === 'rt' && !rtOnSide(game, helper)) {
    sayBy(game, o, helper, 'persuade.rt.refuse', undefined, s.round);
    game.changeMood(o, -3);
    return 'refused';
  }
  game.addMoney(-cost);
  game.changeMood(helper, 2);
  sayBy(game, o, helper, kind === 'rt' ? 'persuade.rt.say' : 'persuade.neighbor.say', { name: o.name }, s.round);
  if (o.holdout) {
    say(game, o, 'persuade.react.no', undefined, s.round);
    return 'refused';
  }
  game.changeMood(o, kind === 'rt' ? 7 : 9);
  rec.persuadeDiscount = Math.min(PERSUADE_CAP, (rec.persuadeDiscount ?? 0) + (kind === 'rt' ? 0.07 : 0.05));
  s.ask = null;
  s.patience += 1;
  say(game, o, 'persuade.react.yes', undefined, s.round);
  return 'helped';
}

export function listen(game: Game, s: Session): void {
  if (s.ended) return;
  const o = game.world.owner(s.ownerId)!;
  act(game, o, 'player.listen');
  if (s.listened) { say(game, o, 'listen.again', undefined, s.round); return; }
  s.listened = true;
  if (o.kind === 'state') { say(game, o, 'listen.state'); return; }
  const rng = rngFor(game, o, 'listen');
  const story = o.stories.length ? rng.pick(o.stories) : null;
  if (story) say(game, o, `story.${story.key}`, story.params);
  if (o.holdout && rng.chance(0.7)) {
    say(game, o, 'hint.holdout'); // listening is how you spot a holdout before wasting offers
  } else {
    const pref = preferredOption(game, o);
    game.record(o.id).knownPreference = pref;
    say(game, o, `hint.${pref}`);
  }
  game.changeMood(o, 4);
}

export function giftCost(game: Game, s: Session): number {
  const step = game.world.region.priceStep;
  return Math.max(step / 5, Math.round((s.value * 0.002) / (step / 5)) * (step / 5));
}

export function giveGift(game: Game, s: Session): boolean {
  if (s.ended) return false;
  const o = game.world.owner(s.ownerId)!;
  const cost = giftCost(game, s);
  if (game.money < cost) return false;
  act(game, o, 'player.gift', { cost });
  if (o.kind === 'state') {
    say(game, o, 'gift.refuseState');
    game.addReputation(-3);
    return true;
  }
  if (s.gifted) { say(game, o, 'gift.again'); return true; }
  s.gifted = true;
  game.addMoney(-cost);
  game.changeMood(o, 8);
  s.patience += 1;
  say(game, o, 'gift.thanks');
  return true;
}

export function pressure(game: Game, s: Session): 'works' | 'backfire' | 'ended' {
  if (s.ended) return 'ended';
  const o = game.world.owner(s.ownerId)!;
  const rec = game.record(o.id);
  act(game, o, 'player.pressure');
  s.round++;
  if (o.kind === 'state') {
    say(game, o, 'pressure.state', undefined, s.round);
    game.addReputation(-3);
    return 'backfire';
  }
  game.addReputation(has(o, 'rtHead') ? -8 : -4);
  spreadWord(game, o, 3, 7);
  game.toast({ kind: 'bad', key: 'toast.pressure' });
  const chance = s.pressured || o.holdout ? 0
    : 0.15 + (o.finances === 'needs_money' ? 0.35 : 0) + (o.attachment < 40 ? 0.15 : 0) + (o.greed < 40 ? 0.1 : 0);
  s.pressured = true;
  let result: 'works' | 'backfire';
  if (rngFor(game, o, 'pressure', s.round).chance(chance)) {
    rec.pressureDiscount = Math.min(0.25, rec.pressureDiscount + 0.12);
    s.ask = null; // they reconsider their asking price
    game.changeMood(o, -8);
    say(game, o, 'pressure.works', undefined, s.round);
    result = 'works';
  } else {
    game.changeMood(o, -20);
    s.patience -= 1;
    say(game, o, 'pressure.backfire', undefined, s.round);
    result = 'backfire';
  }
  return afterRound(game, s, o, 'low') === 'ended' ? 'ended' : result;
}

export function leave(game: Game, s: Session) {
  if (s.ended) return;
  const o = game.world.owner(s.ownerId)!;
  act(game, o, 'player.leave');
  game.record(o.id).cooldownUntil = game.day + 1;
  end(game, s, 'left');
}

function end(game: Game, s: Session, outcome: Session['outcome']) {
  s.ended = true;
  s.outcome = outcome;
  game.emit('session');
}
