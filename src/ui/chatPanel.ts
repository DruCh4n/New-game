import { t, tk } from '../i18n';
import type { Game } from '../game/Game';
import { DEAL_OPTIONS, IMMEDIATE_OPTIONS, optionCost, type DealOption } from '../game/negotiation';
import {
  asksCost, fundCost, offerPayNow, signCost, tally, type Meeting, type MeetingSession,
} from '../game/meeting';
import { unreadCount } from '../game/messages';
import { esc, formatDate, money, ownerName, renderLine } from './format';
import { portrait } from './portrait';
import { currentEmotion, transcriptHtml } from './negotiationPanel';

export interface ChatActions {
  openOwner(ownerId: string): void;
  openMeeting(id: string): void;
  close(): void;
}

let filter: 'all' | 'unread' | 'meetings' = 'all';

/** WhatsApp-style list: one room per person, plus group meetings. */
export function renderChats(el: HTMLElement, game: Game, a: ChatActions) {
  const w = game.world;
  interface Row { kind: 'owner' | 'meeting'; id: string; day: number; order: number; html: string; unread: number }
  const rows: Row[] = [];
  let order = 0;
  for (const [id, rec] of game.records) {
    if (!rec.log.length) continue;
    const o = w.owner(id);
    if (!o) continue;
    const last = [...rec.log].reverse().find((e) => e.who !== 'system') ?? rec.log[rec.log.length - 1];
    const unread = unreadCount(game, id);
    const sold = game.soldOwners.has(id);
    rows.push({
      kind: 'owner', id, day: last.day, order: order++, unread,
      html: `<span class="face">${portrait(o, currentEmotion(o, rec.log), 40)}</span>
        <span class="body"><b>${esc(ownerName(o))}${sold ? ' <em class="tag sold">✓</em>' : ''}</b>
          <small>${last.who === 'player' ? `${t('chat.you')}: ` : ''}${esc(clip(renderLine(w, last)))}</small></span>`,
    });
  }
  for (const m of game.meetings) {
    const people = m.ownerIds.map((id) => w.owner(id)!).filter(Boolean);
    const last = m.log[m.log.length - 1];
    rows.push({
      kind: 'meeting', id: m.id, day: last?.day ?? m.day, order: order++, unread: m.read < m.log.length ? 1 : 0,
      html: `<span class="face stack">${people.slice(0, 3).map((o) => portrait(o, currentEmotion(o, m.log, o.id), 26)).join('')}</span>
        <span class="body"><b>👥 ${t('chat.meeting', { n: people.length })}${m.sold.length ? ` <em class="tag sold">✓ ${m.sold.length}</em>` : ''}</b>
          <small>${esc(clip(people.map((o) => o.name).join(', ')))}</small></span>`,
    });
  }
  rows.sort((x, y) => y.day - x.day || y.order - x.order);
  const shown = rows.filter((r) => filter === 'all' || (filter === 'unread' ? r.unread > 0 : r.kind === 'meeting')).slice(0, 250);
  const unreadTotal = rows.filter((r) => r.unread).length;

  el.innerHTML = `
    <div class="panel-head"><h2>💬 ${t('chat.title')}</h2><button id="panel-close" class="icon" aria-label="${t('panel.close')}">✕</button></div>
    <div class="segmented chat-filter">
      ${(['all', 'unread', 'meetings'] as const).map((f) => `<button data-f="${f}" class="${filter === f ? 'active' : ''}">${t(`chat.f.${f}`)}${f === 'unread' && unreadTotal ? ` (${unreadTotal})` : ''}</button>`).join('')}
    </div>
    ${shown.length ? `<ul class="chat-list">${shown.map((r) => `
      <li><button class="room ${r.unread ? 'unread' : ''}" data-kind="${r.kind}" data-id="${esc(r.id)}">${r.html}
        <span class="meta"><small>${formatDate(game.date(r.day))}</small>${r.unread ? `<i class="badge">${r.kind === 'owner' ? r.unread : '•'}</i>` : ''}</span></button></li>`).join('')}</ul>`
      : `<p class="hint">${t('chat.none')}</p>`}
    <p class="hint">${t('chat.hint')}</p>`;
  el.querySelector<HTMLElement>('#panel-close')!.onclick = a.close;
  el.querySelectorAll<HTMLElement>('[data-f]').forEach((b) => (b.onclick = () => { filter = b.dataset.f as typeof filter; renderChats(el, game, a); }));
  el.querySelectorAll<HTMLElement>('.room').forEach((b) => (b.onclick = () => (b.dataset.kind === 'owner' ? a.openOwner(b.dataset.id!) : a.openMeeting(b.dataset.id!))));
}

function clip(s: string, n = 72) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

// ---------------------------------------------------------------- meetings

export interface MeetingActions {
  present(): void;
  listenAll(): void;
  fund(): void;
  offer(pct: number, opts: DealOption[]): void;
  acceptAsks(): void;
  sign(): void;
  leave(): void;
  back(): void;
  openOwner(ownerId: string): void;
}

let mdraft: { id: string; pct: number; opts: Set<DealOption> } | null = null;

const BADGE: Record<string, string> = { yes: '✓', maybe: '?', no: '✕', absent: '–', none: '' };

/** A running meeting (with the composer) or a past one (read only). */
export function renderMeeting(el: HTMLElement, game: Game, meeting: Meeting, m: MeetingSession | null, a: MeetingActions) {
  const w = game.world;
  meeting.read = meeting.log.length;
  const live = m && m.meeting === meeting ? m : null;
  const people = meeting.ownerIds.map((id) => w.owner(id)!).filter(Boolean);
  const faces = people.map((o) => {
    const ans = live ? live.answers[o.id] : meeting.sold.includes(o.id) ? 'yes' : 'none';
    const chair = live?.spokesperson === o.id;
    return `<button class="mface ans-${ans}" data-owner="${esc(o.id)}" title="${esc(ownerName(o))}">
      ${portrait(o, currentEmotion(o, meeting.log, o.id), 46, 'pop')}
      ${BADGE[ans] ? `<i>${BADGE[ans]}</i>` : ''}${chair ? '<u title="RT">★</u>' : ''}
      <small>${esc(o.name.split(' ')[0])}</small></button>`;
  }).join('');
  const head = `
    <div class="room-head"><button id="mt-back" class="link back">${live && !live.ended ? t('neg.back') : t('chat.backList')}</button></div>
    <h2>👥 ${t('chat.meeting', { n: people.length })}</h2>
    <div class="mfaces">${faces}</div>
    <div class="transcript" id="mt-log">${transcriptHtml(game, meeting.log, null)}</div>`;

  if (!live || live.ended) {
    el.innerHTML = `<div class="neg meeting">${head}
      ${live?.ended ? `<div class="outcome outcome-${live.outcome}">${tk(`meet.ended.${live.outcome}`)}</div>` : ''}
      <button id="mt-close" class="primary wide">${live ? t('chat.backMap') : t('chat.backList')}</button></div>`;
    finish(el, a);
    el.querySelector<HTMLElement>('#mt-close')!.onclick = a.back;
    return;
  }

  if (!mdraft || mdraft.id !== meeting.id) mdraft = { id: meeting.id, pct: 100, opts: new Set() };
  const d = mdraft;
  const opts = [...d.opts];
  const totalValue = Object.keys(live.answers).filter((id) => live.answers[id] !== 'absent').reduce((s, id) => s + live.values[id], 0);
  const payAll = offerPayNow(game, live, d.pct, opts);
  const tl = tally(live);
  const sign = signCost(game, live);
  const asks = asksCost(game, live);
  const fund = fundCost(game, live);
  const canOffer = live.patience > 0 && payAll <= game.money;

  el.innerHTML = `<div class="neg meeting">${head}
    <div class="composer">
      <div class="offer-head"><span>${t('meet.offerAll')}</span><strong>${d.pct}%</strong></div>
      <input id="mt-pct" type="range" min="40" max="220" step="1" value="${d.pct}" />
      <div class="offer-sub"><span>${t('meet.valueTotal', { value: money(w, totalValue) })}</span>
        <span class="quick">${[90, 100, 115, 130].map((p) => `<button data-pct="${p}" class="${p === d.pct ? 'active' : ''}">${p}%</button>`).join('')}</span></div>
      <div class="opts">${DEAL_OPTIONS.map((k) => `<label class="check opt"><input type="checkbox" data-opt="${k}" ${d.opts.has(k) ? 'checked' : ''}/>
        <span>${tk(`opt.${k}`)}<small>${money(w, optionCost(game, k, totalValue / Math.max(1, people.length)))} · ${IMMEDIATE_OPTIONS.includes(k) ? t('opt.paidNow') : t('opt.promise')} · ${t('meet.each')}</small></span></label>`).join('')}</div>
      <div class="summary">
        <span>${t('meet.ifAll')}: <b class="${payAll <= game.money ? '' : 'bad'}">${money(w, payAll)}</b></span>
        <span>${t('meet.patience')}: <b>${'●'.repeat(Math.max(0, live.patience))}${'○'.repeat(Math.max(0, 4 - live.patience))}</b></span>
        <span>${t('meet.tally', tl)}</span>
      </div>
      <div class="actions-main">
        <button id="mt-offer" class="primary" ${canOffer ? '' : 'disabled'}>${t('meet.offerBtn')}</button>
        ${asks ? `<button id="mt-asks" class="accept" ${asks + sign <= game.money ? '' : 'disabled'}>${t('meet.acceptAsks', { n: tl.maybe, cost: money(w, asks) })}</button>` : ''}
      </div>
      ${tl.yes ? `<button id="mt-sign" class="accept wide" ${sign <= game.money ? '' : 'disabled'}>✍ ${t('meet.sign', { n: tl.yes, cost: money(w, sign) })}</button>` : ''}
      <div class="actions-side">
        <button id="mt-present" ${live.presented ? 'disabled' : ''}>📐 ${t('meet.present')}</button>
        <button id="mt-listen" ${live.listened ? 'disabled' : ''}>👂 ${t('meet.listen')}</button>
        <button id="mt-fund" ${live.funded || fund > game.money ? 'disabled' : ''} title="${t('meet.fundHint')}">🕌 ${t('meet.fund', { cost: money(w, fund) })}</button>
        <button id="mt-leave">${t('neg.leave')}</button>
      </div>
    </div></div>`;
  finish(el, a);
  const q = <T extends HTMLElement>(id: string) => el.querySelector<T>(id);
  const rerender = () => renderMeeting(el, game, meeting, live, a);
  const slider = q<HTMLInputElement>('#mt-pct')!;
  slider.oninput = () => { d.pct = parseInt(slider.value, 10); el.querySelector('.offer-head strong')!.textContent = `${d.pct}%`; };
  slider.onchange = rerender;
  el.querySelectorAll<HTMLElement>('[data-pct]').forEach((b) => (b.onclick = () => { d.pct = parseInt(b.dataset.pct!, 10); rerender(); }));
  el.querySelectorAll<HTMLInputElement>('[data-opt]').forEach((c) => (c.onchange = () => {
    const k = c.dataset.opt as DealOption;
    if (c.checked) d.opts.add(k); else d.opts.delete(k);
    rerender();
  }));
  q('#mt-offer')!.onclick = () => a.offer(d.pct, opts);
  q('#mt-asks')?.addEventListener('click', a.acceptAsks);
  q('#mt-sign')?.addEventListener('click', a.sign);
  q('#mt-present')!.onclick = a.present;
  q('#mt-listen')!.onclick = a.listenAll;
  q('#mt-fund')!.onclick = a.fund;
  q('#mt-leave')!.onclick = a.leave;
}

function finish(el: HTMLElement, a: MeetingActions) {
  const log = el.querySelector<HTMLElement>('#mt-log')!;
  log.scrollTop = log.scrollHeight;
  el.querySelector<HTMLElement>('#mt-back')!.onclick = a.back;
  el.querySelectorAll<HTMLElement>('[data-owner]').forEach((b) => (b.onclick = () => a.openOwner(b.dataset.owner!)));
}

export function resetMeetingDraft() {
  mdraft = null;
}

/** Side panel for several selected plots. */
export function renderMulti(el: HTMLElement, game: Game, plotIds: string[], a: { meet(): void; clear(): void; focus(id: string): void; remove(id: string): void }) {
  const w = game.world;
  const byOwner = new Map<string, string[]>();
  for (const id of plotIds) {
    const p = w.plot(id);
    if (!p) continue;
    const list = byOwner.get(p.ownerId) ?? [];
    list.push(id);
    byOwner.set(p.ownerId, list);
  }
  const total = plotIds.reduce((s, id) => s + (w.plot(id)?.value ?? 0), 0);
  const area = plotIds.reduce((s, id) => s + (w.plot(id)?.area ?? 0), 0);
  const invitable = [...byOwner.keys()].filter((id) => {
    const o = w.owner(id)!;
    return o.kind !== 'state' && byOwner.get(id)!.some((pid) => !game.ownsPlot(pid));
  });
  el.innerHTML = `
    <div class="panel-head"><span class="pill" style="--c:#e0a458">${t('multi.count', { n: plotIds.length })}</span>
      <button id="panel-close" class="icon" aria-label="${t('panel.close')}">✕</button></div>
    <h2>${t('multi.title')}</h2>
    <dl><dt>${t('multi.total')}</dt><dd>${money(w, total)}</dd><dt>${t('panel.plotArea')}</dt><dd>${area.toLocaleString()} m²</dd>
      <dt>${t('multi.owners')}</dt><dd>${byOwner.size}</dd></dl>
    <ul class="multi-list">${[...byOwner.entries()].map(([oid, ids]) => {
      const o = w.owner(oid)!;
      const sold = ids.every((id) => game.ownsPlot(id));
      return `<li><button class="link" data-focus="${esc(ids[0])}">${portrait(o, currentEmotion(o, game.records.get(oid)?.log ?? []), 30)}
        <span><b>${esc(ownerName(o))}</b><small>${ids.length > 1 ? t('multi.plots', { n: ids.length }) : esc(tk(`cat.${w.plot(ids[0])!.category}`))} · ${money(w, ids.reduce((s, id) => s + w.plot(id)!.value, 0))}</small></span></button>
        ${sold ? '<em class="tag sold">✓</em>' : o.kind === 'state' ? `<em class="tag">${t('multi.state')}</em>` : ''}
        <button class="icon" data-remove="${esc(ids.join(','))}" aria-label="${t('multi.remove')}">✕</button></li>`;
    }).join('')}</ul>
    <button id="multi-meet" class="primary wide" ${invitable.length >= 2 && !game.session && !game.meetingSession ? '' : 'disabled'}>👥 ${t('multi.meet', { n: Math.min(invitable.length, 10) })}</button>
    ${invitable.length > 10 ? `<p class="hint">${t('multi.max')}</p>` : invitable.length < 2 ? `<p class="hint">${t('multi.need2')}</p>` : ''}
    <button id="multi-clear" class="wide">${t('multi.clear')}</button>
    <p class="hint">${t('multi.hint')}</p>`;
  el.querySelector<HTMLElement>('#panel-close')!.onclick = a.clear;
  el.querySelector<HTMLElement>('#multi-clear')!.onclick = a.clear;
  el.querySelector<HTMLElement>('#multi-meet')!.onclick = a.meet;
  el.querySelectorAll<HTMLElement>('[data-focus]').forEach((b) => (b.onclick = () => a.focus(b.dataset.focus!)));
  el.querySelectorAll<HTMLElement>('[data-remove]').forEach((b) => (b.onclick = () => b.dataset.remove!.split(',').forEach(a.remove)));
}
