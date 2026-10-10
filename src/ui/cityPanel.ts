import { t, tk } from '../i18n';
import type { Game } from '../game/Game';
import { marketLabel, marketMult, permitsBlocked } from '../game/events';
import { esc, formatDate } from './format';

export interface CityActions {
  focusRival(): void;
  close(): void;
}

const EVENT_ICON: Record<string, string> = { boom: '📈', crash: '📉', flood: '🌊', election: '🗳', festival: '🎉', protest: '📢' };

/** City news, the market, active events, protests and the rival developer. */
export function renderCity(el: HTMLElement, game: Game, a: CityActions) {
  const ev = game.events;
  const mkt = marketLabel(game);
  const mult = Math.round((marketMult(game) - 1) * 100);
  const active = ev.active.filter((e) => e.until >= game.day);
  const rival = ev.rival;

  el.innerHTML = `
    <div class="panel-head"><h2>📰 ${t('city.title')}</h2><button id="panel-close" class="icon" aria-label="${t('panel.close')}">✕</button></div>
    <div class="market market-${mkt}">
      <div><b>${t('city.market')}</b><span>${t(`city.mkt.${mkt}`)}${mult ? ` (${mult > 0 ? '+' : ''}${mult}%)` : ''}</span></div>
    </div>
    ${permitsBlocked(game) ? `<p class="hint warn">📢 ${t('city.protestsOn', { days: ev.protestsUntil - game.day })}</p>` : ''}
    ${active.length ? `<h3>${t('city.events')}</h3><ul class="events-list">${active.map((e) => `<li><span class="ev-ic">${EVENT_ICON[e.kind]}</span>
      <span><b>${tk(`event.${e.kind}`)}</b><small>${t('city.endsIn', { days: e.until - game.day })}</small></span></li>`).join('')}</ul>` : ''}
    <h3>${t('city.rival')}</h3>
    <div class="rival-box">
      <div><b>🏗 ${esc(rival.name)}</b><small>${t('city.rivalOwns', { n: rival.owned.length })}</small></div>
      ${rival.owned.length ? `<button id="city-rival" class="link">${t('city.seeRival')}</button>` : ''}
    </div>
    <h3>${t('city.news')}</h3>
    ${ev.news.length ? `<ul class="news">${[...ev.news].reverse().slice(0, 16).map((n) => `<li class="${n.kind === 'bad' ? 'bad' : n.kind === 'good' ? 'good' : ''}">
      <small>${formatDate(game.date(n.day))}</small> ${esc(tk(n.key, n.params))}</li>`).join('')}</ul>` : `<p class="muted">${t('city.noNews')}</p>`}`;
  el.querySelector<HTMLElement>('#panel-close')!.onclick = a.close;
  el.querySelector('#city-rival')?.addEventListener('click', a.focusRival);
}
