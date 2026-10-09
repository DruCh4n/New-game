import { t, tk } from '../i18n';
import type { Game } from '../game/Game';
import {
  OFFICIALS, isWeak, officialOwner, paperOf, serviceActive, serviceCost, serviceDays, type OfficialId,
} from '../game/papers';
import { esc, formatDate, money, ownerName } from './format';
import { portrait } from './portrait';
import { currentEmotion } from './negotiationPanel';

export interface OfficeActions {
  request(c: OfficialId): void;
  chat(c: OfficialId): void;
  focus(plotId: string): void;
  close(): void;
}

/** Officials and their services, pending cases and registrations, headlines. */
export function renderOffice(el: HTMLElement, game: Game, a: OfficeActions) {
  const w = game.world;
  const pp = game.papers;
  const known = w.plots.filter((p) => pp.checked.has(p.id) || (serviceActive(game, 'bpn') && w.ownerOf(p).kind !== 'state'));
  const weak = known.filter((p) => isWeak(paperOf(w, p))).length;
  const regDays = pp.registering.size ? Math.max(...pp.registering.values()) : 0;

  const officials = OFFICIALS.map((c) => {
    const o = officialOwner(game, c);
    const active = serviceActive(game, c);
    const cost = serviceCost(game, c);
    return `<li class="official">
      <span class="face">${portrait(o, currentEmotion(o, game.records.get(o.id)?.log ?? []), 44)}</span>
      <div class="body"><b>${esc(ownerName(o))}</b><small>${tk(`occ.official.${c}`)}</small><p>${tk(`office.svc.${c}`)}</p>
        <div class="row">
          ${active ? `<em class="tag sold">${t('office.active', { days: (pp.services[c] ?? 0) - game.day })}</em>`
            : `<button data-req="${c}" class="primary" ${cost > game.money ? 'disabled' : ''}>${t('office.request', { cost: money(w, cost), days: serviceDays(c) })}</button>`}
          <button data-chat="${c}">💬 ${t('office.chat')}</button>
        </div></div></li>`;
  }).join('');

  const cases = pp.cases.map((c) => {
    const o = w.owner(c.ownerId)!;
    return `<li><button class="link" data-focus="${esc(c.plotIds[0])}">${portrait(o, currentEmotion(o, game.records.get(o.id)?.log ?? []), 26)}
      <span><b>${esc(ownerName(o))}</b><small>${t(`case.${c.kind}` as never, { days: c.daysLeft })}</small></span></button></li>`;
  });
  if (pp.registering.size) cases.push(`<li class="muted">📜 ${t('office.regs', { n: pp.registering.size, days: regDays })}</li>`);

  el.innerHTML = `
    <div class="panel-head"><h2>🏛 ${t('office.title')}</h2><button id="panel-close" class="icon" aria-label="${t('panel.close')}">✕</button></div>
    <p class="hint">${t('office.hint')}</p>
    <p class="muted">${t('office.papers', { n: known.length, weak })}</p>
    <h3>${t('office.officials')}</h3>
    <ul class="officials">${officials}</ul>
    <h3>${t('office.cases')}</h3>
    ${cases.length ? `<ul class="multi-list">${cases.join('')}</ul>` : `<p class="muted">${t('office.noCases')}</p>`}
    <h3>${t('office.news')}</h3>
    ${pp.news.length ? `<ul class="news">${[...pp.news].reverse().slice(0, 12).map((n) => `<li class="${n.bad ? 'bad' : ''}"><small>${formatDate(game.date(n.day))}</small> ${esc(tk(n.key, n.params))}</li>`).join('')}</ul>`
      : `<p class="muted">${t('office.noNews')}</p>`}`;
  el.querySelector<HTMLElement>('#panel-close')!.onclick = a.close;
  el.querySelectorAll<HTMLElement>('[data-req]').forEach((b) => (b.onclick = () => a.request(b.dataset.req as OfficialId)));
  el.querySelectorAll<HTMLElement>('[data-chat]').forEach((b) => (b.onclick = () => a.chat(b.dataset.chat as OfficialId)));
  el.querySelectorAll<HTMLElement>('[data-focus]').forEach((b) => (b.onclick = () => a.focus(b.dataset.focus!)));
}
