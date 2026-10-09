import { getLang, t, tk } from '../i18n';
import type { Game } from '../game/Game';
import {
  borrow, buildingsValue, creditLimit, debt, loanRate, ownedLandValue, PROMISE_DAYS, repay, type MonthReport,
} from '../game/Economy';
import { buildingType } from '../game/catalog';
import { esc, formatDate, money, ownerName } from './format';

/** Finance side panel: balance sheet, monthly cash-flow chart, last month, loans, promises. */
export function renderFinance(el: HTMLElement, game: Game, onChange: () => void) {
  const w = game.world;
  const m = (v: number) => money(w, v);
  const land = ownedLandValue(game), blds = buildingsValue(game), d = debt(game);
  const limit = creditLimit(game);
  const rate = loanRate(game);
  const last = game.reports[game.reports.length - 1];
  const monthName = (r: MonthReport) => {
    const dt = game.date(r.day - 1);
    return dt.toLocaleDateString(getLang() === 'id' ? 'id-ID' : 'en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  };

  const row = (label: string, v: number, cls = '') => `<dt>${label}</dt><dd class="${cls}">${m(v)}</dd>`;
  const lastBlock = last ? `
    <h3>${t('fin.lastMonth', { month: monthName(last) })}</h3>
    <dl class="fin-table">
      ${last.income.rent ? row(t('fin.rent'), last.income.rent, 'pos') : ''}
      ${last.income.leases ? row(t('fin.leases'), last.income.leases, 'pos') : ''}
      ${last.income.sales ? row(t('fin.sales'), last.income.sales, 'pos') : ''}
      ${last.income.oldBuildings ? row(t('fin.oldBuildings'), last.income.oldBuildings, 'pos') : ''}
      ${last.costs.interest ? row(t('fin.interest'), -last.costs.interest, 'neg') : ''}
      ${last.costs.maintenance ? row(t('fin.maintenance'), -last.costs.maintenance, 'neg') : ''}
      ${last.costs.tax ? row(t('fin.tax'), -last.costs.tax, 'neg') : ''}
      ${last.costs.overdraft ? row(t('fin.overdraft'), -last.costs.overdraft, 'neg') : ''}
      <dt class="total">${t('fin.net')}</dt><dd class="total ${last.net >= 0 ? 'pos' : 'neg'}">${m(last.net)}</dd>
    </dl>` : '';

  const loans = game.loans.length
    ? `<ul class="loans">${game.loans.map((l) => `<li>
        <span>${t('fin.loanRow', { amount: m(l.principal), rate: (l.rate * 100).toFixed(1), interest: m((l.principal * l.rate) / 12) })}</span>
        <button data-repay="${l.id}" ${game.money <= 0 ? 'disabled' : ''}>${t('fin.repay', { amount: m(Math.min(l.principal, Math.max(0, game.money))) })}</button></li>`).join('')}</ul>`
    : `<p class="muted">${t('fin.noLoans')}</p>`;
  const borrowOpts = [0.1, 0.25, 0.5, 1].map((f) => Math.floor((limit * f) / w.region.priceStep) * w.region.priceStep).filter((v, i, a) => v > 0 && a.indexOf(v) === i);

  const open = game.obligations.filter((o) => o.fulfilled === undefined && !o.broken);
  const promises = game.obligations.length ? `<ul class="promises">${game.obligations.slice(-12).map((o) => {
    const owner = w.owner(o.ownerId);
    const state = o.fulfilled !== undefined ? `<span class="ok">${t('fin.promiseKept')}</span>`
      : o.broken ? `<span class="bad">${t('fin.promiseBroken')}</span>`
        : `<span>${t('fin.promiseDue', { date: formatDate(game.date(o.day + PROMISE_DAYS)) })}</span>`;
    return `<li><span>${t('fin.promiseRow', { kind: tk(`opt.${o.kind}`), owner: esc(owner ? ownerName(owner) : o.ownerId) })}</span>${state}</li>`;
  }).join('')}</ul>` : `<p class="muted">${t('fin.noPromises')}</p>`;

  const earners = game.dev.buildings.filter((b) => b.incomeLastMonth > 0).sort((a, b) => b.incomeLastMonth - a.incomeLastMonth).slice(0, 6);

  el.innerHTML = `
    <div class="panel-head"><h2>${t('fin.title')}</h2><button id="panel-close" class="icon" aria-label="${t('panel.close')}">✕</button></div>
    <dl class="fin-table">
      ${row(t('fin.balance'), game.money, game.money < 0 ? 'neg' : '')}
      ${row(t('fin.land'), land)}
      ${row(t('fin.buildings'), blds)}
      ${row(t('fin.debt'), -d, d ? 'neg' : '')}
      <dt class="total">${t('fin.netWorth')}</dt><dd class="total">${m(game.money + land + blds - d)}</dd>
    </dl>
    <h3>${t('fin.chart')}</h3>
    ${chart(game)}
    ${lastBlock}
    ${earners.length ? `<h3>${t('fin.portfolio')}</h3><dl class="fin-table">${earners.map((b) => `<dt>${buildingType(b.type).icon} ${tk(`bt.${b.type}`)}</dt><dd class="pos">${m(b.incomeLastMonth)}</dd>`).join('')}</dl>` : ''}
    <h3>${t('fin.loans')}</h3>
    ${loans}
    <p class="muted">${t('fin.credit', { amount: m(limit), rate: (rate * 100).toFixed(1) })}</p>
    <div class="row">${borrowOpts.map((v) => `<button data-borrow="${v}">${t('fin.borrow', { amount: m(v) })}</button>`).join('')}</div>
    <p class="hint">${t('fin.creditHint')}</p>
    <h3>${t('fin.promises')}${open.length ? ` (${open.length})` : ''}</h3>
    ${promises}`;

  el.querySelectorAll<HTMLElement>('[data-borrow]').forEach((b) => (b.onclick = () => { borrow(game, parseFloat(b.dataset.borrow!)); onChange(); }));
  el.querySelectorAll<HTMLElement>('[data-repay]').forEach((b) => (b.onclick = () => {
    const loan = game.loans.find((l) => l.id === b.dataset.repay);
    if (loan) repay(game, loan.id, loan.principal);
    onChange();
  }));
  wireChartHover(el, game);
}

const CHART_W = 360, CHART_H = 120, PAD_L = 4, PAD_R = 4;

/** Diverging bar chart of the last 24 months' net cash flow, zero baseline, hover for details. */
function chart(game: Game): string {
  const reports = game.reports.slice(-24);
  if (!reports.length) return `<p class="muted">${t('fin.chartEmpty')}</p>`;
  const max = Math.max(1, ...reports.map((r) => Math.abs(r.net)));
  const hasNeg = reports.some((r) => r.net < 0), hasPos = reports.some((r) => r.net > 0);
  const zeroY = hasNeg && hasPos ? CHART_H / 2 : hasNeg ? 8 : CHART_H - 8;
  const scale = (hasNeg && hasPos ? CHART_H / 2 - 8 : CHART_H - 16) / max;
  const slot = (CHART_W - PAD_L - PAD_R) / 24;
  const bw = Math.max(3, slot - 2); // 2px surface gap between bars
  const bars = reports.map((r, i) => {
    const x = PAD_L + (24 - reports.length + i) * slot + (slot - bw) / 2;
    const h = Math.max(1, Math.abs(r.net) * scale);
    const y = r.net >= 0 ? zeroY - h : zeroY;
    const rad = Math.min(4, bw / 2, h);
    // rounded only at the data end, square at the baseline
    const path = r.net >= 0
      ? `M${x},${zeroY} V${y + rad} Q${x},${y} ${x + rad},${y} H${x + bw - rad} Q${x + bw},${y} ${x + bw},${y + rad} V${zeroY} Z`
      : `M${x},${zeroY} V${y + h - rad} Q${x},${y + h} ${x + rad},${y + h} H${x + bw - rad} Q${x + bw},${y + h} ${x + bw},${y + h - rad} V${zeroY} Z`;
    return `<path d="${path}" class="${r.net >= 0 ? 'bar-pos' : 'bar-neg'}"/>
      <rect x="${PAD_L + (24 - reports.length + i) * slot}" y="0" width="${slot}" height="${CHART_H}" class="hit" data-i="${game.reports.length - reports.length + i}"/>`;
  }).join('');
  return `<div class="chart-wrap">
    <svg class="chart" viewBox="0 0 ${CHART_W} ${CHART_H}" role="img" aria-label="${t('fin.chart')}">
      <line x1="0" x2="${CHART_W}" y1="${zeroY}" y2="${zeroY}" class="baseline"/>
      ${bars}
    </svg>
    <div class="chart-tip" hidden></div>
  </div>`;
}

function wireChartHover(el: HTMLElement, game: Game) {
  const tip = el.querySelector<HTMLElement>('.chart-tip');
  const wrap = el.querySelector<HTMLElement>('.chart-wrap');
  if (!tip || !wrap) return;
  el.querySelectorAll<SVGRectElement>('.hit').forEach((r) => {
    r.addEventListener('pointerenter', () => {
      const rep = game.reports[parseInt(r.dataset.i!, 10)];
      const dt = game.date(rep.day - 1).toLocaleDateString(getLang() === 'id' ? 'id-ID' : 'en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
      const inc = rep.income.rent + rep.income.leases + rep.income.sales + rep.income.oldBuildings;
      const cost = rep.costs.interest + rep.costs.maintenance + rep.costs.tax + rep.costs.overdraft;
      tip.innerHTML = `<b>${dt}</b><span>${t('fin.net')}: ${money(game.world, rep.net)}</span><span>+${money(game.world, inc)} / −${money(game.world, cost)}</span>`;
      tip.hidden = false;
      const box = r.getBoundingClientRect(), wb = wrap.getBoundingClientRect();
      tip.style.left = `${Math.min(wb.width - tip.offsetWidth, Math.max(0, box.left - wb.left - tip.offsetWidth / 2 + box.width / 2))}px`;
      r.classList.add('on');
    });
    r.addEventListener('pointerleave', () => { tip.hidden = true; r.classList.remove('on'); });
  });
}
