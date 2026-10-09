/** Picks and prepares the house the tutorial is about: a willing owner with room for a new house. */
import type { Game } from './Game';
import { BUILDING, OWNED } from './LandGrid';
import type { Plot } from './types';

export function prepareTutorial(game: Game): Plot | null {
  const w = game.world;
  const b = w.map.bounds, cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
  const single = (p: Plot) => { const o = w.ownerOf(p); return o.kind === 'person' && o.plotIds.length === 1 && !o.holdout; };
  const candidates = w.plots
    .filter((p) => p.category === 'house' && single(p) && p.road && p.road.distance < 3)
    .sort((a, c) => Math.hypot(a.cx - cx, a.cy - cy) - Math.hypot(c.cx - cx, c.cy - cy))
    .slice(0, 60);
  for (const p of candidates) {
    const extra = p.area < 320 ? p.neighbors.map((id) => w.plot(id)!).find((n) => n.category === 'house' && single(n)) : undefined;
    const union = extra ? [p, extra] : [p];
    if (!fitsHouse(game, union)) continue;
    adopt(game, p, extra);
    game.scenario.tutorialPlot = p.id;
    if (extra) game.scenario.tutorialExtra = extra.id;
    return p;
  }
  return null;
}

/** Re-applies the tutorial owner's setup after loading a save (owners are regenerated). */
export function restoreTutorial(game: Game) {
  const id = game.scenario.tutorialPlot;
  const p = id ? game.world.plot(id) : undefined;
  if (!p) return;
  const extra = game.scenario.tutorialExtra ? game.world.plot(game.scenario.tutorialExtra) : undefined;
  adopt(game, p, extra);
}

/** Makes the owner friendly and gives them the neighbouring parcel so a house fits after demolition. */
function adopt(game: Game, p: Plot, extra?: Plot) {
  const w = game.world, o = w.ownerOf(p);
  if (extra && extra.ownerId !== o.id) {
    const prev = w.ownerOf(extra);
    prev.plotIds = prev.plotIds.filter((x) => x !== extra.id);
    extra.ownerId = o.id;
    o.plotIds.push(extra.id);
  }
  o.holdout = false;
  o.minFactor = 1.02;
  o.greed = Math.min(o.greed, 35);
  o.mood = Math.max(o.mood, 68);
}

/** Would a house fit on these parcels once they are bought and cleared? (Checked without changing anything.) */
function fitsHouse(game: Game, union: Plot[]): boolean {
  const w = game.world, f = w.grid.flags;
  const touched: [number, number][] = [];
  for (const q of union) w.forEachCell(q, (i) => { touched.push([i, f[i]]); f[i] = (f[i] | OWNED) & ~BUILDING; });
  let ok = false;
  try {
    for (const q of union) {
      const [x0, y0, x1, y1] = q.cellBox;
      for (let y = y0; y <= y1 && !ok; y += 2) for (let x = x0; x <= x1 && !ok; x += 2) {
        const wx = w.grid.minX + x + 0.5, wy = w.grid.minY + y + 0.5;
        const a = game.dev.roadAngle(wx, wy) ?? 0;
        const c = game.dev.buildingCheck('house', wx, wy, a);
        ok = c.ok || c.problem === 'money';
      }
    }
  } finally {
    for (const [i, v] of touched) f[i] = v;
  }
  return ok;
}
