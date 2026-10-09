import { t, tk } from '../i18n';
import type { Game } from '../game/Game';
import {
  DEAL_OPTIONS, IMMEDIATE_OPTIONS, giftCost, immediateCost, optionCost, type DealOption, type Session,
} from '../game/negotiation';
import { hashString } from '../util/random';
import { esc, formatDate, initials, money, moodLabel, ownerName, renderLine } from './format';

export interface NegotiationActions {
  offer(cash: number, opts: DealOption[]): void;
  acceptAsk(): void;
  listen(): void;
  gift(): void;
  pressure(): void;
  leave(): void;
  back(): void;
}

/** Offer composer state survives re-renders within one conversation. */
let draft: { ownerId: string; pct: number; opts: Set<DealOption> } | null = null;

export function renderNegotiation(el: HTMLElement, game: Game, s: Session, a: NegotiationActions) {
  const w = game.world;
  const o = w.owner(s.ownerId)!;
  const rec = game.record(o.id);
  if (!draft || draft.ownerId !== o.id) draft = { ownerId: o.id, pct: 100, opts: new Set() };
  const d = draft;
  const isState = o.kind === 'state';
  const step = w.region.priceStep;
  const cash = Math.max(step, Math.round((s.value * d.pct) / 100 / step) * step);
  const opts = isState ? [] : [...d.opts];
  const payNow = immediateCost(game, s.value, cash, opts);
  const promises = opts.filter((k) => !IMMEDIATE_OPTIONS.includes(k));
  const affordable = payNow <= game.money;

  // ---- transcript: this visit and earlier ones ----
  const lines = rec.log.map((e) => {
    if (e.who === 'system' && e.key === 'system.visit') {
      return `<div class="sep"><span>${esc(renderLine(w, e))} · ${formatDate(game.date(e.day))}</span></div>`;
    }
    if (e.who === 'system') return `<div class="sys">${esc(renderLine(w, e))}</div>`;
    const optText = e.opts?.length ? `<small>+ ${e.opts.map((k) => tk(`opt.${k}`)).join(', ')}</small>` : '';
    return `<div class="bubble ${e.who}">${esc(renderLine(w, e))}${optText}</div>`;
  }).join('');

  const moodPct = Math.round(o.mood);
  const hue = hashString(o.id) % 360;
  const pref = rec.knownPreference;

  el.innerHTML = `
    <div class="neg">
      <button id="neg-back" class="link back">${t('neg.back')}</button>
      <div class="owner">
        <div class="avatar" style="--h:${hue}">${esc(initials(o.name || ownerName(o)))}</div>
        <div><b>${esc(ownerName(o))}</b><small>${t('neg.package', { n: s.plotIds.length, value: money(w, s.value) })}</small></div>
      </div>
      ${isState ? '' : `<div class="trait"><span>${t('neg.mood')}</span><div class="meter mood"><i style="width:${moodPct}%"></i></div><em>${moodLabel(o.mood)}</em></div>`}
      ${pref ? `<p class="pref">💡 ${t('neg.knownPref', { pref: tk(`pref.${pref}`) })}</p>` : ''}
      <div class="transcript" id="neg-log">${lines}</div>
      ${s.ended ? `
        <div class="outcome outcome-${s.outcome}">${tk(`neg.ended.${s.outcome}`)}</div>
        <button id="neg-close" class="primary wide">${t('neg.back')}</button>
      ` : `
        <div class="composer">
          <div class="offer-head"><span>${t('neg.yourOffer')}</span><strong>${money(w, cash)}</strong></div>
          <input id="neg-pct" type="range" min="30" max="250" step="1" value="${d.pct}" aria-label="${t('neg.yourOffer')}" />
          <div class="offer-sub">
            <span>${t('neg.ofValue', { pct: d.pct })}</span>
            <span class="quick">${[80, 100, 120, 150].map((p) => `<button data-pct="${p}" class="${p === d.pct ? 'active' : ''}">${p}%</button>`).join('')}</span>
          </div>
          ${isState ? '' : `
          <div class="opts">
            ${DEAL_OPTIONS.map((k) => {
              const c = optionCost(game, k, s.value);
              const immediate = IMMEDIATE_OPTIONS.includes(k);
              return `<label class="check opt"><input type="checkbox" data-opt="${k}" ${d.opts.has(k) ? 'checked' : ''}/>
                <span>${tk(`opt.${k}`)}<small>${money(w, c)} · ${immediate ? t('opt.paidNow') : t('opt.promise')}</small></span></label>`;
            }).join('')}
          </div>`}
          <div class="summary">
            <span>${t('neg.payNow')}: <b class="${affordable ? '' : 'bad'}">${money(w, payNow)}</b></span>
            <span>${t('neg.promises')}: <b>${promises.length ? promises.map((k) => tk(`opt.${k}`)).join(', ') : t('neg.none')}</b></span>
          </div>
          ${affordable ? '' : `<p class="warn">${t('neg.notEnough')}</p>`}
          <div class="actions-main">
            <button id="neg-offer" class="primary" ${affordable ? '' : 'disabled'}>${t('neg.makeOffer')}</button>
            ${s.askCash !== null ? `<button id="neg-accept" class="accept">${t('neg.acceptAsk', { price: money(w, s.askCash) })}</button>` : ''}
          </div>
          <div class="actions-side">
            <button id="neg-listen" title="${t('neg.listenHint')}">👂 ${t('neg.listen')}</button>
            <button id="neg-gift" title="${t('neg.giftHint')}">🎁 ${t('neg.gift', { cost: money(w, giftCost(game, s)) })}</button>
            <button id="neg-pressure" class="danger" title="${t('neg.pressureHint')}">⚠ ${t('neg.pressure')}</button>
            <button id="neg-leave">${t('neg.leave')}</button>
          </div>
        </div>`}
    </div>`;

  const log = el.querySelector<HTMLElement>('#neg-log')!;
  log.scrollTop = log.scrollHeight;
  const q = <T extends HTMLElement>(id: string) => el.querySelector<T>(id);
  q('#neg-back')!.onclick = a.back;
  q('#neg-close')?.addEventListener('click', a.back);
  if (s.ended) return;

  const rerender = () => renderNegotiation(el, game, s, a);
  const slider = q<HTMLInputElement>('#neg-pct')!;
  slider.oninput = () => {
    d.pct = parseInt(slider.value, 10);
    // update the numbers without rebuilding (keeps the slider grabbed)
    const c = Math.max(step, Math.round((s.value * d.pct) / 100 / step) * step);
    el.querySelector('.offer-head strong')!.textContent = money(w, c);
    el.querySelector('.offer-sub > span')!.textContent = t('neg.ofValue', { pct: d.pct });
  };
  slider.onchange = rerender;
  el.querySelectorAll<HTMLElement>('[data-pct]').forEach((b) => (b.onclick = () => { d.pct = parseInt(b.dataset.pct!, 10); rerender(); }));
  el.querySelectorAll<HTMLInputElement>('[data-opt]').forEach((c) => (c.onchange = () => {
    const k = c.dataset.opt as DealOption;
    if (c.checked) d.opts.add(k);
    else d.opts.delete(k);
    rerender();
  }));
  q('#neg-offer')!.onclick = () => a.offer(cash, opts);
  q('#neg-accept')?.addEventListener('click', a.acceptAsk);
  q('#neg-listen')!.onclick = a.listen;
  q('#neg-gift')!.onclick = a.gift;
  q('#neg-pressure')!.onclick = a.pressure;
  q('#neg-leave')!.onclick = a.leave;
}

/** Forget the composer state (new conversation partner). */
export function resetDraft() {
  draft = null;
}
