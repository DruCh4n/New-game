import { getLang, t, tk } from '../i18n';
import { formatMoney } from '../game/regional';
import type { World } from '../game/World';
import type { Owner, Plot, RoadAccess } from '../game/types';

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function money(world: World, v: number): string {
  return formatMoney(v, world.region, getLang());
}

export function ownerName(o: Owner): string {
  if (o.nameKey) return tk(o.nameKey, o.nameParams);
  return o.honorific ? `${o.honorific} ${o.name}` : o.name;
}

export function plotTitle(p: Plot): string {
  return p.name ?? tk(`cat.${p.category}`);
}

/** Panel heading: the building's name, or "House on Jalan Melati". */
export function plotHeading(p: Plot): string {
  if (p.name) return p.name;
  const road = p.road?.name ?? p.access?.name;
  return road ? t('panel.titleOn', { cat: tk(`cat.${p.category}`), road }) : tk(`cat.${p.category}`);
}

export function roadLabel(r: RoadAccess): string {
  return r.name ?? t('panel.unnamedRoad', { kind: tk(`road.${r.kind}`) });
}

/** 0-100 → one of four qualitative descriptions. */
export function band(prefix: 'attach' | 'greed', v: number): string {
  return tk(`${prefix}.${Math.min(3, Math.floor(v / 25))}`);
}

export function initials(name: string): string {
  return name.split(/\s+/).filter((w) => /^\p{Lu}/u.test(w)).slice(0, 2).map((w) => w[0]).join('') || name.slice(0, 2);
}
