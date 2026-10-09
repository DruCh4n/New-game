/**
 * Procedural character portraits: a face drawn from the owner's id (skin, hair, hijab, peci, glasses…)
 * with an expression that follows the conversation.
 */
import { Rng, hashString } from '../util/random';
import type { Owner } from '../game/types';

export type Emotion = 'neutral' | 'happy' | 'delighted' | 'thinking' | 'worried' | 'sad' | 'angry' | 'surprised';

const SKIN = ['#f1c9a5', '#e8b48c', '#d9a07a', '#c98d64', '#b57a52', '#9c6541', '#8a5636'];
const HAIR = ['#1d1612', '#2a1f19', '#3b2a20', '#17120f'];
const HIJAB = ['#c94f6d', '#4f7cc9', '#5aa58a', '#e0a458', '#8b6bbf', '#d9d4c7', '#2f3b52', '#b3404a', '#6fa8b8'];
const SHIRT = ['#3d6fa6', '#7a4f9c', '#a6553d', '#3d8a6f', '#c2a14d', '#5c6470', '#b8485a', '#e6e1d3'];

interface Look {
  skin: string;
  female: boolean;
  age: number;
  hair: string;
  style: number;
  hijab: string | null;
  peci: boolean;
  glasses: boolean;
  mustache: boolean;
  beard: boolean;
  shirt: string;
  outfit: 'casual' | 'suit' | 'uniform' | 'koko';
  bg: number;
}

const looks = new Map<string, Look>();

function lookFor(o: Owner): Look {
  let l = looks.get(o.id);
  if (l) return l;
  const rng = new Rng(hashString(`face|${o.id}`));
  const female = o.kind === 'person' ? o.gender === 'f' : rng.chance(0.35);
  const age = o.age ?? rng.int(30, 55);
  const grey = age > 58 ? rng.chance(0.75) : age > 48 && rng.chance(0.3);
  const outfit: Look['outfit'] = o.role ? 'uniform' : o.kind === 'company' ? 'suit' : o.kind === 'state' ? 'uniform' : o.kind === 'institution' ? 'koko' : 'casual';
  l = {
    skin: rng.pick(SKIN),
    female,
    age,
    hair: grey ? rng.pick(['#bdb7ae', '#9a948c', '#d8d3cb']) : rng.pick(HAIR),
    style: rng.int(0, 2),
    hijab: female && (o.kind === 'institution' || !!o.role || rng.chance(0.62)) ? rng.pick(HIJAB) : null,
    peci: !female && !o.role && (o.kind === 'institution' || (age > 50 && rng.chance(0.45)) || rng.chance(0.12)),
    glasses: rng.chance(age > 50 ? 0.35 : 0.15),
    mustache: !female && rng.chance(0.38),
    beard: !female && age > 45 && rng.chance(0.18),
    shirt: rng.pick(SHIRT),
    outfit,
    bg: hashString(o.id) % 360,
  };
  looks.set(o.id, l);
  return l;
}

/** Expression for an owner's line in a conversation. */
export function emotionForLine(key: string): Emotion | null {
  const rules: [RegExp, Emotion][] = [
    [/^accept\.happy|^gift\.thanks|^meet\.signed|^msg\.thanks/, 'delighted'],
    [/^accept\.sad|^story\.(medicalDebt|businessDebt|elderParent|fatherBuilt|neverLeave)|^refuse\.tired|^msg\.lastOne/, 'sad'],
    [/^accept\.|^greet\.(again\.)?warm|^option\.like|^remark\.highRep|^meet\.(yes|present\.good|fund|spokesYes)|^persuade\..*yes|^persuade\.(neighbor|rt)\.say|^msg\.(curious|reconsider)|^state\.accept/, 'happy'],
    [/^offer\.insult|^refuse\.angry|^pressure\.backfire|^meet\.insult|^msg\.angry|^persuade\.rt\.refuse/, 'angry'],
    [/^pressure\.works|^offer\.low|^option\.dislike|^remark\.(lowRep|manySold)|^greet\.(again\.)?cold|^meet\.(grumble|no|present\.bad)|^msg\.promise|^hint\.holdout/, 'worried'],
    [/^counter\.|^hint\.|^remark\.|^meet\.maybe|^listen|^state\.reject/, 'thinking'],
    [/^refuse\.wontMeet|^gift\.again|^persuade\..*no/, 'surprised'],
  ];
  rules.unshift([/^papers\.heirs$/, 'worried'], [/^papers\.heirsAgree|^official\.\w+\.done/, 'happy']);
  for (const [re, e] of rules) if (re.test(key)) return e;
  return null;
}

export function emotionForMood(mood: number): Emotion {
  return mood >= 78 ? 'delighted' : mood >= 60 ? 'happy' : mood >= 38 ? 'neutral' : mood >= 20 ? 'worried' : 'angry';
}

/** SVG markup for a portrait. */
export function portrait(o: Owner, emotion: Emotion = 'neutral', size = 48, extraClass = ''): string {
  const l = lookFor(o);
  const s = l.skin;
  const parts: string[] = [];
  parts.push(`<circle cx="32" cy="32" r="32" fill="hsl(${l.bg} 32% 34%)"/>`);
  // back hair / hijab drape
  if (l.hijab) parts.push(`<path d="M12 64 C12 40 16 14 32 13 C48 14 52 40 52 64 Z" fill="${l.hijab}"/>`);
  else if (l.female) parts.push(`<path d="M15 50 C13 30 18 14 32 14 C46 14 51 30 49 50 C46 42 18 42 15 50 Z" fill="${l.hair}"/>`);
  // body
  const body = l.outfit === 'suit' ? '#2a3140' : l.outfit === 'uniform' ? '#a08a5c' : l.outfit === 'koko' ? '#ecebe6' : l.shirt;
  parts.push(`<path d="M8 64 C9 52 18 47 32 47 C46 47 55 52 56 64 Z" fill="${l.hijab && l.outfit !== 'suit' ? l.hijab : body}"/>`);
  if (l.outfit === 'suit') parts.push('<path d="M28 47 L32 58 L36 47 Z" fill="#f2f2f2"/><path d="M31 49 L33 49 L33.6 58 L32 60 L30.4 58 Z" fill="#b8485a"/>');
  if (l.outfit === 'uniform') parts.push('<path d="M26 47 L32 54 L38 47" stroke="#7d6a43" stroke-width="2" fill="none"/><rect x="40" y="53" width="6" height="2" fill="#e0c060"/>');
  if (l.outfit === 'koko') parts.push('<path d="M32 48 L32 62" stroke="#c9c6bc" stroke-width="1.2"/>');
  // neck and head
  parts.push(`<rect x="27" y="38" width="10" height="11" rx="4" fill="${s}"/>`);
  if (!l.hijab) parts.push(`<ellipse cx="18.5" cy="31" rx="2.6" ry="3.6" fill="${s}"/><ellipse cx="45.5" cy="31" rx="2.6" ry="3.6" fill="${s}"/>`);
  parts.push(`<ellipse cx="32" cy="29" rx="13.5" ry="15.5" fill="${s}"/>`);
  // hair / head cover
  if (l.hijab) {
    parts.push(`<path d="M17.5 30 C17 16 24 11 32 11 C40 11 47 16 46.5 30 C44 20 39 16.5 32 16.5 C25 16.5 20 20 17.5 30 Z" fill="${l.hijab}"/>`);
    parts.push(`<path d="M17.5 30 C17 40 22 46 26 48 L20 50 C15 45 15 36 17.5 30 Z M46.5 30 C47 40 42 46 38 48 L44 50 C49 45 49 36 46.5 30 Z" fill="${l.hijab}"/>`);
  } else if (l.peci) {
    parts.push(`<path d="M19 21 C19 18 21 12.5 32 12.5 C43 12.5 45 18 45 21 Z" fill="#191919"/><rect x="18.6" y="19" width="26.8" height="3" rx="1" fill="#2b2b2b"/>`);
    parts.push(`<path d="M18.6 24 L18.6 28 C19.6 26 20 25 20.5 23 Z M45.4 24 L45.4 28 C44.4 26 44 25 43.5 23 Z" fill="${l.hair}"/>`);
  } else if (l.female) {
    parts.push(`<path d="M18 27 C18 16 24 13 32 13 C41 13 46.5 17 46 28 C42 22 37 19 30 20 C25 21 21 23 18 27 Z" fill="${l.hair}"/>`);
  } else if (l.age > 62 && l.style === 0) {
    parts.push(`<path d="M18.4 27 C18.6 22 20 20 21.5 19.5 L21.5 25 Z M45.6 27 C45.4 22 44 20 42.5 19.5 L42.5 25 Z" fill="${l.hair}"/>`);
  } else if (l.style === 1) {
    parts.push(`<path d="M18.4 27 C17.5 16 24 12.5 32 12.5 C40 12.5 46.5 16 45.6 27 C44 21 41 19 36 18.5 C30 18 26 21 24 19 C21 21 19.5 23 18.4 27 Z" fill="${l.hair}"/>`);
  } else {
    parts.push(`<path d="M18.4 26 C18 16 24 13 32 13 C40 13 46 16 45.6 26 C44 20.5 40 18 32 18 C24 18 20 20.5 18.4 26 Z" fill="${l.hair}"/>`);
  }
  if (l.age > 58) parts.push('<path d="M26 19.5 Q32 18 38 19.5 M27 22 Q32 21 37 22" stroke="#000" stroke-opacity=".18" stroke-width=".7" fill="none"/>');
  parts.push(face(emotion, l));
  if (l.mustache) parts.push(`<path d="M26.5 35.6 Q32 33.4 37.5 35.6 Q32 34.8 26.5 35.6 Z" fill="${l.hair}" stroke="${l.hair}" stroke-width="1.3" stroke-linejoin="round"/>`);
  if (l.beard) parts.push(`<path d="M22 36 C23 44 28 45.5 32 45.5 C36 45.5 41 44 42 36 C40 41 36 42 32 42 C28 42 24 41 22 36 Z" fill="${l.hair}" opacity=".85"/>`);
  if (l.glasses) parts.push('<g fill="none" stroke="#2a2a2a" stroke-width="1.1"><circle cx="26.4" cy="28.2" r="3.9"/><circle cx="37.6" cy="28.2" r="3.9"/><path d="M30.3 28 L33.7 28"/></g>');
  return `<svg class="portrait ${extraClass} emo-${emotion}" viewBox="0 0 64 64" width="${size}" height="${size}" aria-hidden="true">${parts.join('')}</svg>`;
}

function face(e: Emotion, l: Look): string {
  const brow = l.hijab ? '#3b2a20' : l.hair;
  const ink = '#2b1d16';
  const p: string[] = [];
  // eyebrows: [left inner y, left outer y], mirrored on the right
  const browY: Record<Emotion, [number, number]> = {
    neutral: [23, 23], happy: [22.4, 22.8], delighted: [22, 22.4], thinking: [23.4, 22.6], worried: [21.6, 23.6],
    sad: [21.8, 24], angry: [24.6, 21.8], surprised: [20.6, 21],
  };
  const [bi, bo] = browY[e];
  const browR = e === 'thinking' ? [21.2, 21.8] : [bi, bo];
  p.push(`<path d="M22.5 ${bo} L29.5 ${bi} M34.5 ${browR[0]} L41.5 ${browR[1]}" stroke="${brow}" stroke-width="1.6" stroke-linecap="round"/>`);
  // eyes
  if (e === 'happy' || e === 'delighted') {
    p.push(`<path d="M23.8 28.6 Q26.4 25.8 29 28.6 M35 28.6 Q37.6 25.8 40.2 28.6" stroke="${ink}" stroke-width="1.5" fill="none" stroke-linecap="round"/>`);
  } else if (e === 'surprised') {
    p.push(`<circle cx="26.4" cy="28" r="2.2" fill="#fff"/><circle cx="37.6" cy="28" r="2.2" fill="#fff"/><circle cx="26.4" cy="28" r="1.3" fill="${ink}"/><circle cx="37.6" cy="28" r="1.3" fill="${ink}"/>`);
  } else if (e === 'sad') {
    p.push(`<path d="M24 28.6 Q26.4 30 28.8 28.6 M35.2 28.6 Q37.6 30 40 28.6" stroke="${ink}" stroke-width="1.5" fill="none" stroke-linecap="round"/>`);
  } else {
    const dx = e === 'thinking' ? 1 : 0;
    const ry = e === 'angry' ? 1.1 : 1.6;
    p.push(`<ellipse cx="${26.4 + dx}" cy="28" rx="1.5" ry="${ry}" fill="${ink}"/><ellipse cx="${37.6 + dx}" cy="28" rx="1.5" ry="${ry}" fill="${ink}"/>`);
  }
  // nose
  p.push('<path d="M32 29.5 Q30.6 33 32.4 33.4" stroke="#000" stroke-opacity=".25" stroke-width="1" fill="none" stroke-linecap="round"/>');
  // mouth
  const lip = '#8a3b33';
  const mouths: Record<Emotion, string> = {
    neutral: `<path d="M28.5 37.6 L35.5 37.6" stroke="${lip}" stroke-width="1.5" stroke-linecap="round"/>`,
    happy: `<path d="M27.4 36.6 Q32 40.6 36.6 36.6" stroke="${lip}" stroke-width="1.6" fill="none" stroke-linecap="round"/>`,
    delighted: `<path d="M26.8 36.2 Q32 43 37.2 36.2 Z" fill="${lip}"/><path d="M27.8 36.6 Q32 38 36.2 36.6 L36 37.4 Q32 38.8 28 37.4 Z" fill="#fff"/>`,
    thinking: `<path d="M29.5 38 Q33 37 35.8 36.6" stroke="${lip}" stroke-width="1.5" fill="none" stroke-linecap="round"/>`,
    worried: `<path d="M27.8 38.2 Q29.8 36.8 32 38 Q34.2 39.2 36.2 37.8" stroke="${lip}" stroke-width="1.5" fill="none" stroke-linecap="round"/>`,
    sad: `<path d="M27.8 39.2 Q32 35.6 36.2 39.2" stroke="${lip}" stroke-width="1.6" fill="none" stroke-linecap="round"/>`,
    angry: `<path d="M27.6 38.8 Q32 36 36.4 38.8 L36 39.6 Q32 37.8 28 39.6 Z" fill="${lip}"/>`,
    surprised: `<ellipse cx="32" cy="38.4" rx="2.2" ry="2.8" fill="${lip}"/>`,
  };
  p.push(mouths[e]);
  // extras
  if (e === 'delighted' || e === 'happy') p.push('<ellipse cx="22.6" cy="33.4" rx="2.6" ry="1.5" fill="#e06a6a" opacity=".28"/><ellipse cx="41.4" cy="33.4" rx="2.6" ry="1.5" fill="#e06a6a" opacity=".28"/>');
  if (e === 'angry') p.push('<ellipse cx="22.6" cy="33.4" rx="3" ry="1.7" fill="#d63a3a" opacity=".35"/><ellipse cx="41.4" cy="33.4" rx="3" ry="1.7" fill="#d63a3a" opacity=".35"/><path d="M46 14 l3 3 m0 -3 l-3 3 M50.5 18.5 l2.4 2.4 m0 -2.4 l-2.4 2.4" stroke="#e5534b" stroke-width="1.6" stroke-linecap="round"/>');
  if (e === 'sad') p.push('<path d="M40.6 31 Q39.6 33.6 40.6 34.6 Q41.6 33.6 40.6 31 Z" fill="#7cc4f2"/>');
  if (e === 'worried') p.push('<path d="M45.6 20 Q44.2 23 45.6 24.2 Q47 23 45.6 20 Z" fill="#7cc4f2"/>');
  if (e === 'thinking') p.push('<circle cx="49" cy="15" r="1.3" fill="#fff" opacity=".8"/><circle cx="52.5" cy="11" r="2" fill="#fff" opacity=".8"/>');
  return p.join('');
}
