import { getLang, t, tk } from '../i18n';
import type { Game } from '../game/Game';
import { buildingType } from '../game/catalog';
import { monthlyIncome } from '../game/Economy';
import {
  buyerPrice, campaignCost, listPrice, marketingActive, priceLevel, unitsLeft, buyerFace,
  type BuyerLead,
} from '../game/sales';
import { marketMult } from '../game/events';
import { dialogue } from '../i18n/dialogue';
import { esc, money } from './format';
import { portrait, emotionForMood } from './portrait';

export interface SalesActions {
  setPrice(buildingId: string, level: number): void;
  campaign(): void;
  acceptBuyer(id: string): void;
  counterBuyer(id: string, factor: number): void;
  dismissBuyer(id: string): void;
  focus(buildingId: string): void;
  close(): void;
}

function line(key: string, params?: Record<string, string | number>): string {
  const table = dialogue[getLang()] ?? dialogue.en;
  const variants = table[key] ?? dialogue.en[key] ?? [key];
  let s = variants[Math.abs(hash(key)) % variants.length];
  for (const [k, v] of Object.entries(params ?? {})) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}
function hash(s: string): number { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }

/** Price levels, marketing and walk-in buyers. */
export function renderSales(el: HTMLElement, game: Game, a: SalesActions) {
  const w = game.world;
  const income = game.dev.buildings.filter((b) => {
    const bt = buildingType(b.type);
    return bt.income !== 'civic' && b.daysLeft === 0 && b.permitDays === 0;
  });
  const lead = game.sales.leads.find((l) => !l.ended);

  const buyerCard = lead ? renderBuyer(game, lead, a) : '';

  const rows = income.map((b) => {
    const bt = buildingType(b.type);
    const lvl = priceLevel(b);
    const sale = bt.income === 'sale';
    const left = unitsLeft(b);
    const detail = sale
      ? `${t('sales.unitsLeft', { n: left, total: bt.units })} · ${money(w, listPrice(b))}/${t('sales.unit')}`
      : `${Math.round(b.occupancy * 100)}% · ${money(w, monthlyIncome(b, game.difficulty.income, marketMult(game)))}/${t('sales.mo')}`;
    return `<li class="sale-row" data-focus="${b.id}">
      <div class="sale-head"><b>${bt.icon} ${tk(`bt.${b.type}`)}</b><small>${detail}</small></div>
      <div class="price-ctl">
        <span>${t('sales.price')}</span>
        <input type="range" min="80" max="130" step="5" value="${Math.round(lvl * 100)}" data-price="${b.id}" />
        <em class="${lvl > 1.05 ? 'hi' : lvl < 0.95 ? 'lo' : ''}">${Math.round(lvl * 100)}%</em>
      </div>
      <small class="price-hint">${lvl > 1.02 ? t('sales.higher') : lvl < 0.98 ? t('sales.lower') : t('sales.market')}</small>
    </li>`;
  }).join('');

  el.innerHTML = `
    <div class="panel-head"><h2>📈 ${t('sales.title')}</h2><button id="panel-close" class="icon" aria-label="${t('panel.close')}">✕</button></div>
    ${buyerCard}
    <div class="campaign">
      <div><b>📣 ${t('sales.campaign')}</b><small>${marketingActive(game) ? t('sales.campaignOn', { days: game.sales.campaign!.until - game.day }) : t('sales.campaignOff')}</small></div>
      <button id="sales-campaign" class="primary" ${marketingActive(game) || campaignCost(game) > game.money ? 'disabled' : ''}>${t('sales.runCampaign', { cost: money(w, campaignCost(game)) })}</button>
    </div>
    <h3>${t('sales.yourBuildings')}</h3>
    ${income.length ? `<ul class="sale-list">${rows}</ul>` : `<p class="muted">${t('sales.none')}</p>`}
    <p class="hint">${t('sales.hint')}</p>`;

  el.querySelector<HTMLElement>('#panel-close')!.onclick = a.close;
  el.querySelector<HTMLElement>('#sales-campaign')!.onclick = a.campaign;
  el.querySelectorAll<HTMLInputElement>('[data-price]').forEach((r) => {
    r.oninput = () => { const em = r.parentElement!.querySelector('em')!; em.textContent = `${r.value}%`; };
    r.onchange = () => a.setPrice(r.dataset.price!, parseInt(r.value, 10) / 100);
  });
  el.querySelectorAll<HTMLElement>('[data-focus]').forEach((b) => (b.onclick = (e) => {
    if ((e.target as HTMLElement).closest('input, button')) return;
    a.focus(b.dataset.focus!);
  }));
  wireBuyer(el, a);
}

function renderBuyer(game: Game, l: BuyerLead, _a: SalesActions): string {
  const w = game.world;
  const b = game.dev.buildings.find((x) => x.id === l.buildingId);
  if (!b) return '';
  const face = buyerFace(l);
  const emo = emotionForMood(face.mood);
  const price = buyerPrice(game, l);
  const list = listPrice(b) * l.units;
  const transcript = l.log.map((e) => e.who === 'player'
    ? `<div class="msg player"><div class="bubble player">${esc(line(e.key, e.params))}</div></div>`
    : `<div class="msg owner"><span class="face">${portrait(face, emo, 30)}</span><div class="bubble owner">${esc(line(e.key, e.params))}</div></div>`).join('');
  return `
    <div class="buyer-card">
      <div class="speaker">
        <div class="big-face">${portrait(face, emo, 64, 'pop')}</div>
        <div class="who"><b>${esc(l.honorific ? `${l.honorific} ${l.name}` : l.name)}</b>
          <small>${t('sales.wants', { n: l.units, building: tk(`bt.${b.type}`) })}</small></div>
      </div>
      <div class="transcript">${transcript}</div>
      ${l.ended ? `<div class="outcome outcome-${l.ended === 'bought' ? 'sold' : 'left'}">${t(`sales.ended.${l.ended}`)}</div>`
        : `<div class="buyer-offer"><span>${t('sales.theirOffer')}</span><strong>${money(w, price)}</strong>
             <small>${t('sales.listIs', { price: money(w, list) })}</small></div>
           <div class="actions-main">
             <button class="primary" data-accept="${l.id}">${t('sales.accept', { price: money(w, price) })}</button>
             <button class="accept" data-counter="${l.id}">${t('sales.counterList')}</button>
           </div>
           <button class="wide" data-decline="${l.id}">${t('sales.decline')}</button>`}
    </div>`;
}

function wireBuyer(el: HTMLElement, a: SalesActions) {
  el.querySelectorAll<HTMLElement>('[data-accept]').forEach((b) => (b.onclick = () => a.acceptBuyer(b.dataset.accept!)));
  el.querySelectorAll<HTMLElement>('[data-counter]').forEach((b) => (b.onclick = () => a.counterBuyer(b.dataset.counter!, 1)));
  el.querySelectorAll<HTMLElement>('[data-decline]').forEach((b) => (b.onclick = () => a.dismissBuyer(b.dataset.decline!)));
}
