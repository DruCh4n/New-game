/**
 * Land papers (Milestone 10).
 *
 * Every parcel has papers: a full certificate (SHM / HGB) or something weaker (girik, a bare sale deed,
 * an inheritance dispute, no papers at all, or an overlapping claim). Weak papers open legal routes
 * (notary mediation, court, clearance by the city) and must be registered after you buy before you can
 * build. Three officials offer official, paid services with faces and chat rooms of their own.
 */
import { Rng, hashString } from '../util/random';
import type { Game } from './Game';
import type { Owner, Plot } from './types';
import type { World } from './World';

export type PaperKind = 'shm' | 'hgb' | 'girik' | 'ajb' | 'heirs' | 'none' | 'double';
export type OfficialId = 'lurah' | 'camat' | 'bpn';
export const OFFICIALS: OfficialId[] = ['lurah', 'camat', 'bpn'];
export type CaseKind = 'court' | 'eviction' | 'mediation';

export interface Case {
  id: string;
  kind: CaseKind;
  ownerId: string;
  plotIds: string[];
  day: number;
  daysLeft: number;
  /** Chance of winning (court). */
  chance: number;
  cost: number;
}

export interface Headline { day: number; key: string; params?: Record<string, string | number>; bad: boolean }

export interface PapersSave {
  checked: string[];
  registering: [string, number][];
  heirsOk: string[];
  cases: Case[];
  services: Partial<Record<OfficialId, number>>;
  news: Headline[];
  nextId: number;
}

const WEAK: PaperKind[] = ['girik', 'ajb', 'none', 'double'];

export class Papers {
  readonly checked = new Set<string>();
  /** Plots you bought whose papers are still being registered (days left). Building is blocked there. */
  readonly registering = new Map<string, number>();
  /** Owners whose heirs have agreed (inheritance disputes settled). */
  readonly heirsOk = new Set<string>();
  readonly cases: Case[] = [];
  /** Official service active until this day. */
  readonly services: Partial<Record<OfficialId, number>> = {};
  readonly news: Headline[] = [];
  nextId = 1;

  serialize(): PapersSave {
    return {
      checked: [...this.checked], registering: [...this.registering], heirsOk: [...this.heirsOk], cases: this.cases,
      services: this.services, news: this.news, nextId: this.nextId,
    };
  }

  restore(s: PapersSave) {
    s.checked.forEach((x) => this.checked.add(x));
    s.registering.forEach(([k, v]) => this.registering.set(k, v));
    s.heirsOk.forEach((x) => this.heirsOk.add(x));
    this.cases.push(...s.cases);
    Object.assign(this.services, s.services);
    this.news.push(...s.news);
    this.nextId = s.nextId;
  }
}

// ------------------------------------------------------------------ papers

/** The papers behind a plot (deterministic per world). */
export function paperOf(world: World, plot: Plot): PaperKind {
  const o = world.ownerOf(plot);
  if (o.kind === 'state') return 'shm';
  const r = (hashString(`papers|${plot.id}|${world.seed}`) % 10000) / 10000;
  if (o.kind === 'company') return r < 0.75 ? 'hgb' : r < 0.93 ? 'shm' : 'double';
  if (o.kind === 'institution') return r < 0.85 ? 'shm' : 'girik';
  const kampung = plot.area < 180 || !plot.road;
  const table: [PaperKind, number][] = plot.kind === 'land'
    ? [['shm', 0.3], ['girik', 0.4], ['ajb', 0.12], ['heirs', 0.08], ['none', 0.05], ['double', 0.05]]
    : kampung
      ? [['shm', 0.48], ['girik', 0.18], ['ajb', 0.12], ['heirs', 0.1], ['none', 0.08], ['double', 0.04]]
      : [['shm', 0.68], ['hgb', 0.06], ['girik', 0.08], ['ajb', 0.07], ['heirs', 0.07], ['none', 0.02], ['double', 0.02]];
  let acc = 0;
  for (const [k, p] of table) { acc += p; if (r < acc) return k; }
  return 'shm';
}

export const isWeak = (k: PaperKind) => WEAK.includes(k);

export function serviceActive(game: Game, c: OfficialId): boolean {
  return (game.papers.services[c] ?? -1) >= game.day;
}

export function papersKnown(game: Game, plot: Plot): boolean {
  return game.papers.checked.has(plot.id) || game.ownsPlot(plot.id) || serviceActive(game, 'bpn');
}

const step = (game: Game) => game.world.region.priceStep;
const round = (game: Game, v: number) => Math.max(step(game) / 5, Math.round(v / (step(game) / 5)) * (step(game) / 5));
const unit = (game: Game) => game.world.region.landPerM2;

export function checkCost(game: Game, plot: Plot): number {
  return round(game, Math.max(unit(game) * 0.4, plot.value * 0.002));
}

/** Pay the land office (BPN) to look up a plot's papers. */
export function checkPapers(game: Game, plot: Plot): boolean {
  if (papersKnown(game, plot)) return true;
  const c = checkCost(game, plot);
  if (game.money < c) return false;
  game.addMoney(-c);
  game.papers.checked.add(plot.id);
  game.emit('papers');
  return true;
}

/** Registration after buying land with weak papers: [cost, days], or null if none is needed. */
export function registrationNeed(game: Game, plot: Plot): [number, number] | null {
  const k = paperOf(game.world, plot);
  const fast = serviceActive(game, 'bpn') ? 0.5 : 1;
  if (k === 'girik' || k === 'ajb') return [round(game, plot.value * 0.015), Math.round(60 * fast)];
  if (k === 'none') return [round(game, plot.value * 0.08), Math.round(90 * fast)];
  if (k === 'double') return [round(game, plot.value * 0.01), Math.round(45 * fast)];
  return null;
}

/** Called after a purchase: weak papers must be registered before you can build there. */
export function afterPurchase(game: Game, plotIds: string[]) {
  let cost = 0, days = 0, n = 0;
  for (const id of plotIds) {
    const p = game.world.plot(id);
    if (!p) continue;
    const need = registrationNeed(game, p);
    if (!need) continue;
    cost += need[0];
    days = Math.max(days, need[1]);
    game.papers.registering.set(id, need[1]);
    n++;
  }
  if (!n) return;
  game.addMoney(-cost);
  game.toast({ kind: 'info', key: 'toast.registering', params: { n, cost, days } });
}

// ------------------------------------------------------------------ legal routes

export interface Route { kind: CaseKind; cost: number; days: number; chance: number }

function ownerValue(game: Game, o: Owner): number {
  return o.plotIds.filter((id) => !game.ownsPlot(id)).reduce((a, id) => a + game.world.plot(id)!.value, 0);
}

export function caseFor(game: Game, plotId: string): Case | undefined {
  return game.papers.cases.find((c) => c.plotIds.includes(plotId));
}

export function legalRoutes(game: Game, plot: Plot): Route[] {
  const o = game.world.ownerOf(plot);
  if (o.kind === 'state' || game.ownsPlot(plot.id) || caseFor(game, plot.id)) return [];
  const k = paperOf(game.world, plot);
  const v = ownerValue(game, o);
  const out: Route[] = [];
  if (k === 'heirs' && !game.papers.heirsOk.has(o.id)) out.push({ kind: 'mediation', cost: round(game, Math.max(unit(game) * 2, v * 0.01)), days: 14, chance: 1 });
  if (k === 'none') out.push({ kind: 'eviction', cost: round(game, v * 0.3), days: 30, chance: 1 });
  if (k === 'girik' || k === 'ajb' || k === 'double') {
    const base = k === 'double' ? 0.55 : k === 'ajb' ? 0.5 : 0.4;
    out.push({ kind: 'court', cost: round(game, v * 0.06 + unit(game) * 5), days: 120, chance: base });
  }
  return out;
}

export function startRoute(game: Game, plot: Plot, kind: CaseKind): boolean {
  const r = legalRoutes(game, plot).find((x) => x.kind === kind);
  if (!r || game.money < r.cost) return false;
  const o = game.world.ownerOf(plot);
  const pp = game.papers;
  game.addMoney(-r.cost);
  pp.cases.push({ id: `c${pp.nextId++}`, kind, ownerId: o.id, plotIds: o.plotIds.filter((id) => !game.ownsPlot(id)), day: game.day, daysLeft: r.days, chance: r.chance, cost: r.cost });
  pp.checked.add(plot.id);
  if (kind === 'eviction') {
    game.addReputation(-5);
    game.changeMood(o, -40);
    for (const rel of o.relations) { const n = game.world.owner(rel.ownerId); if (n) game.changeMood(n, -6); }
    headline(game, 'news.eviction', { name: o.name }, true);
  } else if (kind === 'court') {
    game.changeMood(o, -30);
    game.addReputation(-1);
  }
  game.record(o.id).log.push({ day: game.day, who: 'system', key: `system.case.${kind}` });
  game.emit('papers');
  return true;
}

/** Land changes hands by a court ruling or a city clearance. */
function transfer(game: Game, o: Owner, plotIds: string[]) {
  game.setStatus(plotIds, 'sold');
  game.soldOwners.add(o.id);
  game.changeMood(o, -50);
  game.record(o.id).log.push({ day: game.day, who: 'system', key: 'system.taken', params: { n: plotIds.length } });
}

function resolveCase(game: Game, c: Case) {
  const o = game.world.owner(c.ownerId)!;
  const plots = c.plotIds.filter((id) => !game.ownsPlot(id));
  if (c.kind === 'mediation') {
    game.papers.heirsOk.add(o.id);
    game.record(o.id).cooldownUntil = game.day;
    say(game, o, 'papers.heirsAgree');
    game.toast({ kind: 'good', key: 'toast.heirs', params: { ownerId: o.id } });
  } else if (c.kind === 'eviction') {
    transfer(game, o, plots);
    game.toast({ kind: 'info', key: 'toast.evicted', params: { ownerId: o.id } });
  } else if (new Rng(hashString(`court|${c.id}|${game.world.seed}`)).chance(c.chance)) {
    transfer(game, o, plots);
    headline(game, 'news.courtWin', { name: o.name }, false);
  } else {
    game.addReputation(-3);
    game.record(o.id).finalRefusal = true;
    headline(game, 'news.courtLose', { name: o.name }, true);
  }
}

export function headline(game: Game, key: string, params: Record<string, string | number>, bad: boolean) {
  const pp = game.papers;
  pp.news.push({ day: game.day, key, params, bad });
  if (pp.news.length > 40) pp.news.splice(0, pp.news.length - 40);
  game.toast({ kind: bad ? 'bad' : 'info', key: 'toast.news', params: { headline: key, ...params } });
}

// ------------------------------------------------------------------ officials

const LOOK: Record<OfficialId, { gender: 'm' | 'f'; age: number; honorific: string; name: string }> = {
  lurah: { gender: 'm', age: 52, honorific: 'Pak', name: 'Lurah Suhendra' },
  camat: { gender: 'f', age: 47, honorific: 'Bu', name: 'Camat Ratna' },
  bpn: { gender: 'm', age: 44, honorific: 'Pak', name: 'Yanto (BPN)' },
};

export const officialOwnerId = (c: OfficialId) => `c_${c}`;

/** Officials are characters with faces and chat rooms, but own no land. */
export function registerOfficials(world: World) {
  for (const c of OFFICIALS) {
    if (world.owner(officialOwnerId(c))) continue;
    const l = LOOK[c];
    world.addContact({
      id: officialOwnerId(c), kind: 'person', name: l.name, honorific: l.honorific, gender: l.gender, age: l.age,
      occupation: `official.${c}`, role: c, familySize: 0, yearsLived: 0, attachment: 0, greed: 30, finances: 'comfortable',
      holdout: false, minFactor: 1, mood: 55, plotIds: [], relations: [], stories: [],
    });
  }
}

export function officialOwner(game: Game, c: OfficialId): Owner {
  return game.world.owner(officialOwnerId(c))!;
}

const PRICE: Record<OfficialId, number> = { lurah: 10, camat: 20, bpn: 15 };
const DAYS: Record<OfficialId, number> = { lurah: 90, camat: 120, bpn: 180 };

export function serviceCost(game: Game, c: OfficialId): number { return round(game, unit(game) * PRICE[c]); }
export function serviceDays(c: OfficialId) { return DAYS[c]; }

function say(game: Game, o: Owner, key: string, params?: Record<string, string | number>) {
  const v = new Rng(hashString(`${o.id}|${key}|${game.day}`)).int(0, 9999);
  game.record(o.id).log.push({ day: game.day, who: 'owner', key, v, ...(params ? { params } : {}) });
}

/** Pay an official fee for a service (public info session, permit fast-track, registry search). */
export function requestService(game: Game, c: OfficialId): boolean {
  if (serviceActive(game, c)) return false;
  const cost = serviceCost(game, c);
  if (game.money < cost) return false;
  const who = officialOwner(game, c);
  game.addMoney(-cost);
  game.record(who.id).log.push({ day: game.day, who: 'player', key: `player.service.${c}`, params: { cost } });
  say(game, who, `official.${c}.done`);
  game.papers.services[c] = game.day + DAYS[c];
  if (c === 'lurah') {
    // an open information session: people hear the plan first-hand
    game.addReputation(2);
    for (const o of game.world.owners) if (o.kind === 'person') game.changeMood(o, 4);
  }
  game.emit('papers');
  return true;
}

/** Say hello: the official explains the service. */
export function greetOfficial(game: Game, c: OfficialId) {
  const who = officialOwner(game, c);
  const log = game.record(who.id).log;
  if (log.length && log[log.length - 1].day === game.day) return;
  say(game, who, serviceActive(game, c) ? `official.${c}.active` : `official.${c}.greet`);
}

// ------------------------------------------------------------------ time

export function papersDaily(game: Game) {
  const pp = game.papers;
  let changed = false;
  for (const [id, d] of pp.registering) {
    if (d <= 1) {
      pp.registering.delete(id);
      changed = true;
      if (!pp.registering.size) game.toast({ kind: 'good', key: 'toast.registered' });
    } else pp.registering.set(id, d - 1);
  }
  for (const c of [...pp.cases]) {
    c.daysLeft--;
    if (c.daysLeft <= 0) {
      pp.cases.splice(pp.cases.indexOf(c), 1);
      resolveCase(game, c);
      changed = true;
    }
  }
  if (changed) game.emit('papers');
}

/** An inheritance dispute blocks a normal sale until it is mediated. */
export function heirsBlock(game: Game, o: Owner): boolean {
  if (o.kind !== 'person' || game.papers.heirsOk.has(o.id)) return false;
  const p = o.plotIds.map((id) => game.world.plot(id)!).find((x) => x && !game.ownsPlot(x.id));
  return !!p && paperOf(game.world, p) === 'heirs';
}
