/**
 * Save games: a compact JSON snapshot of everything that changed since the world was generated.
 * The world itself (plots, owners) is regenerated deterministically from the map.
 */
import type { MapData } from '../shared/mapTypes';
import { World } from './World';
import { Game, type Obligation, type OwnerRecord } from './Game';
import type { DevSave } from './Development';
import type { Loan, MonthReport } from './Economy';
import type { PlotStatus } from './types';
import { decodeZones, encodeZones } from './District';
import type { DifficultyId } from './balance';
import type { ScenarioState } from './scenarios';
import type { Meeting } from './meeting';
import type { PapersSave } from './papers';

export const SAVE_FORMAT = 'kotabaru-save';
export const SAVE_VERSION = 1;

export interface SaveData {
  format: typeof SAVE_FORMAT;
  version: number;
  savedAt: string;
  /** Bundled map key (file name without .json), or "file:<name>" for a map opened from disk. */
  mapKey: string;
  mapName: string;
  seed: number;
  day: number;
  money: number;
  reputation: number;
  status: [string, PlotStatus][];
  soldOwners: string[];
  /** Owner moods ×2 as base64 bytes, in World.owners order. */
  moods: string;
  records: [string, OwnerRecord][];
  obligations: Obligation[];
  loans: Loan[];
  reports: MonthReport[];
  dev: DevSave;
  /** Added in Milestone 6 (optional so older saves still load). */
  districtUnlocked?: boolean;
  /** Added in Milestone 7. */
  difficulty?: DifficultyId;
  zones?: number[];
  /** Added in Milestone 8. */
  scenario?: ScenarioState;
  /** Added in Milestone 9. */
  meetings?: Meeting[];
  /** Added in Milestone 10. */
  papers?: PapersSave;
}

export function serialize(game: Game, mapKey: string): SaveData {
  const w = game.world;
  const moods = new Uint8Array(w.owners.map((o) => Math.round(o.mood * 2)));
  return {
    format: SAVE_FORMAT,
    version: SAVE_VERSION,
    savedAt: new Date().toISOString(),
    mapKey,
    mapName: w.map.name,
    seed: w.seed,
    day: game.day,
    money: game.money,
    reputation: game.reputation,
    status: [...w.status.entries()],
    soldOwners: [...game.soldOwners],
    moods: toBase64(moods),
    records: [...game.records.entries()],
    obligations: game.obligations,
    loans: game.loans,
    reports: game.reports,
    dev: game.dev.serialize(),
    districtUnlocked: game.districtUnlocked,
    difficulty: game.difficulty.id,
    scenario: game.scenario,
    meetings: game.meetings,
    papers: game.papers.serialize(),
    zones: encodeZones(game.zones),
  };
}

export function isSaveData(v: unknown): v is SaveData {
  const s = v as SaveData;
  return !!s && s.format === SAVE_FORMAT && typeof s.version === 'number' && typeof s.mapKey === 'string';
}

/** Rebuilds a Game from a save and the map it was played on. */
export function restore(save: SaveData, map: MapData): Game {
  if (save.version > SAVE_VERSION) throw new Error('save was made by a newer version of the game');
  const world = new World(map, save.seed);
  const game = new Game(world, save.difficulty ?? 'normal');
  game.day = save.day;
  game.money = save.money;
  game.reputation = save.reputation;
  for (const [id, st] of save.status) world.status.set(id, st);
  game.dev.onPlotsSold(save.status.filter(([, st]) => st === 'sold').map(([id]) => id));
  for (const id of save.soldOwners) game.soldOwners.add(id);
  const moods = fromBase64(save.moods);
  world.owners.forEach((o, i) => { if (i < moods.length) o.mood = moods[i] / 2; });
  for (const [id, rec] of save.records) game.records.set(id, rec);
  game.obligations.push(...save.obligations);
  game.loans.push(...save.loans);
  game.reports.push(...save.reports);
  game.dev.restore(save.dev);
  game.districtUnlocked = !!save.districtUnlocked;
  if (save.zones) decodeZones(save.zones, game.zones);
  if (save.scenario) game.scenario = { ...save.scenario };
  if (save.meetings) game.meetings.push(...save.meetings);
  if (save.papers) game.papers.restore(save.papers);
  game.speed = 0; // start paused after loading
  return game;
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
