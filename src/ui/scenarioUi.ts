import { LANGS, getLang, setLang, t, tk } from '../i18n';
import type { Game } from '../game/Game';
import {
  SCENARIOS, allProgress, computeScore, highScores, scenario, type Objective, type ObjectiveProgress, type ScenarioId,
} from '../game/scenarios';
import type { MapEntry } from '../map/mapStore';
import type { SlotMeta } from '../game/saveStore';
import { START_YEAR } from '../game/owners';
import { esc, formatDate, money } from './format';

export function objectiveLabel(o: Objective): string {
  switch (o.kind) {
    case 'buildings': return t('obj.buildings', { count: o.count, types: o.types.map((x) => tk(`bt.${x}`)).join(' / ') });
    case 'homes': return t('obj.homes', { count: o.count });
    case 'reputation': return t('obj.reputation', { min: o.min });
    case 'ownArea': return t('obj.ownArea', { ha: o.m2 / 10000 });
    case 'balance': return t('obj.balance', { min: Math.round(o.min * 100) });
    case 'netWorth': return t('obj.netWorth', { multiple: o.multiple });
    case 'noBrokenPromises': return t('obj.noBrokenPromises');
    case 'plots': return t('obj.plots', { count: o.count });
  }
}

function progressText(g: Game, p: ObjectiveProgress): string {
  const o = p.objective;
  if (o.kind === 'netWorth') return `${money(g.world, p.value)} / ${money(g.world, p.target)}`;
  if (o.kind === 'ownArea') return `${(p.value / 10000).toFixed(2)} / ${(p.target / 10000).toFixed(1)} ha`;
  if (o.kind === 'balance') return `${p.value}% / ${p.target}%`;
  if (o.kind === 'noBrokenPromises') return p.done ? '✓' : `✗ ${p.value}`;
  return `${p.value.toLocaleString()} / ${p.target.toLocaleString()}`;
}

function duration(days: number): string {
  const y = Math.floor(days / 365), d = days % 365;
  const id = getLang() === 'id';
  return y ? `${y} ${id ? 'thn' : 'y'} ${d} ${id ? 'hr' : 'd'}` : `${d} ${id ? 'hari' : 'days'}`;
}

// ------------------------------------------------------------------ goals card

export function renderGoals(el: HTMLElement, g: Game | null) {
  if (!g) { el.hidden = true; return; }
  const st = g.scenario, sc = scenario(st.id);
  el.hidden = false;
  const free = st.continued || !sc.objectives.length;
  const left = sc.days && !free ? Math.max(0, sc.days - g.day) : 0;
  const prog = free ? [] : allProgress(g);
  el.innerHTML = `
    <div class="goals-head"><span>${sc.icon} ${free ? t('goals.free') : tk(`sc.${sc.id}`)}</span>${left ? `<em class="${left < 90 ? 'bad' : ''}">${t('goals.left', { t: duration(left) })}</em>` : ''}</div>
    ${prog.map((p) => {
      const pct = p.objective.kind === 'noBrokenPromises' ? (p.done ? 100 : 0) : Math.min(100, Math.round((p.value / Math.max(1, p.target)) * 100));
      return `<div class="goal ${p.done ? 'done' : ''}"><span>${p.done ? '✓' : '○'} ${esc(objectiveLabel(p.objective))}</span>
        <div class="bar"><i style="width:${pct}%"></i></div><small>${progressText(g, p)}</small></div>`;
    }).join('')}
    ${st.overdueMonths && !free ? `<p class="warn">⚠ ${t('goals.overdue', { n: st.overdueMonths })}</p>` : ''}
    ${st.lowRepMonths && !free ? `<p class="warn">⚠ ${t('goals.lowRep', { n: st.lowRepMonths })}</p>` : ''}`;
}

// ------------------------------------------------------------------ end screen

export interface EndActions { keepPlaying(): void; mainMenu(): void }

export function renderEnd(el: HTMLElement, g: Game, mapName: string, a: EndActions) {
  const st = g.scenario;
  const s = computeScore(g);
  const key = st.outcome === 'lost' ? `end.lost.${st.reason}` : st.outcome === 'won' ? 'end.won' : 'end.retired';
  const best = highScores().filter((h) => h.scenario === st.id).slice(0, 5);
  el.hidden = false;
  el.innerHTML = `
    <div class="modal end ${st.outcome}">
      <div class="end-icon">${st.outcome === 'won' ? '🏆' : st.outcome === 'lost' ? '📉' : '🏁'}</div>
      <h1>${tk(key)}</h1>
      <p class="lead">${tk(`${key}.text`)}</p>
      <div class="score-big"><span>${t('end.score')}</span><strong>${s.total.toLocaleString()}</strong><em>${t('end.rank')}: ${tk(`rank.${s.rank}`)}</em></div>
      <table class="score-lines">
        ${s.lines.map((l) => `<tr><td>${tk(`score.${l.key}`)}</td><td class="muted">${l.detail ?? ''}</td><td class="${l.points < 0 ? 'neg' : 'pos'}">${l.points > 0 ? '+' : ''}${l.points.toLocaleString()}</td></tr>`).join('')}
      </table>
      <p class="muted">${esc(tk(`sc.${st.id}`))} · ${esc(mapName)} · ${tk(`diff.${g.difficulty.id}`)} · ${formatDate(g.date())}</p>
      ${best.length ? `<h3>${t('menu.best')}</h3><ol class="best">${best.map((h) => `<li><b>${h.score.toLocaleString()}</b> ${tk(`rank.${h.rank}`)} · ${esc(h.map)} · ${tk(`diff.${h.difficulty}`)}</li>`).join('')}</ol>` : ''}
      <div class="row center">
        <button id="end-keep">${t('end.keepPlaying')}</button>
        <button id="end-menu" class="primary">${t('menu.mainMenu')}</button>
      </div>
    </div>`;
  el.querySelector<HTMLElement>('#end-keep')!.onclick = a.keepPlaying;
  el.querySelector<HTMLElement>('#end-menu')!.onclick = a.mainMenu;
}

// ------------------------------------------------------------------ welcome screen

export interface WelcomeActions {
  start(scenario: ScenarioId, mapKey: string): void;
  continueGame(): void;
  close(): void;
}

let chosen: ScenarioId = 'tutorial';

export function renderWelcome(el: HTMLElement, maps: MapEntry[], mapKey: string, auto: SlotMeta | null, canClose: boolean, a: WelcomeActions) {
  const best = highScores().slice(0, 5);
  el.hidden = false;
  el.innerHTML = `
    <div class="modal welcome">
      <div class="welcome-head">
        <div><h1>🏙 ${t('menu.title')}</h1><p class="lead">${t('menu.tagline')}</p></div>
        <div class="welcome-opts">
          <select id="w-lang" aria-label="${t('top.language')}">${LANGS.map((l) => `<option value="${l.code}" ${l.code === getLang() ? 'selected' : ''}>${l.label}</option>`).join('')}</select>
          ${canClose ? `<button id="w-close" class="icon" aria-label="${t('panel.close')}">✕</button>` : ''}
        </div>
      </div>
      ${auto ? `<button id="w-continue" class="continue"><b>▶ ${t('menu.continue')}</b><small>${esc(t('menu.continueInfo', { map: auto.mapName, date: formatDate(new Date(Date.UTC(START_YEAR, 0, 1 + auto.day))) }))}</small></button>` : ''}
      <h3>${t('menu.choose')}</h3>
      <div class="scenarios">
        ${SCENARIOS.map((sc) => `<button class="sc-card ${chosen === sc.id ? 'active' : ''}" data-sc="${sc.id}">
          <span class="sc-icon">${sc.icon}</span>
          <b>${tk(`sc.${sc.id}`)}</b>
          <small>${tk(`sc.${sc.id}.desc`)}</small>
          <span class="chips"><span class="chip">${tk(`diff.${sc.difficulty}`)}</span><span class="chip">${sc.days ? t('menu.days', { years: Math.round(sc.days / 365) }) : t('menu.noLimit')}</span></span>
          ${sc.objectives.length ? `<ul>${sc.objectives.map((o) => `<li>${esc(objectiveLabel(o))}</li>`).join('')}</ul>` : ''}
        </button>`).join('')}
      </div>
      <div class="welcome-foot">
        <label>${t('menu.map')} <select id="w-map">${maps.map((m) => `<option value="${esc(m.key)}" ${m.key === mapKey ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}</select></label>
        <button id="w-start" class="primary">${t('menu.start')} →</button>
      </div>
      <h3>${t('menu.best')}</h3>
      ${best.length ? `<ol class="best">${best.map((h) => `<li><b>${h.score.toLocaleString()}</b> ${tk(`rank.${h.rank}`)} · ${esc(tk(`sc.${h.scenario}`))} · ${esc(h.map)}</li>`).join('')}</ol>` : `<p class="muted">${t('menu.noScores')}</p>`}
    </div>`;
  const q = <T extends HTMLElement>(s: string) => el.querySelector<T>(s);
  el.querySelectorAll<HTMLElement>('[data-sc]').forEach((b) => (b.onclick = () => {
    chosen = b.dataset.sc as ScenarioId;
    el.querySelectorAll('.sc-card').forEach((c) => c.classList.toggle('active', (c as HTMLElement).dataset.sc === chosen));
  }));
  q('#w-start')!.onclick = () => a.start(chosen, q<HTMLSelectElement>('#w-map')!.value);
  q('#w-continue')?.addEventListener('click', a.continueGame);
  q('#w-close')?.addEventListener('click', a.close);
  q<HTMLSelectElement>('#w-lang')!.onchange = (e) => setLang((e.target as HTMLSelectElement).value as never);
}
