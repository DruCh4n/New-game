/**
 * The living city (Milestone 13): random events (floods, booms, crashes, elections, festivals),
 * a rival developer who competes for land, and protests when you behave badly.
 */
import { Rng, hashString } from '../util/random';
import type { Game } from './Game';
import type { Plot } from './types';

export type EventKind = 'boom' | 'crash' | 'flood' | 'election' | 'festival' | 'protest';

export interface CityEvent {
  kind: EventKind;
  day: number;
  until: number;
  /** Multiplier applied to the land/property market while active. */
  market: number;
  /** Multiplier applied to building demand while active. */
  demand: number;
  params?: Record<string, string | number>;
}

export interface NewsItem { day: number; key: string; params?: Record<string, string | number>; kind: 'good' | 'bad' | 'info' }

export interface Rival {
  name: string;
  /** Plots the rival owns (ids). */
  owned: string[];
  /** How aggressive this game's rival is (plots/month target). */
  appetite: number;
}

export interface EventsSave {
  active: CityEvent[];
  news: NewsItem[];
  rival: Rival;
  protestsUntil: number;
  nextId: number;
}

const RIVAL_NAMES = ['PT Maju Jaya', 'PT Griya Makmur', 'PT Bumi Sentosa', 'CV Karya Abadi', 'PT Mega Propertindo'];

export class Events {
  readonly active: CityEvent[] = [];
  readonly news: NewsItem[] = [];
  rival: Rival;
  /** Permits blocked by protests until this day. */
  protestsUntil = 0;
  nextId = 1;

  constructor(seed: number) {
    const rng = new Rng(hashString(`rival|${seed}`));
    this.rival = { name: rng.pick(RIVAL_NAMES), owned: [], appetite: rng.range(0.5, 1.3) };
  }

  serialize(): EventsSave {
    return { active: this.active, news: this.news, rival: this.rival, protestsUntil: this.protestsUntil, nextId: this.nextId };
  }

  restore(s: EventsSave) {
    this.active.push(...s.active);
    this.news.push(...s.news);
    this.rival = s.rival;
    this.protestsUntil = s.protestsUntil;
    this.nextId = s.nextId;
  }
}

// ------------------------------------------------------------------ market modifiers

/** Combined market multiplier from active events (boom/crash). */
export function marketMult(game: Game): number {
  let m = 1;
  for (const e of game.events.active) if (e.until >= game.day) m *= e.market;
  return m;
}

/** Combined demand multiplier from active events (floods lower it, festivals lift it). */
export function eventDemand(game: Game): number {
  let m = 1;
  for (const e of game.events.active) if (e.until >= game.day) m *= e.demand;
  return m;
}

export function marketLabel(game: Game): 'boom' | 'crash' | 'normal' {
  const m = marketMult(game);
  return m > 1.08 ? 'boom' : m < 0.92 ? 'crash' : 'normal';
}

/** Permits paused by protests? */
export function permitsBlocked(game: Game): boolean {
  return game.events.protestsUntil > game.day;
}

export function news(game: Game, key: string, kind: NewsItem['kind'], params?: Record<string, string | number>) {
  const n = game.events.news;
  n.push({ day: game.day, key, kind, ...(params ? { params } : {}) });
  if (n.length > 50) n.splice(0, n.length - 50);
  game.toast({ kind, key: 'toast.city', params: { headline: key, ...params } });
}

export function unreadNews(game: Game): number {
  // simple: items in the last 20 days
  return game.events.news.filter((n) => game.day - n.day < 20).length;
}

// ------------------------------------------------------------------ events

function rngFor(game: Game, tag: string) {
  return new Rng(hashString(`event|${tag}|${game.day}|${game.events.nextId}|${game.world.seed}`));
}

/** Near the river → flood-prone. */
function floodProne(game: Game, p: Plot): boolean {
  const w = game.world;
  const near = w.map.waterways?.some((ww) => {
    for (let i = 0; i + 1 < ww.line.length; i += 2) if (Math.hypot(ww.line[i] - p.cx, ww.line[i + 1] - p.cy) < 70) return true;
    return false;
  });
  return !!near;
}

/** Monthly: maybe start a new city event. */
export function monthlyEvents(game: Game) {
  const rng = rngFor(game, 'roll');
  // clear expired
  for (let i = game.events.active.length - 1; i >= 0; i--) if (game.events.active[i].until < game.day) game.events.active.splice(i, 1);
  if (game.events.active.some((e) => e.kind === 'boom' || e.kind === 'crash')) {
    // don't stack market swings
  } else if (rng.chance(0.14)) {
    start(game, 'boom', 365, { market: 1.18, demand: 1.15 });
    return;
  } else if (rng.chance(0.12)) {
    start(game, 'crash', 300, { market: 0.8, demand: 0.82 });
    return;
  }
  const roll = rng.next();
  if (roll < 0.08) {
    // flood: hits river-side buildings' occupancy and value for a season
    let hit = 0;
    for (const b of game.dev.buildings) {
      const p = game.world.plotAt(b.cx, b.cy);
      if (p && floodProne(game, p)) { b.occupancy *= 0.6; hit++; }
    }
    start(game, 'flood', 90, { market: 1, demand: 0.9, params: { n: hit } });
    game.events.nextId++;
  } else if (roll < 0.14) {
    start(game, 'election', 120, { market: 1, demand: 1 });
  } else if (roll < 0.2) {
    start(game, 'festival', 60, { market: 1.02, demand: 1.08 });
    game.addReputation(2);
  }
}

function start(game: Game, kind: EventKind, days: number, opts: { market: number; demand: number; params?: Record<string, string | number> }) {
  game.events.active.push({ kind, day: game.day, until: game.day + days, market: opts.market, demand: opts.demand, params: opts.params });
  game.events.nextId++;
  news(game, `news.${kind}`, kind === 'boom' || kind === 'festival' ? 'good' : kind === 'crash' || kind === 'flood' ? 'bad' : 'info', opts.params);
}

// ------------------------------------------------------------------ protests

/** Low reputation or harsh actions trigger protests that pause permits for a while. */
export function maybeProtest(game: Game) {
  if (permitsBlocked(game) || game.reputation > 28) return;
  if (rngFor(game, 'protest').chance(0.3)) {
    game.events.protestsUntil = game.day + 30;
    news(game, 'news.protest', 'bad');
  }
}

// ------------------------------------------------------------------ rival developer

/** Plots the rival could buy: on the market, not owned by you or already the rival, no live deal. */
function rivalTargets(game: Game): Plot[] {
  const w = game.world;
  return w.plots.filter((p) => p.kind === 'building' && p.category === 'house'
    && w.ownerOf(p).kind === 'person' && !game.ownsPlot(p.id) && !game.events.rival.owned.includes(p.id)
    && game.world.statusOf(p.id) !== 'negotiating' && !w.ownerOf(p).holdout);
}

export function rivalOwns(game: Game, plotId: string): boolean {
  return game.events.rival.owned.includes(plotId);
}

/** Monthly: the rival buys a plot or two, sometimes right next to your land. */
export function rivalTurn(game: Game) {
  const rng = rngFor(game, 'rival');
  const n = Math.min(2, Math.round(game.events.rival.appetite * (marketLabel(game) === 'boom' ? 1.5 : 1) * (rng.next() < 0.6 ? 1 : 2)));
  if (n <= 0) return;
  // don't let the rival run away with the town
  const mineCount = game.world.plots.filter((p) => game.ownsPlot(p.id)).length;
  if (game.events.rival.owned.length > 20 + mineCount * 3) return;
  const targets = rivalTargets(game);
  if (!targets.length) return;
  // Prefer plots near the player's land (competition), else random.
  const mine = game.world.plots.filter((p) => game.ownsPlot(p.id));
  const near = (p: Plot) => mine.length ? Math.min(...mine.slice(0, 40).map((m) => Math.hypot(m.cx - p.cx, m.cy - p.cy))) : 9999;
  const pool = mine.length && rng.chance(0.6)
    ? targets.filter((p) => near(p) < 160).slice(0, 60)
    : targets;
  const list = (pool.length ? pool : targets);
  let bought = 0;
  for (let i = 0; i < n && list.length; i++) {
    const p = list[rng.int(0, list.length - 1)];
    if (game.events.rival.owned.includes(p.id)) continue;
    game.events.rival.owned.push(p.id);
    bought++;
  }
  if (bought) {
    game.emit('status');
    if (rng.chance(0.4)) news(game, 'news.rivalBuys', 'info', { name: game.events.rival.name, n: bought });
  }
}
