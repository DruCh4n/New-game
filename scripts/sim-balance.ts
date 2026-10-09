/**
 * Balance check: a simple bot plays 6 in-game years on each difficulty and reports
 * cash, debt and net worth per year. Run: npm run sim
 */
import { readFile } from 'node:fs/promises';
import { World } from '../src/game/World.ts';
import { Game } from '../src/game/Game.ts';
import { acceptCounter, leave, listen, makeOffer, startVisit, canVisit } from '../src/game/negotiation.ts';
import { borrow, buildingsValue, creditLimit, debt, ownedLandValue, repay } from '../src/game/Economy.ts';
import type { BuildingTypeId } from '../src/game/catalog.ts';
import type { DifficultyId } from '../src/game/balance.ts';
import type { MapData } from '../src/shared/mapTypes.ts';

const map: MapData = JSON.parse(await readFile(new URL('../maps/sample-kampung.json', import.meta.url), 'utf8'));
const YEARS = Number(process.argv[2] ?? 6);
const MAX_PREMIUM = 1.55; // the bot will pay up to 155% of market value

/** patient = never fall back to small buildings; save and borrow for the first tower instead. */
function play(diff: DifficultyId, patient = false) {
  const g = new Game(new World(map), diff);
  const w = g.world;
  const start = g.money;
  // target: a residential area near the main road, ordered by distance from its centre
  const centre = w.plots.find((p) => p.category === 'house' && Math.hypot(p.cx - 100, p.cy - 120) < 60)!;
  const targets = w.plots
    .filter((p) => w.ownerOf(p).kind !== 'state' && Math.hypot(p.cx - centre.cx, p.cy - centre.cy) < 130)
    .sort((a, b) => Math.hypot(a.cx - centre.cx, a.cy - centre.cy) - Math.hypot(b.cx - centre.cx, b.cy - centre.cy));
  const skip = new Set<string>();
  const rows: string[] = [];
  let spentLand = 0, deals = 0, refusals = 0;

  /** Finds a valid spot first, borrows only if needed, then builds. */
  const tryPlace = (type: BuildingTypeId, mayBorrow: boolean) => {
    const c = g.dev.buildingCost(type);
    for (let r = 0; r < 130; r += 4) for (let a = 0; a < 6.28; a += 0.35) {
      const x = Math.round(centre.cx + Math.cos(a) * r), y = Math.round(centre.cy + Math.sin(a) * r);
      const ang = g.dev.roadAngle(x, y) ?? 0;
      const chk = g.dev.buildingCheck(type, x, y, ang);
      if (!chk.ok && chk.problem !== 'money') continue;
      if (g.money < c.cost) {
        const need = c.cost - g.money + 1;
        if (!mayBorrow || creditLimit(g) < need) return false;
        borrow(g, Math.min(need * 1.05, creditLimit(g)));
      }
      return g.placeBuilding(type, x, y, ang).ok;
    }
    return false;
  };

  const towerBusy = () => g.dev.buildings.some((x) => x.type === 'apartment' && (x.daysLeft > 0 || x.permitDays > 0));
  const towerCost = g.dev.buildingCost('apartment').cost;
  let needPlots = 14; // land for the current project (grows if the tower does not fit yet)
  let usedPlots = 0;
  for (let day = 0; day < YEARS * 365; day++) {
    const owned = targets.filter((t) => g.ownsPlot(t.id)).length;
    // ---- assemble land for the next tower from cash, keeping enough to start building
    const assembling = !towerBusy() && owned - usedPlots < needPlots;
    for (let v = 0; v < 2 && assembling; v++) {
      const p = targets.find((t) => !g.ownsPlot(t.id) && !skip.has(t.ownerId) && !canVisit(g, t).block);
      if (!p) break;
      if (g.money < p.value * 1.6) {
        // borrow for land only while there is still headroom left to build with
        const limit = creditLimit(g);
        const maxShare = patient && !g.dev.buildings.some((x) => x.type === 'apartment') ? 0.6 : 0.25;
        if (debt(g) > (limit + debt(g)) * maxShare || limit < p.value * 1.6) break;
        borrow(g, p.value * 1.6);
      }
      const s = startVisit(g, p);
      if (s.ended) continue;
      listen(g, s);
      const rec = g.record(p.ownerId);
      if (rec.log.some((e) => e.key === 'hint.holdout')) { skip.add(p.ownerId); leave(g, s); continue; }
      // promises cost nothing today: offer them to owners who want them
      const pref = rec.knownPreference;
      const opts = pref === 'apartment' || pref === 'shop' ? [pref] : [];
      let pct = opts.length ? 0.9 : 1.0;
      while (!s.ended) {
        const r = makeOffer(g, s, s.value * pct, opts);
        if (r === 'accepted') { deals++; spentLand += rec.lastOffer ?? 0; break; }
        if (r === 'refused') { skip.add(p.ownerId); refusals++; break; }
        if (s.askCash !== null && s.askCash <= s.value * MAX_PREMIUM && s.askCash <= g.money) {
          acceptCounter(g, s); deals++; spentLand += s.askCash; break;
        }
        pct += 0.12;
        if (pct > MAX_PREMIUM) { leave(g, s); break; }
      }
    }
    // ---- develop monthly: clear what we own, then build the best thing that fits
    if (g.date().getUTCDate() === 1) {
      for (const p of targets) if (g.ownsPlot(p.id) && g.dev.buildingState(p) === 'standing') g.demolish(p);
      const clearing = targets.some((t) => g.dev.buildingState(t) === 'demolishing');
      if (!towerBusy() && !clearing && owned - usedPlots >= needPlots && g.money + creditLimit(g) > towerCost) {
        if (tryPlace('apartment', true)) { usedPlots = owned; needPlots = 14; }
        else needPlots += 4; // not enough room yet: assemble more land
      } else if (!patient && !towerBusy() && !clearing && owned - usedPlots >= needPlots) {
        // can't afford a tower yet: start smaller with boarding houses and shophouses
        let built = 0;
        for (const type of ['kost', 'ruko', 'kost', 'kost'] as BuildingTypeId[]) if (tryPlace(type, true)) built++;
        if (built) usedPlots = owned;
      }
      // once a tower is under way, fill leftover land from spare cash
      if (towerBusy()) for (const type of ['kost', 'ruko', 'park'] as BuildingTypeId[]) {
        if (g.money > g.dev.buildingCost(type).cost * 1.5 + start * 0.1) tryPlace(type, false);
      }
      // repay loans when flush
      for (const l of [...g.loans]) if (g.money > l.principal * 1.5 + start * 0.1) repay(g, l.id, l.principal);
    }
    g.advanceDay();
    if ((day + 1) % 365 === 0) {
      const nw = g.money + ownedLandValue(g) + buildingsValue(g) - debt(g);
      rows.push(`  year ${(day + 1) / 365}: cash ${b(g.money)}  debt ${b(debt(g))}  net worth ${b(nw)} (${((nw / start) * 100).toFixed(0)}%)  ` +
        `plots ${w.plots.filter((p) => g.ownsPlot(p.id)).length}  buildings ${g.dev.buildings.length}  rep ${Math.round(g.reputation)}`);
    }
  }
  const counts = new Map<string, number>();
  for (const x of g.dev.buildings) counts.set(x.type, (counts.get(x.type) ?? 0) + 1);
  console.log(`\n${diff.toUpperCase()}${patient ? ' (patient)' : ''}: start cash ${b(start)}, ${deals} deals (avg ${b(spentLand / Math.max(1, deals))}), ${refusals} refusals, ${skip.size} skipped owners`);
  console.log(`  built: ${[...counts].map(([k, n]) => `${n}× ${k}`).join(', ')}`);
  for (const r of rows) console.log(r);
  const nw = g.money + ownedLandValue(g) + buildingsValue(g) - debt(g);
  return nw / start;
}

const b = (v: number) => `Rp ${(v / 1e9).toFixed(1)}B`;
const t0 = performance.now();
const result: Record<string, number> = {};
for (const d of ['easy', 'normal', 'hard'] as DifficultyId[]) result[d] = play(d);
console.log(`\nnet worth after ${YEARS} years, as a share of starting cash:`, Object.fromEntries(Object.entries(result).map(([k, v]) => [k, `${(v * 100).toFixed(0)}%`])), `(${((performance.now() - t0) / 1000).toFixed(0)} s)`);
