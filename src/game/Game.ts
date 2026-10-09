import type { World } from './World';
import { START_YEAR } from './owners';
import type { Owner, PlotStatus } from './types';
import type { DealOption, LogEntry, Session } from './negotiation';
import { Development, type Check } from './Development';
import type { BuildingTypeId, RoadTypeId } from './catalog';
import type { FlatPoints } from '../shared/mapTypes';
import type { Plot } from './types';
import { closeMonth, onBuildingFinished, type Loan, type MonthReport } from './Economy';
import { buildingType, needsPermit } from './catalog';
import { checkUnlock, permitFactor } from './District';

export type Speed = 0 | 1 | 2 | 4;
/** Real seconds per in-game day at 1× speed. */
export const SECONDS_PER_DAY = 1.5;

/** Per-owner negotiation memory (persists across visits). */
export interface OwnerRecord {
  visits: number;
  log: LogEntry[];
  /** No meetings before this day. */
  cooldownUntil: number;
  /** Raised when neighbours got generous deals (they expect the same). */
  expectationBoost: number;
  /** Lowered price after successful pressure; decays over time. */
  pressureDiscount: number;
  insults: number;
  /** A holdout or institution has told you no for good. */
  finalRefusal: boolean;
  /** Learned by listening: the deal option they value most. */
  knownPreference?: DealOption | 'cash';
  lastOffer?: number;
  lastAsk?: number;
}

export interface Obligation {
  ownerId: string;
  kind: 'apartment' | 'shop';
  day: number;
  /** Day the promise was kept. */
  fulfilled?: number;
  broken?: boolean;
}

export interface Toast {
  kind: 'good' | 'bad' | 'info';
  /** UI string key; params may include ownerId, resolved to a name by the UI. */
  key: string;
  params?: Record<string, string | number>;
}

export type GameEvent = 'day' | 'money' | 'status' | 'session' | 'speed' | 'dev' | 'month';

/** Mutable game state on top of the generated World. */
export class Game {
  day = 0;
  money: number;
  reputation = 50;
  speed: Speed = 1;
  session: Session | null = null;
  readonly records = new Map<string, OwnerRecord>();
  readonly soldOwners = new Set<string>();
  readonly obligations: Obligation[] = [];
  readonly dev: Development;
  readonly loans: Loan[] = [];
  /** District zoning per land cell (0 none, 1 residential, 2 commercial, 3 green). */
  readonly zones: Uint8Array;
  zoneVersion = 0;
  districtUnlocked = false;
  readonly reports: MonthReport[] = [];
  private acc = 0;
  private speedBeforeTalk: Speed = 1;
  private listeners = new Set<(e: GameEvent) => void>();
  private toastListeners = new Set<(t: Toast) => void>();

  constructor(readonly world: World) {
    const r = world.region;
    this.money = Math.round((r.landPerM2 * 6000) / r.priceStep) * r.priceStep;
    this.dev = new Development(world, () => this.money);
    this.zones = new Uint8Array(world.grid.w * world.grid.h);
    this.dev.onChange = (_e, detail) => {
      if (detail?.kind === 'building') {
        this.toast({ kind: 'good', key: 'toast.built', params: { buildingId: detail.id } });
        const b = this.dev.buildings.find((x) => x.id === detail.id);
        if (b) onBuildingFinished(this, b);
      }
      if (detail?.kind === 'permit') this.toast({ kind: 'info', key: 'toast.permit', params: { buildingId: detail.id } });
      if (detail?.kind === 'demolition') this.toast({ kind: 'info', key: 'toast.demolished', params: { plotId: detail.id } });
      if (detail?.kind === 'road') this.toast({ kind: 'info', key: 'toast.roadDone' });
      this.emit('dev');
    };
  }

  // ----- development (money handled here) -----
  demolish(plot: Plot): Check {
    const c = this.dev.demolitionCheck(plot, this.ownsPlot(plot.id));
    if (!c.ok) return c;
    this.addMoney(-c.cost);
    this.dev.startDemolition(plot, c.days);
    return c;
  }

  buildRoad(line: FlatPoints, type: RoadTypeId): Check {
    const c = this.dev.roadCheck(line, type);
    if (!c.ok) return c;
    this.addMoney(-c.cost);
    this.dev.buildRoad(line, type, c);
    return c;
  }

  /** Permit wait in days for a building type, or null if the city refuses (poor reputation). */
  permitDays(type: BuildingTypeId): number | null {
    if (!needsPermit(buildingType(type))) return 0;
    if (this.reputation < 25) return null;
    return Math.round(7 + (100 - this.reputation) * 0.35);
  }

  placeBuilding(type: BuildingTypeId, cx: number, cy: number, angle: number): Check {
    const c = this.dev.buildingCheck(type, cx, cy, angle);
    if (!c.ok) return c;
    let permit = this.permitDays(type);
    if (permit === null) return { ...c, ok: false, problem: 'permit' };
    permit = Math.round(permit * permitFactor(this, cx, cy));
    this.addMoney(-c.cost);
    this.dev.placeBuilding(type, cx, cy, angle, c, permit);
    return c;
  }

  // ----- events -----
  on(f: (e: GameEvent) => void) { this.listeners.add(f); return () => this.listeners.delete(f); }
  onToast(f: (t: Toast) => void) { this.toastListeners.add(f); return () => this.toastListeners.delete(f); }
  emit(e: GameEvent) { this.listeners.forEach((f) => f(e)); }
  toast(t: Toast) { this.toastListeners.forEach((f) => f(t)); }

  // ----- time -----
  date(day = this.day): Date {
    return new Date(Date.UTC(START_YEAR, 0, 1 + day));
  }

  setSpeed(s: Speed) {
    this.speed = s;
    this.emit('speed');
  }

  /** Pause while talking; restore afterwards. */
  pauseForTalk(paused: boolean) {
    if (paused) {
      if (this.speed !== 0) this.speedBeforeTalk = this.speed;
      this.setSpeed(0);
    } else if (this.speed === 0) {
      this.setSpeed(this.speedBeforeTalk || 1);
    }
  }

  tick(dtSeconds: number) {
    if (!this.speed) return;
    this.acc += dtSeconds * this.speed;
    while (this.acc >= SECONDS_PER_DAY) {
      this.acc -= SECONDS_PER_DAY;
      this.advanceDay();
    }
  }

  advanceDay() {
    this.day++;
    for (const o of this.world.owners) {
      // moods drift back toward neutral
      if (o.mood < 50) o.mood = Math.min(50, o.mood + 1);
      else if (o.mood > 55) o.mood -= 0.5;
    }
    for (const r of this.records.values()) r.pressureDiscount = Math.max(0, r.pressureDiscount - 0.004);
    this.dev.advanceDay();
    if (this.date().getUTCDate() === 1) {
      const report = closeMonth(this);
      this.emit('month');
      this.toast({ kind: report.net >= 0 ? 'good' : 'bad', key: 'toast.month', params: { price: report.net } });
    }
    this.emit('day');
  }

  // ----- state helpers -----
  record(ownerId: string): OwnerRecord {
    let r = this.records.get(ownerId);
    if (!r) {
      r = { visits: 0, log: [], cooldownUntil: 0, expectationBoost: 0, pressureDiscount: 0, insults: 0, finalRefusal: false };
      this.records.set(ownerId, r);
    }
    return r;
  }

  setStatus(plotIds: string[], s: PlotStatus) {
    for (const id of plotIds) {
      if (this.world.statusOf(id) === 'sold') continue;
      this.world.status.set(id, s);
    }
    if (s === 'sold') {
      this.dev.onPlotsSold(plotIds);
      checkUnlock(this);
    }
    this.emit('status');
  }

  addMoney(delta: number) {
    this.money += delta;
    this.emit('money');
  }

  addReputation(delta: number) {
    this.reputation = Math.max(0, Math.min(100, Math.round((this.reputation + delta) * 10) / 10));
    this.emit('money');
  }

  changeMood(o: Owner, delta: number) {
    o.mood = Math.max(0, Math.min(100, o.mood + delta));
  }

  ownsPlot(plotId: string) {
    return this.world.statusOf(plotId) === 'sold';
  }
}
