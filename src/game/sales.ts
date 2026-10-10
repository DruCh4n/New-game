/**
 * Sales & marketing (Milestone 11).
 *
 * As the developer you set a price level on each income building, run marketing campaigns that lift
 * demand for a while, and meet walk-in buyers who want a unit in one of your apartment towers and
 * haggle over the price.
 */
import { Rng, hashString } from '../util/random';
import { generatePersonName, honorific, type Gender } from './names';
import type { Game } from './Game';
import type { NewBuilding } from './Development';
import { buildingType } from './catalog';
import { unitPrice } from './Economy';

export interface Campaign { until: number; boost: number }

export interface BuyerLead {
  id: string;
  buildingId: string;
  name: string;
  honorific: string;
  gender: Gender;
  age: number;
  /** How many units they want. */
  units: number;
  /** Their opening offer as a fraction of the list price (<1). */
  offerFactor: number;
  /** The most they'll pay as a fraction of list price. */
  maxFactor: number;
  day: number;
  /** Conversation so far. */
  log: { who: 'buyer' | 'player'; key: string; params?: Record<string, string | number> }[];
  round: number;
  ended?: 'bought' | 'left';
}

export interface SalesSave {
  campaign: Campaign | null;
  leads: BuyerLead[];
  priceLevels: [string, number][];
  nextId: number;
}

export class Sales {
  campaign: Campaign | null = null;
  readonly leads: BuyerLead[] = [];
  nextId = 1;

  serialize(game: Game): SalesSave {
    return {
      campaign: this.campaign,
      leads: this.leads,
      priceLevels: game.dev.buildings.filter((b) => b.priceLevel !== undefined && b.priceLevel !== 1).map((b) => [b.id, b.priceLevel!] as [string, number]),
      nextId: this.nextId,
    };
  }

  restore(game: Game, s: SalesSave) {
    this.campaign = s.campaign;
    this.leads.push(...s.leads);
    this.nextId = s.nextId;
    for (const [id, lvl] of s.priceLevels) { const b = game.dev.buildings.find((x) => x.id === id); if (b) b.priceLevel = lvl; }
  }
}

const step = (game: Game) => game.world.region.priceStep;
const round = (game: Game, v: number) => Math.max(step(game) / 5, Math.round(v / (step(game) / 5)) * (step(game) / 5));

export const priceLevel = (b: NewBuilding) => b.priceLevel ?? 1;

/** Price level nudges income up but sales/occupancy down (and vice versa). */
export function demandFactor(b: NewBuilding): number {
  return 1 - (priceLevel(b) - 1) * 1.6; // level 1.25 → ~0.6 pace, level 0.8 → ~1.32 pace
}

export function setPriceLevel(game: Game, b: NewBuilding, level: number) {
  b.priceLevel = Math.max(0.8, Math.min(1.3, Math.round(level * 100) / 100));
  game.emit('sales');
}

export function marketingActive(game: Game): boolean {
  return !!game.sales.campaign && game.sales.campaign.until >= game.day;
}

export function marketingBoost(game: Game): number {
  return marketingActive(game) ? game.sales.campaign!.boost : 0;
}

export function campaignCost(game: Game): number {
  // scales with how much you have to sell
  const sellable = game.dev.buildings.reduce((a, b) => {
    const bt = buildingType(b.type);
    if (b.daysLeft > 0 || b.permitDays > 0 || bt.income === 'civic') return a;
    return a + b.cost;
  }, 0);
  return round(game, Math.max(game.world.region.landPerM2 * 8, sellable * 0.01));
}

/** Pay for a 120-day marketing push: faster sales and higher occupancy, and more buyer leads. */
export function runCampaign(game: Game): boolean {
  if (marketingActive(game)) return false;
  const cost = campaignCost(game);
  if (game.money < cost) return false;
  game.addMoney(-cost);
  game.sales.campaign = { until: game.day + 120, boost: 0.25 };
  game.addReputation(1);
  game.toast({ kind: 'good', key: 'toast.campaign' });
  game.emit('sales');
  return true;
}

// ------------------------------------------------------------------ walk-in buyers

/** Apartment towers with unsold units. */
function sellables(game: Game): NewBuilding[] {
  return game.dev.buildings.filter((b) => {
    const bt = buildingType(b.type);
    return bt.income === 'sale' && b.daysLeft === 0 && b.permitDays === 0 && unitsLeft(b) > 0;
  });
}

export function unitsLeft(b: NewBuilding): number {
  return buildingType(b.type).units - b.reserved - b.unitsSold - (b.directSales ?? 0);
}

function rngFor(game: Game, tag: string) {
  return new Rng(hashString(`sales|${tag}|${game.day}|${game.sales.nextId}|${game.world.seed}`));
}

/** Monthly: maybe a buyer walks in (more often during a campaign and with good reputation). */
export function monthlyBuyers(game: Game) {
  if (game.sales.leads.some((l) => !l.ended)) return; // one lead at a time
  const towers = sellables(game);
  if (!towers.length) return;
  const rng = rngFor(game, 'lead');
  const chance = 0.35 + game.reputation / 300 + (marketingActive(game) ? 0.35 : 0);
  if (!rng.chance(Math.min(0.9, chance))) return;
  const b = rng.pick(towers);
  const gender: Gender = rng.chance(0.5) ? 'm' : 'f';
  const { name } = generatePersonName(game.world.map.country, gender, rng);
  const age = rng.int(28, 58);
  const wealthy = rng.chance(0.25);
  const lead: BuyerLead = {
    id: `buy${game.sales.nextId++}`,
    buildingId: b.id,
    name, honorific: honorific(game.world.map.country, gender, age), gender, age,
    units: Math.min(unitsLeft(b), rng.chance(0.2) ? rng.int(2, 4) : 1),
    offerFactor: 0.78 + rng.next() * 0.1,
    maxFactor: (wealthy ? 1.08 : 0.96) + rng.next() * 0.06,
    day: game.day, log: [], round: 0,
  };
  say(lead, 'buyer', 'buyer.greet');
  game.sales.leads.push(lead);
  if (game.sales.leads.length > 20) game.sales.leads.splice(0, game.sales.leads.length - 20);
  game.toast({ kind: 'info', key: 'toast.buyer', params: { name: lead.name } });
  game.emit('sales');
}

function say(l: BuyerLead, who: 'buyer' | 'player', key: string, params?: Record<string, string | number>) {
  l.log.push({ who, key, ...(params ? { params } : {}) });
}

export const listPrice = (b: NewBuilding) => Math.round(unitPrice(b) * priceLevel(b));

/** Current price the buyer is willing to pay (rises as you haggle, up to their max). */
export function buyerPrice(game: Game, l: BuyerLead): number {
  const b = game.dev.buildings.find((x) => x.id === l.buildingId);
  if (!b) return 0;
  const f = Math.min(l.maxFactor, l.offerFactor + l.round * 0.06);
  return Math.round(listPrice(b) * f * l.units);
}

/** Accept the buyer's current offer: sell the units at that price. */
export function acceptBuyer(game: Game, l: BuyerLead): boolean {
  const b = game.dev.buildings.find((x) => x.id === l.buildingId);
  if (!b || l.ended) return false;
  const price = buyerPrice(game, l);
  b.directSales = (b.directSales ?? 0) + l.units;
  b.unitsSold += 0; // directSales tracked separately
  game.addMoney(price);
  l.ended = 'bought';
  say(l, 'buyer', 'buyer.deal', { price });
  game.toast({ kind: 'good', key: 'toast.buyerSold', params: { name: l.name, n: l.units, price } });
  game.emit('sales');
  return true;
}

/** Counter at the list price (or a given fraction). The buyer accepts if it's within reach. */
export function counterBuyer(game: Game, l: BuyerLead, factor: number): 'accepted' | 'haggle' | 'left' {
  const b = game.dev.buildings.find((x) => x.id === l.buildingId);
  if (!b || l.ended) return 'left';
  l.round++;
  say(l, 'player', 'player.counter', { factor: Math.round(factor * 100) });
  if (factor <= l.maxFactor) {
    const price = Math.round(listPrice(b) * factor * l.units);
    b.directSales = (b.directSales ?? 0) + l.units;
    game.addMoney(price);
    l.ended = 'bought';
    say(l, 'buyer', 'buyer.accept', { price });
    game.toast({ kind: 'good', key: 'toast.buyerSold', params: { name: l.name, n: l.units, price } });
    game.emit('sales');
    return 'accepted';
  }
  if (l.round >= 3 || factor > l.maxFactor + 0.12) {
    l.ended = 'left';
    say(l, 'buyer', 'buyer.walk');
    game.emit('sales');
    return 'left';
  }
  say(l, 'buyer', 'buyer.haggle', { price: buyerPrice(game, l) });
  game.emit('sales');
  return 'haggle';
}

export function dismissBuyer(game: Game, l: BuyerLead) {
  if (l.ended) return;
  l.ended = 'left';
  say(l, 'player', 'player.declineBuyer');
  game.emit('sales');
}

/** A synthetic owner-like record so the buyer gets a portrait. */
export function buyerFace(l: BuyerLead) {
  return { id: `face_${l.id}`, kind: 'person' as const, name: l.name, honorific: l.honorific, gender: l.gender, age: l.age,
    familySize: 0, yearsLived: 0, attachment: 0, greed: 0, finances: 'comfortable' as const, holdout: false, minFactor: 1,
    mood: l.ended === 'left' ? 30 : l.ended === 'bought' ? 85 : 60, plotIds: [], relations: [], stories: [] };
}
