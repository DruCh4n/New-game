/**
 * Scenarios, objectives, win/lose conditions and the end-of-game score.
 * Everything here is map-independent, so every scenario works on imported maps too.
 */
import type { Game } from './Game';
import { buildingType, type BuildingTypeId } from './catalog';
import { buildingsValue, debt, ownedLandValue } from './Economy';
import { districtStats, largestOwnedArea } from './District';
import type { DifficultyId } from './balance';

export type ScenarioId = 'tutorial' | 'ruko' | 'tower' | 'renewal' | 'district' | 'sandbox';

export type Objective =
  | { kind: 'buildings'; types: BuildingTypeId[]; count: number }
  | { kind: 'homes'; count: number }
  | { kind: 'reputation'; min: number }
  | { kind: 'ownArea'; m2: number }
  | { kind: 'balance'; min: number }
  | { kind: 'netWorth'; multiple: number }
  | { kind: 'noBrokenPromises' }
  | { kind: 'plots'; count: number };

export interface Scenario {
  id: ScenarioId;
  icon: string;
  difficulty: DifficultyId;
  /** Days to complete the objectives (0 = no limit). */
  days: number;
  objectives: Objective[];
  /** Multiplies the difficulty's starting cash. */
  cash?: number;
  reputation?: number;
  tutorial?: boolean;
}

export const SCENARIOS: Scenario[] = [
  { id: 'tutorial', icon: '🎓', difficulty: 'easy', days: 0, tutorial: true,
    objectives: [{ kind: 'plots', count: 1 }, { kind: 'buildings', types: ['house', 'kost', 'ruko'], count: 1 }] },
  { id: 'ruko', icon: '🏪', difficulty: 'easy', days: 730,
    objectives: [{ kind: 'buildings', types: ['ruko'], count: 2 }, { kind: 'reputation', min: 40 }] },
  { id: 'tower', icon: '🏢', difficulty: 'normal', days: 1095,
    objectives: [{ kind: 'buildings', types: ['apartment'], count: 1 }, { kind: 'noBrokenPromises' }] },
  { id: 'renewal', icon: '🏘', difficulty: 'normal', days: 1825,
    objectives: [{ kind: 'homes', count: 300 }, { kind: 'reputation', min: 60 }] },
  { id: 'district', icon: '🗺', difficulty: 'hard', days: 2190,
    objectives: [{ kind: 'ownArea', m2: 20000 }, { kind: 'balance', min: 0.7 }, { kind: 'netWorth', multiple: 2 }] },
  { id: 'sandbox', icon: '🏝', difficulty: 'normal', days: 0, objectives: [] },
];

export function scenario(id: ScenarioId): Scenario {
  return SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[SCENARIOS.length - 1];
}

/** Number of guided tutorial steps (see ui/tutorial.ts). */
export const TUTORIAL_STEPS = 12;

export type Outcome = 'playing' | 'won' | 'lost' | 'retired';
export type LossReason = 'bankrupt' | 'reputation' | 'deadline';

export interface ScenarioState {
  id: ScenarioId;
  startCash: number;
  outcome: Outcome;
  reason?: LossReason;
  endDay?: number;
  /** Consecutive month-ends with negative cash / with reputation under 5. */
  overdueMonths: number;
  lowRepMonths: number;
  /** Tutorial progress (step index) and the plot the tutorial is about. */
  tutorialStep: number;
  tutorialPlot?: string;
  tutorialExtra?: string;
  /** After an ending the player may keep playing freely. */
  continued: boolean;
}

export function newScenarioState(game: Game, id: ScenarioId): ScenarioState {
  const sc = scenario(id);
  if (sc.cash) game.money = Math.round(game.money * sc.cash);
  if (sc.reputation !== undefined) game.reputation = sc.reputation;
  return { id, startCash: game.money, outcome: 'playing', overdueMonths: 0, lowRepMonths: 0, tutorialStep: 0, continued: false };
}

// ------------------------------------------------------------------ measures

/** Households living in what you built (sold or promised apartments, let kost rooms, houses, ruko flats). */
export function homesProvided(game: Game): number {
  let n = 0;
  for (const b of game.dev.buildings) {
    if (b.daysLeft > 0 || b.permitDays > 0) continue;
    const bt = buildingType(b.type);
    if (b.type === 'apartment') n += b.unitsSold + b.reserved;
    else if (b.type === 'kost') n += Math.round(bt.units * b.occupancy);
    else if (b.type === 'house') n += 1;
    else if (b.type === 'ruko') n += bt.units; // families live above the shops
  }
  return n;
}

export function netWorth(game: Game): number {
  return game.money + ownedLandValue(game) + buildingsValue(game) - debt(game);
}

export interface ObjectiveProgress { objective: Objective; value: number; target: number; done: boolean }

export function progress(game: Game, o: Objective, start: number): ObjectiveProgress {
  const finished = (types: BuildingTypeId[]) => game.dev.buildings.filter((b) => types.includes(b.type) && b.daysLeft === 0 && b.permitDays === 0).length;
  switch (o.kind) {
    case 'buildings': { const v = finished(o.types); return { objective: o, value: v, target: o.count, done: v >= o.count }; }
    case 'homes': { const v = homesProvided(game); return { objective: o, value: v, target: o.count, done: v >= o.count }; }
    case 'reputation': return { objective: o, value: Math.round(game.reputation), target: o.min, done: game.reputation >= o.min };
    case 'ownArea': { const v = largestOwnedArea(game); return { objective: o, value: v, target: o.m2, done: v >= o.m2 }; }
    case 'balance': { const v = game.districtUnlocked ? districtStats(game).balance : 0; return { objective: o, value: Math.round(v * 100), target: Math.round(o.min * 100), done: v >= o.min }; }
    case 'netWorth': { const v = netWorth(game); return { objective: o, value: v, target: start * o.multiple, done: v >= start * o.multiple }; }
    case 'noBrokenPromises': { const broken = game.obligations.filter((x) => x.broken).length; return { objective: o, value: broken, target: 0, done: broken === 0 }; }
    case 'plots': { const v = game.world.plots.filter((p) => game.ownsPlot(p.id)).length; return { objective: o, value: v, target: o.count, done: v >= o.count }; }
  }
}

export function allProgress(game: Game): ObjectiveProgress[] {
  const st = game.scenario;
  return scenario(st.id).objectives.map((o) => progress(game, o, st.startCash));
}

// ------------------------------------------------------------------ rules

/** Monthly checks: bankruptcy and being run out of town. */
export function monthlyRules(game: Game) {
  const st = game.scenario;
  if (st.outcome !== 'playing' || st.continued) return;
  st.overdueMonths = game.money < 0 ? st.overdueMonths + 1 : 0;
  st.lowRepMonths = game.reputation < 5 ? st.lowRepMonths + 1 : 0;
  if (st.overdueMonths >= 3) end(game, 'lost', 'bankrupt');
  else if (st.lowRepMonths >= 6) end(game, 'lost', 'reputation');
}

/** Checks objectives and the deadline (call regularly, e.g. weekly and after big events). */
export function checkObjectives(game: Game) {
  const st = game.scenario;
  const sc = scenario(st.id);
  if (st.outcome !== 'playing' || st.continued || !sc.objectives.length) return;
  if (sc.tutorial && st.tutorialStep < TUTORIAL_STEPS) return; // finish the guided steps first
  // the "no broken promises" objective is only judged at the end, so check the others first
  const prog = allProgress(game);
  const winNow = prog.every((p) => p.done);
  if (winNow) return end(game, 'won');
  if (sc.days && game.day >= sc.days) end(game, 'lost', 'deadline');
}

export function retire(game: Game) {
  if (game.scenario.outcome === 'playing') end(game, 'retired');
}

function end(game: Game, outcome: Outcome, reason?: LossReason) {
  const st = game.scenario;
  st.outcome = outcome;
  if (reason) st.reason = reason;
  st.endDay = game.day;
  game.emit('scenario');
}

/** Keep playing after an ending, as free play. */
export function continuePlaying(game: Game) {
  game.scenario.continued = true;
  game.emit('scenario');
}

// ------------------------------------------------------------------ score

export interface ScoreLine { key: string; points: number; detail?: string | number }
export interface Score { total: number; rank: string; lines: ScoreLine[] }

export function computeScore(game: Game): Score {
  const st = game.scenario;
  const sc = scenario(st.id);
  const lines: ScoreLine[] = [];
  const nw = netWorth(game);
  lines.push({ key: 'wealth', points: Math.round(Math.max(0, Math.min(10, nw / st.startCash)) * 1000), detail: `${Math.round((nw / st.startCash) * 100)}%` });
  lines.push({ key: 'reputation', points: Math.round(game.reputation * 10), detail: Math.round(game.reputation) });
  const homes = homesProvided(game);
  lines.push({ key: 'homes', points: homes * 5, detail: homes });
  const kept = game.obligations.filter((o) => o.fulfilled !== undefined).length;
  const broken = game.obligations.filter((o) => o.broken).length;
  if (kept || broken) lines.push({ key: 'promises', points: kept * 50 - broken * 150, detail: `${kept} / ${broken}` });
  if (game.districtUnlocked) {
    const bal = districtStats(game).balance;
    lines.push({ key: 'district', points: Math.round(bal * 500), detail: `${Math.round(bal * 100)}%` });
  }
  const done = allProgress(game).filter((p) => p.done).length;
  if (sc.objectives.length) lines.push({ key: 'objectives', points: done * 500, detail: `${done}/${sc.objectives.length}` });
  if (st.outcome === 'won') {
    const left = sc.days ? Math.max(0, sc.days - (st.endDay ?? game.day)) : 0;
    lines.push({ key: 'victory', points: 1000 + Math.round((left / 365) * 300), detail: left ? `${left}` : undefined });
  }
  if (st.outcome === 'lost' && st.reason === 'bankrupt') lines.push({ key: 'bankrupt', points: -1500 });
  const mult = game.difficulty.id === 'hard' ? 1.3 : game.difficulty.id === 'easy' ? 0.8 : 1;
  const raw = lines.reduce((a, l) => a + l.points, 0);
  const total = Math.max(0, Math.round(raw * mult));
  if (mult !== 1) lines.push({ key: 'difficulty', points: total - raw, detail: `×${mult}` });
  const rank = total < 1500 ? 'beginner' : total < 3000 ? 'juragan' : total < 5000 ? 'developer' : total < 8000 ? 'tycoon' : 'citybuilder';
  return { total, rank, lines };
}

// ------------------------------------------------------------------ local high scores

export interface HighScore { scenario: ScenarioId; map: string; difficulty: DifficultyId; score: number; rank: string; outcome: Outcome; date: string }
const HS_KEY = 'kotabaru.scores';

export function highScores(): HighScore[] {
  try { return JSON.parse(localStorage.getItem(HS_KEY) ?? '[]') as HighScore[]; } catch { return []; }
}

export function recordScore(h: HighScore) {
  try {
    const all = [...highScores(), h].sort((a, b) => b.score - a.score).slice(0, 30);
    localStorage.setItem(HS_KEY, JSON.stringify(all));
  } catch { /* storage unavailable */ }
}
