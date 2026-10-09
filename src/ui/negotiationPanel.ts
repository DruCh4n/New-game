import { t, tk } from '../i18n';
import type { Game } from '../game/Game';
import {
  DEAL_OPTIONS, IMMEDIATE_OPTIONS, giftCost, helpCost, immediateCost, neighborHelper, optionCost, rtHeadFor, rtOnSide,
  type DealOption, type LogEntry, type Session,
} from '../game/negotiation';
import type { Owner } from '../game/types';
import { esc, formatDate, money, moodLabel, ownerName, renderLine } from './format';
import { emotionForLine, emotionForMood, portrait, type Emotion } from './portrait';
import { markRead } from '../game/messages';

export interface NegotiationActions {
  offer(cash: number, opts: DealOption[]): void;
  acceptAsk(): void;
  listen(): void;
  gift(): void;
  pressure(): void;
  askHelp(kind: 'neighbor' | 'rt'): void;
  leave(): void;
  back(): void;
  /** Room view (no conversation running): start a visit, show the owner's land, or go to the chat list. */
  visitOwner(ownerId: string): void;
  showOnMap(ownerId: string): void;
  chats(): void;
}

/** Offer composer state survives re-renders within one conversation. */
let draft: { ownerId: string; pct: number; opts: Set<DealOption> } | null = null;

/** Current expression: their latest line in this room, or their mood. */
export function currentEmotion(o: Owner, log: LogEntry[], by?: string): Emotion {
  for (let i = log.length - 1; i >= 0 && i >= log.length - 6; i--) {
    const e = log[i];
    if (e.who === 'system') break;
    if (e.who === 'owner' && (e.by ?? by) === by) return emotionForLine(e.key) ?? emotionForMood(o.mood);
  }
  return emotionForMood(o.mood);
}

/** Chat transcript with a face next to each line. `main` is the room's owner (null for group rooms). */
export function transcriptHtml(game: Game, log: LogEntry[], main: Owner | null): string {
  const w = game.world;
  let lastSpeaker = '';
  return log.map((e) => {
    if (e.who === 'system') {
      lastSpeaker = '';
      if (e.key === 'system.visit' || e.key === 'system.meeting' || e.key === 'system.meetingPersonal') {
        return `<div class="sep"><span>${esc(renderLine(w, e))} · ${formatDate(game.date(e.day))}</span></div>`;
      }
      return `<div class="sys">${esc(renderLine(w, e))}</div>`;
    }
    if (e.who === 'player') {
      lastSpeaker = 'player';
      const optText = e.opts?.length ? `<small>+ ${e.opts.map((k) => tk(`opt.${k}`)).join(', ')}</small>` : '';
      return `<div class="msg player"><div class="bubble player">${esc(renderLine(w, e))}${optText}</div></div>`;
    }
    const speaker = e.by ? w.owner(e.by) ?? main : main;
    if (!speaker) return '';
    const emo = emotionForLine(e.key) ?? emotionForMood(speaker.mood);
    const named = !main || (e.by && e.by !== main.id);
    const cont = lastSpeaker === speaker.id;
    lastSpeaker = speaker.id;
    const msg = e.key.startsWith('msg.') ? ' incoming' : '';
    return `<div class="msg owner${cont ? ' cont' : ''}${msg}">
      <span class="face">${cont ? '' : portrait(speaker, emo, 30)}</span>
      <div class="bubble owner${named && e.by !== main?.id ? ' other' : ''}">${named && !cont ? `<b class="who">${esc(ownerName(speaker))}</b>` : ''}${e.key.startsWith('msg.') ? '<i class="via">💬</i>' : ''}${esc(renderLine(w, e))}</div>
    </div>`;
  }).join('');
}

export function renderNegotiation(el: HTMLElement, game: Game, ownerId: string, s: Session | null, a: NegotiationActions) {
  const w = game.world;
  const o = w.owner(ownerId)!;
  const rec = game.record(o.id);
  markRead(game, o.id);
  const live = s && s.ownerId === o.id ? s : null;
  const isState = o.kind === 'state';
  const pref = rec.knownPreference;
  const emo = currentEmotion(o, rec.log);
  const subtitle = live ? t('neg.package', { n: live.plotIds.length, value: money(w, live.value) })
    : o.kind === 'person' ? [o.age ? t('panel.age', { age: o.age }) : '', o.occupation ? tk(`occ.${o.occupation}`) : ''].filter(Boolean).join(' · ')
      : tk(`kind.${o.kind}`);

  const head = `
    <div class="room-head">
      <button id="neg-back" class="link back">${live ? t('neg.back') : t('chat.backList')}</button>
    </div>
    <div class="speaker">
      <div class="big-face">${portrait(o, emo, 84, 'pop')}</div>
      <div class="who">
        <b>${esc(ownerName(o))}</b><small>${esc(subtitle)}</small>
        ${isState ? '' : `<div class="trait"><span>${t('neg.mood')}</span><div class="meter mood"><i style="width:${Math.round(o.mood)}%"></i></div><em>${moodLabel(o.mood)}</em></div>`}
      </div>
    </div>
    ${pref ? `<p class="pref">💡 ${t('neg.knownPref', { pref: tk(`pref.${pref}`) })}</p>` : ''}
    <div class="transcript" id="neg-log">${transcriptHtml(game, rec.log, o) || `<p class="hint center">${t('chat.empty')}</p>`}</div>`;

  if (!live) {
    const unsold = o.plotIds.some((id) => !game.ownsPlot(id));
    el.innerHTML = `<div class="neg">${head}
      <div class="room-actions">
        ${unsold && !game.meetingSession ? `<button id="room-visit" class="primary">${isState ? t('panel.applyState') : t('panel.visit')}</button>` : ''}
        <button id="room-map">📍 ${t('chat.showMap')}</button>
      </div></div>`;
    wire(el, a);
    el.querySelector('#room-visit')?.addEventListener('click', () => a.visitOwner(o.id));
    el.querySelector<HTMLElement>('#room-map')!.onclick = () => a.showOnMap(o.id);
    el.querySelector<HTMLElement>('#neg-back')!.onclick = a.chats;
    return;
  }

  if (!draft || draft.ownerId !== o.id) draft = { ownerId: o.id, pct: 100, opts: new Set() };
  const d = draft;
  const step = w.region.priceStep;
  const cash = Math.max(step, Math.round((live.value * d.pct) / 100 / step) * step);
  const opts = isState ? [] : [...d.opts];
  const payNow = immediateCost(game, live.value, cash, opts);
  const promises = opts.filter((k) => !IMMEDIATE_OPTIONS.includes(k));
  const affordable = payNow <= game.money;
  const neighbor = !isState ? neighborHelper(game, o) : null;
  const rt = !isState ? rtHeadFor(game, o) : null;
  const helped = (id?: string) => !!id && !!live.helped?.includes(id);

  el.innerHTML = `
    <div class="neg">${head}
      ${live.ended ? `
        <div class="outcome outcome-${live.outcome}">${tk(`neg.ended.${live.outcome}`)}</div>
        <button id="neg-close" class="primary wide">${t('chat.backMap')}</button>
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
              const c = optionCost(game, k, live.value);
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
            ${live.askCash !== null ? `<button id="neg-accept" class="accept">${t('neg.acceptAsk', { price: money(w, live.askCash) })}</button>` : ''}
          </div>
          <div class="actions-side">
            <button id="neg-listen" title="${t('neg.listenHint')}">👂 ${t('neg.listen')}</button>
            <button id="neg-gift" title="${t('neg.giftHint')}">🎁 ${t('neg.gift', { cost: money(w, giftCost(game, live)) })}</button>
            <button id="neg-pressure" class="danger" title="${t('neg.pressureHint')}">⚠ ${t('neg.pressure')}</button>
            <button id="neg-leave">${t('neg.leave')}</button>
          </div>
          ${isState ? '' : `
          <div class="helpers">
            <span class="group-label">${t('help.title')}</span>
            <button id="neg-help-neighbor" ${!neighbor || helped(neighbor.id) ? 'disabled' : ''} title="${neighbor ? t('help.neighborHint') : t('help.noNeighbor')}">
              ${neighbor ? portrait(neighbor, 'happy', 22) : '🤝'} ${neighbor ? t('help.neighbor', { name: esc(ownerName(neighbor)), cost: money(w, helpCost(game, live, 'neighbor')) }) : t('help.noNeighbor')}</button>
            <button id="neg-help-rt" ${!rt || helped(rt.id) ? 'disabled' : ''} title="${rt ? t(rtOnSide(game, rt) ? 'help.rtHint' : 'help.rtCold') : t('help.noRt')}">
              ${rt ? portrait(rt, rtOnSide(game, rt) ? 'happy' : 'worried', 22) : '🏠'} ${rt ? t('help.rt', { name: esc(ownerName(rt)), cost: money(w, helpCost(game, live, 'rt')) }) : t('help.noRt')}</button>
          </div>`}
        </div>`}
    </div>`;

  wire(el, a);
  const q = <T extends HTMLElement>(id: string) => el.querySelector<T>(id);
  q('#neg-close')?.addEventListener('click', a.back);
  if (live.ended) return;

  const rerender = () => renderNegotiation(el, game, ownerId, live, a);
  const slider = q<HTMLInputElement>('#neg-pct')!;
  slider.oninput = () => {
    d.pct = parseInt(slider.value, 10);
    // update the numbers without rebuilding (keeps the slider grabbed)
    const c = Math.max(step, Math.round((live.value * d.pct) / 100 / step) * step);
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
  q('#neg-help-neighbor')?.addEventListener('click', () => a.askHelp('neighbor'));
  q('#neg-help-rt')?.addEventListener('click', () => a.askHelp('rt'));
}

function wire(el: HTMLElement, a: NegotiationActions) {
  const log = el.querySelector<HTMLElement>('#neg-log')!;
  log.scrollTop = log.scrollHeight;
  el.querySelector<HTMLElement>('#neg-back')!.onclick = a.back;
}

/** Forget the composer state (new conversation partner). */
export function resetDraft() {
  draft = null;
}
