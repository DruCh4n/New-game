import { Rng, hashString } from '../util/random';
import { generatePersonName, honorific, nameSet, randomCity, type Gender } from './names';
import type { BuildingCategory, Finances, Owner, Plot, Relation, RelationKind, Story } from './types';

export const START_YEAR = 2026;

const COMPANY_A = ['Sinar', 'Maju', 'Karya', 'Abadi', 'Sentosa', 'Makmur', 'Cahaya', 'Bumi', 'Mulia', 'Prima', 'Mitra', 'Surya'];
const COMPANY_B = ['Jaya', 'Sejahtera', 'Lestari', 'Utama', 'Mandiri', 'Perkasa', 'Indah', 'Gemilang', 'Nusantara'];
const COMPANY_EN_A = ['Golden', 'Sunrise', 'Pacific', 'Summit', 'Harbor', 'Evergreen', 'Lotus', 'Pioneer', 'Orchid'];
const COMPANY_EN_B = ['Holdings', 'Trading', 'Logistics', 'Properties', 'Industries', 'Ventures', 'Supplies'];

const HOUSE_JOBS = ['warung', 'ojek', 'teacher', 'civil', 'factory', 'tailor', 'mechanic', 'office', 'carpenter',
  'nurse', 'driver', 'laundry', 'trader', 'cook', 'security'];
const SHOP_JOBS = ['shopkeeper', 'trader', 'restaurateur', 'shopkeeper', 'pharmacist'];

interface Ctx {
  country?: string;
  rng: Rng;
  category: BuildingCategory | 'field';
  family?: string;
}

function tri(rng: Rng, a: number, b: number) {
  return a + (b - a) * ((rng.next() + rng.next()) / 2);
}
const clamp = (v: number, a = 0, b = 100) => Math.round(Math.max(a, Math.min(b, v)));

function makePerson(id: string, ctx: Ctx): Owner {
  const { rng, category, country } = ctx;
  const gender: Gender = rng.chance(0.58) ? 'm' : 'f';
  const age = Math.round(tri(rng, 24, 88));
  const { name } = generatePersonName(country, gender, rng, ctx.family);
  const isShop = category === 'shophouse' || category === 'shop';
  const isField = category === 'field';

  let finances: Finances = rng.chance(isShop ? 0.3 : 0.12) ? 'wealthy' : rng.chance(isShop ? 0.2 : 0.4) ? 'needs_money' : 'comfortable';
  let occupation: string;
  if (isField) occupation = 'farmer';
  else if (age >= 62 && rng.chance(0.7)) occupation = 'retired';
  else if (isShop) occupation = finances === 'wealthy' && rng.chance(0.4) ? 'landlord' : rng.pick(SHOP_JOBS);
  else occupation = rng.pick(HOUSE_JOBS);
  if (occupation === 'landlord') finances = 'wealthy';

  const newlyBought = rng.chance(isShop ? 0.25 : 0.12);
  const yearsLived = newlyBought ? rng.int(1, 7) : Math.max(1, Math.min(age - 16, Math.round(tri(rng, 5, age - 10))));
  const familySize = age > 70 ? rng.int(1, 4) : rng.int(1, 7) + (rng.chance(0.2) ? 2 : 0);

  const attachment = clamp(15 + yearsLived * 1.1 + (isShop ? -8 : 6) + (isField ? 10 : 0) + rng.range(-15, 25));
  const greed = clamp(tri(rng, 5, 95) + (finances === 'wealthy' ? 8 : 0) + (occupation === 'landlord' ? 15 : 0));

  const holdoutChance = 0.03 + (attachment > 80 ? 0.12 : 0) + (age > 72 ? 0.05 : 0) - (finances === 'needs_money' ? 0.02 : 0);
  const holdout = rng.chance(holdoutChance);
  const minFactor = round2(
    0.95 + greed * 0.006 + attachment * 0.007 + (finances === 'wealthy' ? 0.25 : finances === 'needs_money' ? -0.15 : 0) + rng.range(-0.1, 0.1),
  );

  const owner: Owner = {
    id,
    kind: 'person',
    name,
    honorific: honorific(country, gender, age),
    gender,
    age,
    occupation,
    familySize,
    yearsLived,
    attachment,
    greed,
    finances,
    holdout,
    minFactor,
    mood: clamp(50 + rng.range(-15, 15)),
    plotIds: [],
    relations: [],
    stories: [],
  };
  owner.stories = pickStories(owner, ctx, newlyBought);
  return owner;
}

function pickStories(o: Owner, ctx: Ctx, newlyBought: boolean): Story[] {
  const { rng, country, category } = ctx;
  const age = o.age ?? 40;
  const cands: { w: number; s: Story }[] = [];
  const add = (w: number, key: string, params?: Story['params']) => w > 0 && cands.push({ w, s: { key, params } });

  if (o.occupation === 'warung') add(10, 'warung');
  if (o.occupation === 'mechanic') add(8, 'workshop');
  if (o.occupation === 'tailor') add(6, 'tailor');
  if (o.occupation === 'laundry') add(6, 'laundry');
  if (o.occupation === 'landlord') add(8, 'investor');
  if (o.occupation === 'farmer') add(8, 'farmer', { gens: rng.int(2, 4) });
  if (o.occupation === 'retired') add(4, 'pension');
  if (category === 'shophouse' || category === 'shop') add(5, 'shopFamily', { years: Math.max(3, o.yearsLived + rng.int(0, 20)) });
  if (category === 'house' && !newlyBought && age > 35 && o.yearsLived > 15) add(o.attachment / 15, 'fatherBuilt', { year: START_YEAR - o.yearsLived - rng.int(0, 20) });
  if (!newlyBought && o.yearsLived > 20) add(3, 'siblings', { n: rng.int(2, 5) });
  if (o.familySize >= 4 && age < 52) add(4, 'kidsSchool', { n: Math.min(o.familySize - 2, rng.int(2, 4)) });
  if (o.familySize >= 3 && age >= 35 && age <= 62) add(3, 'elderParent');
  if (o.finances === 'needs_money') add(5, rng.pick(['medicalDebt', 'businessDebt', 'schoolFees']));
  if (o.attachment < 45) add(4, 'wantsMove', { city: randomCity(country, rng) });
  if (newlyBought) add(6, 'newlyBought', { years: o.yearsLived });
  if (age < 33) add(3, 'newlyweds');
  if (category === 'house') add(2, rng.pick(['mangoTree', 'birds', 'garden']));
  if (category === 'house' && o.finances !== 'needs_money') add(1.5, 'kos');
  if (age > 45 && rng.chance(0.04)) add(20, 'rtHead');
  if (age > 50) add(1.5, 'wedding');
  if (o.holdout) add(6, 'neverLeave');

  const out: Story[] = [];
  const count = 2 + (rng.chance(0.35) ? 1 : 0);
  while (out.length < count && cands.length) {
    const total = cands.reduce((a, c) => a + c.w, 0);
    let r = rng.next() * total;
    const idx = cands.findIndex((c) => (r -= c.w) <= 0);
    const [c] = cands.splice(idx < 0 ? 0 : idx, 1);
    if (!out.some((s) => s.key === c.s.key)) out.push(c.s);
  }
  return out;
}

function round2(v: number) {
  return Math.round(v * 100) / 100;
}

function makeCompany(id: string, country: string | undefined, rng: Rng): Owner {
  const name = country === 'ID'
    ? `PT ${rng.pick(COMPANY_A)} ${rng.pick(COMPANY_B)}`
    : `${rng.pick(COMPANY_EN_A)} ${rng.pick(COMPANY_EN_B)}`;
  const greed = clamp(tri(rng, 50, 100));
  return {
    id, kind: 'company', name, honorific: '', familySize: 0, yearsLived: rng.int(2, 30),
    attachment: clamp(rng.range(5, 35)), greed, finances: rng.chance(0.2) ? 'needs_money' : 'wealthy',
    holdout: rng.chance(0.04), minFactor: round2(1.05 + greed * 0.005 + rng.range(-0.05, 0.15)), mood: 50,
    plotIds: [], relations: [], stories: [{ key: rng.pick(['companyExpand', 'companyRent', 'companyIdle']) }],
  };
}

function makeInstitution(id: string, nameKey: string, nameParams: Record<string, string>, holdout: boolean, rng: Rng): Owner {
  return {
    id, kind: 'institution', name: '', nameKey, nameParams, honorific: '', familySize: 0, yearsLived: rng.int(20, 80),
    attachment: holdout ? 100 : clamp(rng.range(50, 85)), greed: clamp(rng.range(20, 60)), finances: 'comfortable',
    holdout, minFactor: round2(holdout ? 99 : rng.range(1.4, 2.0)), mood: 50, plotIds: [], relations: [],
    stories: [{ key: holdout ? 'waqf' : 'foundation' }],
  };
}

function makeState(): Owner {
  return {
    id: 'o_state', kind: 'state', name: '', nameKey: 'owner.state', honorific: '', familySize: 0, yearsLived: 0,
    attachment: 0, greed: 0, finances: 'wealthy', holdout: false, minFactor: 1.1, mood: 50, plotIds: [], relations: [],
    stories: [{ key: 'stateLand' }],
  };
}

/** Generates owners for all plots (mutates plot.ownerId) and their relationships. Deterministic per seed. */
export function generateOwners(plots: Plot[], country: string | undefined, seed: number): Owner[] {
  const owners = new Map<string, Owner>();
  const byPlot = new Map(plots.map((p) => [p.id, p]));
  const familyLinks = new Set<string>();
  const linkKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const state = makeState();
  owners.set(state.id, state);
  let cemetery: Owner | null = null;
  const fieldBlocks = new Map<string, Owner>();
  const hasFamilyNames = nameSet(country).family.length > 0;

  const assign = (p: Plot, o: Owner) => {
    p.ownerId = o.id;
    o.plotIds.push(p.id);
    owners.set(o.id, o);
  };
  const neighborOwners = (p: Plot, filter: (o: Owner, q: Plot) => boolean): Owner[] => {
    const out: Owner[] = [];
    for (const nid of p.neighbors) {
      const q = byPlot.get(nid);
      const o = q?.ownerId ? owners.get(q.ownerId) : undefined;
      if (q && o && filter(o, q)) out.push(o);
    }
    return out;
  };

  for (const p of plots) {
    const rng = new Rng(seed ^ hashString(`owner:${p.id}`));
    const oid = `o_${p.id.slice(2)}`;
    switch (p.category) {
      case 'worship': {
        // Annexes of the same mosque/church share its board.
        const board = neighborOwners(p, (o, q) => q.category === 'worship' && o.kind === 'institution');
        if (board.length) { assign(p, board[0]); continue; }
        assign(p, makeInstitution(oid, p.name ? 'inst.worship' : 'inst.worshipUnnamed', { name: p.name ?? '' }, true, rng));
        continue;
      }
      case 'school':
        if ((p.name && /negeri|public|state/i.test(p.name)) || rng.chance(0.5)) assign(p, state);
        else assign(p, makeInstitution(oid, p.name ? 'inst.school' : 'inst.schoolUnnamed', { name: p.name ?? '' }, false, rng));
        continue;
      case 'civic':
      case 'market':
      case 'state_land':
      case 'park':
        assign(p, state);
        continue;
      case 'cemetery':
        cemetery ??= makeInstitution('o_cemetery', 'inst.cemetery', {}, true, rng);
        assign(p, cemetery);
        continue;
      case 'field': {
        const [, ix, iy] = p.id.split('_').map(Number);
        const key = `${ix >> 1}_${iy >> 1}`;
        let o = fieldBlocks.get(key);
        if (!o) {
          o = makePerson(`o_f${key}`, { country, rng, category: 'field' });
          fieldBlocks.set(key, o);
        }
        assign(p, o);
        continue;
      }
      case 'industrial':
      case 'office':
      case 'apartment':
        if (rng.chance(0.65)) { assign(p, makeCompany(oid, country, rng)); continue; }
        break;
      case 'shop':
        if (rng.chance(0.35)) { assign(p, makeCompany(oid, country, rng)); continue; }
        break;
      case 'shophouse': {
        // Landlords often own several units in the same ruko row.
        const landlords = neighborOwners(p, (o, q) => q.category === 'shophouse' && o.occupation === 'landlord' && o.plotIds.length < 6);
        if (landlords.length && rng.chance(0.45)) { assign(p, landlords[0]); continue; }
        break;
      }
      case 'outbuilding': {
        const hosts = neighborOwners(p, (o, q) => o.kind === 'person' && q.category !== 'outbuilding');
        if (hosts.length && rng.chance(0.75)) { assign(p, hosts[0]); continue; }
        break;
      }
    }
    // Ordinary private owner, sometimes related to a neighbor.
    const relatives = hasFamilyNames ? neighborOwners(p, (o) => o.kind === 'person') : [];
    let family: string | undefined;
    let relative: Owner | undefined;
    if (relatives.length && rng.chance(0.12)) {
      relative = rng.pick(relatives);
      family = relative.name.split(' ').slice(-1)[0];
    }
    const o = makePerson(oid, { country, rng, category: p.category as BuildingCategory, family });
    if (relative) familyLinks.add(linkKey(o.id, relative.id));
    assign(p, o);
  }

  // ----- relationships between neighbouring owners -----
  const seen = new Set<string>();
  for (const p of plots) {
    const a = owners.get(p.ownerId)!;
    if (a.kind === 'state') continue;
    for (const nid of p.neighbors) {
      const b = owners.get(byPlot.get(nid)!.ownerId)!;
      if (b === a || b.kind === 'state') continue;
      const k = linkKey(a.id, b.id);
      if (seen.has(k)) continue;
      seen.add(k);
      const rng = new Rng(seed ^ hashString(`rel:${k}`));
      let kind: RelationKind;
      let value: number;
      if (familyLinks.has(k)) { kind = 'family'; value = Math.round(rng.range(55, 95)); }
      else {
        const r = rng.next();
        if (a.kind !== 'person' || b.kind !== 'person') { kind = 'neutral'; value = Math.round(rng.range(-10, 30)); }
        else if (r < 0.1) { kind = 'rival'; value = Math.round(rng.range(-80, -30)); }
        else if (r < 0.42) { kind = 'friend'; value = Math.round(rng.range(40, 85)); }
        else { kind = 'neutral'; value = Math.round(rng.range(0, 35)); }
      }
      const ra: Relation = { ownerId: b.id, kind, value };
      const rb: Relation = { ownerId: a.id, kind, value };
      a.relations.push(ra);
      b.relations.push(rb);
    }
  }
  return [...owners.values()];
}
