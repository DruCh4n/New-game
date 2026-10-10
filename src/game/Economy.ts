/**
 * Money over time: monthly income from buildings, maintenance, land tax, loans and promises.
 * Pure logic on top of Game so it can be tested in Node.
 */
import { buildingType } from './catalog';
import type { Game, Obligation } from './Game';
import type { NewBuilding } from './Development';
import { districtBonus } from './District';
import { BALANCE } from './balance';

export interface Loan {
  id: string;
  principal: number;
  /** Annual interest rate, fixed when borrowed. */
  rate: number;
  day: number;
}

export interface MonthReport {
  /** First day of the month that was closed (game day number). */
  day: number;
  income: { rent: number; leases: number; sales: number; oldBuildings: number };
  costs: { interest: number; maintenance: number; tax: number; overdraft: number };
  net: number;
  balance: number;
}

/** Days after which an unkept promise counts as broken. */
export const PROMISE_DAYS = BALANCE.promiseDays;

const r0 = (v: number) => Math.round(v);

// ------------------------------------------------------------------ assets & credit

/** Value of the land you own; plots under your finished buildings count at the redevelopment uplift. */
export function ownedLandValue(game: Game): number {
  const developed = developedPlots(game);
  let v = 0;
  for (const p of game.world.plots) if (game.ownsPlot(p.id)) v += p.landValue * (developed.has(p.index) ? BALANCE.developedLandUplift : 1);
  return v;
}

let devCache = { key: '', set: new Set<number>() };
/** Plot indices covered by your finished buildings. */
function developedPlots(game: Game): Set<number> {
  const done = game.dev.buildings.filter((b) => b.daysLeft === 0 && b.permitDays === 0);
  const key = `${game.world.seed}|${done.map((b) => b.id).join(',')}`;
  if (key === devCache.key) return devCache.set;
  const set = new Set<number>();
  const P = game.world.parcels;
  for (const b of done) game.world.grid.forPolygon(b.poly, (i) => { if (P[i] >= 0) set.add(P[i]); });
  devCache = { key, set };
  return set;
}

export function buildingsValue(game: Game): number {
  let v = 0;
  for (const b of game.dev.buildings) v += b.daysLeft > 0 ? b.cost * 0.5 * (1 - b.daysLeft / b.total) : b.cost;
  return v;
}

export function debt(game: Game): number {
  return game.loans.reduce((a, l) => a + l.principal, 0);
}

/** Banks lend against half your property plus a small unsecured line. */
export function creditLimit(game: Game): number {
  const base = game.world.region.landPerM2 * BALANCE.unsecuredCredit;
  const secured = BALANCE.loanToValue * (ownedLandValue(game) + buildingsValue(game));
  const repFactor = game.reputation < 25 ? 0.5 : 1;
  return Math.max(0, roundStep(game, (base + secured) * repFactor - debt(game)));
}

/** Annual interest: 7% for a reputable developer, up to ~16% for a disreputable one. */
export function loanRate(game: Game): number {
  const r = BALANCE.loanBaseRate + Math.max(0, 60 - game.reputation) * BALANCE.loanRatePerRepPoint + game.difficulty.loanRate;
  return Math.round(Math.max(0.02, r) * 1000) / 1000;
}

function roundStep(game: Game, v: number) {
  const s = game.world.region.priceStep;
  return Math.floor(v / s) * s;
}

export function borrow(game: Game, amount: number): Loan | null {
  amount = roundStep(game, amount);
  if (amount <= 0 || amount > creditLimit(game)) return null;
  const loan: Loan = { id: `L${game.day}_${game.loans.length + 1}`, principal: amount, rate: loanRate(game), day: game.day };
  game.loans.push(loan);
  game.addMoney(amount);
  return loan;
}

export function repay(game: Game, loanId: string, amount: number): number {
  const loan = game.loans.find((l) => l.id === loanId);
  if (!loan) return 0;
  const pay = Math.min(amount, loan.principal, Math.max(0, game.money));
  if (pay <= 0) return 0;
  loan.principal -= pay;
  game.addMoney(-pay);
  if (loan.principal <= 0) game.loans.splice(game.loans.indexOf(loan), 1);
  return pay;
}

// ------------------------------------------------------------------ demand & income

/** 0.6–1.2: reputation plus nearby parks, mosques, schools and halls you built. */
export function demand(game: Game, b: NewBuilding): number {
  let amenities = 0;
  for (const o of game.dev.buildings) {
    if (o === b || o.daysLeft > 0 || buildingType(o.type).income !== 'civic') continue;
    if (Math.hypot(o.cx - b.cx, o.cy - b.cy) < 250) amenities += 0.05;
  }
  return 0.6 + game.reputation / 250 + Math.min(0.2, amenities) + districtBonus(game, b);
}

/** Expected monthly income of a finished building at its current occupancy / sales pace. */
export function monthlyIncome(b: NewBuilding, incomeMult = 1): number {
  const bt = buildingType(b.type);
  if (b.daysLeft > 0 || b.permitDays > 0) return 0;
  if (bt.income === 'rent' || bt.income === 'lease') {
    const lettable = bt.units ? (bt.units - b.reserved) / bt.units : 1;
    return r0(((b.cost * bt.yield) / 12) * b.occupancy * lettable * incomeMult);
  }
  return 0;
}

/** Sale price of one apartment unit: total sales ≈ 1.7× construction cost. */
export function unitPrice(b: NewBuilding): number {
  const bt = buildingType(b.type);
  return r0((b.cost * BALANCE.apartmentSalesMultiple) / bt.units);
}

// ------------------------------------------------------------------ events

/** A building just finished: keep promises, open civic buildings. */
export function onBuildingFinished(game: Game, b: NewBuilding) {
  const bt = buildingType(b.type);
  if (bt.income === 'civic') {
    game.addReputation(bt.rep);
    game.toast({ kind: 'good', key: 'toast.civic', params: { buildingId: b.id, rep: bt.rep } });
    return;
  }
  if (bt.rep) game.addReputation(bt.rep);
  // Promised apartments go into apartment towers, promised shop units into malls and ruko rows.
  const kind: Obligation['kind'] | null = bt.style === 'apartment' ? 'apartment' : bt.style === 'mall' || bt.style === 'ruko' || bt.style === 'market' ? 'shop' : null;
  if (!kind) return;
  for (const ob of game.obligations) {
    if (ob.kind !== kind || ob.fulfilled !== undefined || ob.broken) continue;
    if (b.reserved >= bt.units) break;
    b.reserved++;
    ob.fulfilled = game.day;
    game.addReputation(1);
    game.toast({ kind: 'good', key: kind === 'apartment' ? 'toast.movedIn' : 'toast.shopOpened', params: { ownerId: ob.ownerId } });
  }
}

/** Runs on the first day of each month. */
export function closeMonth(game: Game): MonthReport {
  const income = { rent: 0, leases: 0, sales: 0, oldBuildings: 0 };
  const costs = { interest: 0, maintenance: 0, tax: 0, overdraft: 0 };

  for (const b of game.dev.buildings) {
    const bt = buildingType(b.type);
    if (b.daysLeft > 0 || b.permitDays > 0) { b.incomeLastMonth = 0; continue; }
    const d = demand(game, b);
    costs.maintenance += (b.cost * BALANCE.maintenance) / 12;
    if (bt.income === 'rent' || bt.income === 'lease') {
      const target = Math.min(0.97, 0.45 + 0.45 * d);
      b.occupancy = Math.min(target, b.occupancy + 0.12 * d);
      const v = monthlyIncome(b, game.difficulty.income);
      if (bt.income === 'rent') income.rent += v;
      else income.leases += v;
      b.incomeLastMonth = v;
    } else if (bt.income === 'sale') {
      const left = bt.units - b.reserved - b.unitsSold;
      const sold = Math.min(left, Math.max(left > 0 ? 1 : 0, Math.round(bt.units * BALANCE.apartmentSalesPace * d)));
      b.unitsSold += sold;
      const v = Math.round(sold * unitPrice(b) * game.difficulty.income);
      income.sales += v;
      b.incomeLastMonth = v;
    } else {
      b.incomeLastMonth = 0;
    }
  }

  // Old houses you bought but haven't demolished are rented out cheaply.
  for (const p of game.world.plots) {
    if (!game.ownsPlot(p.id)) continue;
    costs.tax += (p.landValue * BALANCE.landTax) / 12;
    if (p.kind === 'building' && game.dev.buildingState(p) === 'standing') income.oldBuildings += (p.buildingValue * 0.08 + p.landValue * 0.01) / 12;
  }

  for (const l of game.loans) costs.interest += (l.principal * l.rate) / 12;
  if (game.money < 0) {
    costs.overdraft = (-game.money * 0.24) / 12;
    game.addReputation(-1);
    game.toast({ kind: 'bad', key: 'toast.overdraft' });
  }

  // Promises not kept within two years are broken.
  for (const ob of game.obligations) {
    if (ob.fulfilled !== undefined || ob.broken || game.day - ob.day < PROMISE_DAYS) continue;
    ob.broken = true;
    game.addReputation(-5);
    game.toast({ kind: 'bad', key: 'toast.brokenPromise', params: { ownerId: ob.ownerId } });
  }

  for (const k of Object.keys(income) as (keyof typeof income)[]) income[k] = r0(income[k]);
  for (const k of Object.keys(costs) as (keyof typeof costs)[]) costs[k] = r0(costs[k]);
  const net = income.rent + income.leases + income.sales + income.oldBuildings - costs.interest - costs.maintenance - costs.tax - costs.overdraft;
  game.addMoney(net);
  const report: MonthReport = { day: game.day, income, costs, net, balance: game.money };
  game.reports.push(report);
  if (game.reports.length > 120) game.reports.shift();
  return report;
}
