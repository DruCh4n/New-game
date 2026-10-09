/**
 * Group meetings (musyawarah): invite several owners at once and make one offer to everyone.
 * Each owner still decides alone, but people follow their family, friends and the RT head.
 */
import { Rng, hashString } from '../util/random';
import type { Game } from './Game';
import type { Owner } from './types';
import {
  canVisit, immediateCost, minimumPrice, perceivedValue, settle, acceptKey, preferredOption,
  type DealOption, type LogEntry,
} from './negotiation';

export type Answer = 'none' | 'yes' | 'maybe' | 'no' | 'absent';

export interface Meeting {
  id: string;
  day: number;
  ownerIds: string[];
  log: LogEntry[];
  read: number;
  /** Owners who signed at this meeting. */
  sold: string[];
}

export interface MeetingSession {
  meeting: Meeting;
  /** Unsold plots per attending owner. */
  plots: Record<string, string[]>;
  values: Record<string, number>;
  answers: Record<string, Answer>;
  /** What each "yes" agreed to. */
  deals: Record<string, { cash: number; opts: DealOption[] }>;
  /** Asking price of each "maybe". */
  asks: Record<string, { cash: number; opts: DealOption[] }>;
  spokesperson: string;
  round: number;
  patience: number;
  presented: boolean;
  listened: boolean;
  funded: boolean;
  ended: boolean;
  outcome?: 'sold' | 'left' | 'tired';
}

export const MAX_ATTENDEES = 10;

const isRt = (o: Owner) => o.stories.some((s) => s.key === 'rtHead');

function rng(game: Game, tag: string, round: number) {
  return new Rng(hashString(`${tag}|${game.day}|${round}|${game.world.seed}`));
}

/** Private owners (not state, not already sold) behind a set of plots. */
export function meetingCandidates(game: Game, plotIds: string[]): Owner[] {
  const seen = new Map<string, Owner>();
  for (const id of plotIds) {
    const p = game.world.plot(id);
    if (!p || game.ownsPlot(id)) continue;
    const o = game.world.ownerOf(p);
    if (o.kind === 'state') continue;
    seen.set(o.id, o);
  }
  return [...seen.values()];
}

function say(game: Game, m: MeetingSession, o: Owner, key: string, params?: LogEntry['params']) {
  const v = rng(game, `${o.id}|${key}`, m.round).int(0, 9999);
  const e: LogEntry = { day: game.day, who: 'owner', key, v, by: o.id, ...(params ? { params } : {}) };
  m.meeting.log.push(e);
  const rec = game.record(o.id);
  rec.log.push({ day: game.day, who: 'owner', key, v, ...(params ? { params } : {}) });
  rec.read = rec.log.length;
}

function act(game: Game, m: MeetingSession, key: string, params?: LogEntry['params'], opts?: DealOption[]) {
  m.meeting.log.push({ day: game.day, who: 'player', key, ...(params ? { params } : {}), ...(opts ? { opts } : {}) });
}

function note(game: Game, m: MeetingSession, key: string, params?: LogEntry['params']) {
  m.meeting.log.push({ day: game.day, who: 'system', key, ...(params ? { params } : {}) });
}

const owner = (game: Game, id: string) => game.world.owner(id)!;
const attending = (m: MeetingSession) => Object.keys(m.answers).filter((id) => m.answers[id] !== 'absent');

export function startMeeting(game: Game, plotIds: string[]): MeetingSession | null {
  const owners = meetingCandidates(game, plotIds).slice(0, MAX_ATTENDEES);
  if (owners.length < 2) return null;
  const meeting: Meeting = { id: `m${game.day}_${game.meetings.length}`, day: game.day, ownerIds: owners.map((o) => o.id), log: [], read: 0, sold: [] };
  game.meetings.push(meeting);
  if (game.meetings.length > 30) game.meetings.splice(0, game.meetings.length - 30);
  const m: MeetingSession = {
    meeting, plots: {}, values: {}, answers: {}, deals: {}, asks: {}, spokesperson: owners[0].id,
    round: 0, patience: 3 + (game.reputation >= 60 ? 1 : 0), presented: false, listened: false, funded: false, ended: false,
  };
  game.meetingSession = m;
  note(game, m, 'system.meeting', { n: owners.length });
  const absent: string[] = [];
  for (const o of owners) {
    m.plots[o.id] = o.plotIds.filter((id) => !game.ownsPlot(id));
    m.values[o.id] = m.plots[o.id].reduce((a, id) => a + game.world.plot(id)!.value, 0);
    const plot = game.world.plot(m.plots[o.id][0])!;
    const blocked = canVisit(game, plot).block || o.mood < 15;
    m.answers[o.id] = blocked ? 'absent' : 'none';
    const rec = game.record(o.id);
    rec.log.push({ day: game.day, who: 'system', key: 'system.meetingPersonal', params: { n: owners.length } });
    if (blocked) absent.push(o.name);
    else { rec.visits++; game.setStatus(m.plots[o.id], rec.finalRefusal ? 'refused' : 'negotiating'); }
  }
  const present = attending(m).map((id) => owner(game, id));
  if (absent.length) note(game, m, 'system.absent', { names: absent.join(', ') });
  if (present.length < 2) {
    note(game, m, 'system.meetingFailed');
    endMeeting(game, m, 'left');
    return m;
  }
  // the RT head chairs; otherwise the oldest person
  const chair = present.find(isRt) ?? [...present].sort((a, b) => (b.age ?? 0) - (a.age ?? 0))[0];
  m.spokesperson = chair.id;
  say(game, m, chair, isRt(chair) ? 'meet.open.rt' : 'meet.open');
  const grumblers = present.filter((o) => o !== chair && o.mood < 38).slice(0, 2);
  for (const o of grumblers) say(game, m, o, 'meet.grumble');
  if (!grumblers.length) {
    const warm = present.find((o) => o !== chair && o.mood >= 62);
    if (warm) say(game, m, warm, 'meet.hopeful');
  }
  return m;
}

/** Explain the project to everyone (once). */
export function presentPlan(game: Game, m: MeetingSession) {
  if (m.ended || m.presented) return;
  m.presented = true;
  act(game, m, 'player.present');
  const d = game.reputation >= 60 ? 5 : game.reputation >= 40 ? 2 : -3;
  for (const id of attending(m)) game.changeMood(owner(game, id), d + (owner(game, id).attachment > 70 ? -2 : 0));
  say(game, m, owner(game, m.spokesperson), d > 0 ? 'meet.present.good' : 'meet.present.bad');
}

/** Let everyone voice what they need (once). Reveals each owner's preference. */
export function listenAll(game: Game, m: MeetingSession) {
  if (m.ended || m.listened) return;
  m.listened = true;
  act(game, m, 'player.listenAll');
  const ids = attending(m);
  ids.forEach((id, i) => {
    const o = owner(game, id);
    const pref = preferredOption(game, o);
    game.record(id).knownPreference = pref;
    game.changeMood(o, 3);
    if (i < 5) say(game, m, o, o.holdout ? 'hint.holdout' : `hint.${pref}`);
  });
  if (ids.length > 5) note(game, m, 'system.moreSpoke', { n: ids.length - 5 });
}

export function fundCost(game: Game, m: MeetingSession): number {
  const total = attending(m).reduce((a, id) => a + m.values[id], 0);
  const step = game.world.region.priceStep;
  return Math.max(step, Math.round((total * 0.01) / step) * step);
}

/** A contribution to the kampung (mosque repairs, a road, a celebration). */
export function communityFund(game: Game, m: MeetingSession): boolean {
  if (m.ended || m.funded) return false;
  const cost = fundCost(game, m);
  if (game.money < cost) return false;
  m.funded = true;
  game.addMoney(-cost);
  act(game, m, 'player.fund', { cost });
  for (const id of attending(m)) game.changeMood(owner(game, id), 7);
  game.addReputation(1);
  say(game, m, owner(game, m.spokesperson), 'meet.fund');
  return true;
}

const priceOf = (game: Game, value: number, pct: number) => {
  const step = game.world.region.priceStep;
  return Math.max(step, Math.round((value * pct) / 100 / step) * step);
};

/** Cash due now if every undecided owner accepted this offer. */
export function offerPayNow(game: Game, m: MeetingSession, pct: number, opts: DealOption[]): number {
  let sum = 0;
  for (const id of attending(m)) {
    if (m.answers[id] === 'yes') sum += immediateCost(game, m.values[id], m.deals[id].cash, m.deals[id].opts);
    else sum += immediateCost(game, m.values[id], priceOf(game, m.values[id], pct), opts);
  }
  return sum;
}

/** Same offer (a % of each owner's market value, plus options) to everyone who hasn't said yes. */
export function offerAll(game: Game, m: MeetingSession, pct: number, opts: DealOption[]): boolean {
  if (m.ended || m.patience <= 0) return false;
  m.round++;
  m.patience--;
  act(game, m, 'player.offerAll', { pct }, opts);
  const step = game.world.region.priceStep;
  const ids = attending(m).filter((id) => m.answers[id] !== 'yes');
  // the most willing decide first; family, friends and the chair pull others along
  const scored = ids.map((id) => {
    const o = owner(game, id);
    const cash = priceOf(game, m.values[id], pct);
    const perceived = perceivedValue(game, o, m.values[id], cash, opts);
    return { o, cash, perceived, min: minimumPrice(game, o, m.values[id]) };
  }).sort((a, b) => b.perceived / b.min - a.perceived / a.min);
  const yesIds = new Set(attending(m).filter((id) => m.answers[id] === 'yes'));
  let spoken = 0;
  let insults = 0;
  for (const r of scored) {
    const { o } = r;
    let herd = 1;
    for (const rel of o.relations) {
      if (!yesIds.has(rel.ownerId)) continue;
      herd *= rel.kind === 'family' ? 0.95 : rel.kind === 'friend' ? 0.97 : rel.kind === 'neutral' ? 0.99 : 1;
    }
    if (yesIds.has(m.spokesperson) && o.id !== m.spokesperson) herd *= 0.94;
    const min = r.min * Math.max(0.82, herd);
    const ratio = r.perceived / min;
    const talk = spoken < 6;
    if (o.holdout) {
      if (m.answers[o.id] !== 'no') say(game, m, o, 'refuse.holdout');
      m.answers[o.id] = 'no';
      game.record(o.id).finalRefusal = true;
    } else if (ratio >= 1) {
      m.answers[o.id] = 'yes';
      m.deals[o.id] = { cash: r.cash, opts };
      delete m.asks[o.id];
      yesIds.add(o.id);
      if (talk) { say(game, m, o, o.id === m.spokesperson ? 'meet.spokesYes' : 'meet.yes'); spoken++; }
    } else if (ratio >= 0.8) {
      m.answers[o.id] = 'maybe';
      const optionPart = r.perceived - r.cash;
      const cash = Math.ceil((min * (1.03 + o.greed * 0.0008) - optionPart) / step) * step;
      m.asks[o.id] = { cash: Math.max(cash, r.cash + step), opts };
      if (talk) { say(game, m, o, 'meet.maybe', { price: m.asks[o.id].cash }); spoken++; }
    } else if (ratio >= 0.55) {
      m.answers[o.id] = 'no';
      game.changeMood(o, -3);
      if (talk) { say(game, m, o, 'meet.no'); spoken++; }
    } else {
      m.answers[o.id] = 'no';
      game.changeMood(o, -10);
      insults++;
      if (talk) { say(game, m, o, 'meet.insult'); spoken++; }
    }
  }
  if (insults) {
    game.addReputation(-Math.min(4, insults));
    for (const id of attending(m)) game.changeMood(owner(game, id), -2);
  }
  if (scored.length > spoken) note(game, m, 'system.tally', tally(m));
  if (m.patience <= 0) {
    const anyone = attending(m).some((id) => m.answers[id] === 'yes' || m.answers[id] === 'maybe');
    if (!anyone) {
      say(game, m, owner(game, m.spokesperson), 'meet.tired');
      endMeeting(game, m, 'tired');
    } else note(game, m, 'system.lastChance');
  }
  return true;
}

export function tally(m: MeetingSession): { yes: number; maybe: number; no: number } {
  const ids = attending(m);
  return {
    yes: ids.filter((id) => m.answers[id] === 'yes').length,
    maybe: ids.filter((id) => m.answers[id] === 'maybe').length,
    no: ids.filter((id) => m.answers[id] === 'no').length,
  };
}

/** Total of the asking prices of everyone who said "maybe". */
export function asksCost(game: Game, m: MeetingSession): number {
  return Object.entries(m.asks).reduce((a, [id, d]) => a + immediateCost(game, m.values[id], d.cash, d.opts), 0);
}

export function acceptAsks(game: Game, m: MeetingSession) {
  if (m.ended) return;
  const ids = Object.keys(m.asks);
  if (!ids.length) return;
  act(game, m, 'player.acceptAsks', { n: ids.length });
  for (const id of ids) {
    m.answers[id] = 'yes';
    m.deals[id] = m.asks[id];
    say(game, m, owner(game, id), 'meet.yes');
  }
  m.asks = {};
}

export function signCost(game: Game, m: MeetingSession): number {
  return Object.entries(m.deals).reduce((a, [id, d]) => a + immediateCost(game, m.values[id], d.cash, d.opts), 0);
}

/** Pay everyone who agreed. */
export function signAll(game: Game, m: MeetingSession): boolean {
  if (m.ended) return false;
  const ids = Object.keys(m.deals);
  if (!ids.length || signCost(game, m) > game.money) return false;
  act(game, m, 'player.sign', { n: ids.length, cost: signCost(game, m) });
  for (const id of ids) {
    const o = owner(game, id);
    const d = m.deals[id];
    settle(game, o, m.plots[id], m.values[id], d.cash, d.opts);
    game.record(id).log.push({ day: game.day, who: 'system', key: 'system.sold', params: { price: d.cash, n: m.plots[id].length } });
    m.meeting.sold.push(id);
  }
  const first = owner(game, ids[0]);
  say(game, m, first, acceptKey(first), { price: m.deals[ids[0]].cash });
  if (ids.length > 1) say(game, m, owner(game, ids.includes(m.spokesperson) ? m.spokesperson : ids[1]), 'meet.signed');
  note(game, m, 'system.signed', { n: ids.length, cost: signCost(game, m) });
  game.toast({ kind: 'good', key: 'toast.meetingSold', params: { n: ids.length } });
  m.deals = {};
  endMeeting(game, m, 'sold');
  return true;
}

export function leaveMeeting(game: Game, m: MeetingSession) {
  if (m.ended) return;
  act(game, m, 'player.leave');
  endMeeting(game, m, 'left');
}

function endMeeting(game: Game, m: MeetingSession, outcome: MeetingSession['outcome']) {
  m.ended = true;
  m.outcome = outcome;
  for (const id of Object.keys(m.answers)) {
    if (m.answers[id] === 'absent' || m.meeting.sold.includes(id)) continue;
    const rec = game.record(id);
    rec.cooldownUntil = Math.max(rec.cooldownUntil, game.day + (m.answers[id] === 'no' ? 5 : 1));
    rec.read = rec.log.length;
    if (m.answers[id] === 'no' && owner(game, id).holdout) game.setStatus(m.plots[id], 'refused');
  }
  game.emit('session');
}
