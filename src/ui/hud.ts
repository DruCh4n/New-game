import { LANGS, getLang, setLang, t, tk } from '../i18n';
import type { StringKey } from '../i18n/strings';
import type { MapData } from '../shared/mapTypes';
import type { MapEntry } from '../map/mapStore';
import type { OverlayManager } from '../render/OverlayManager';
import { LAND_COLORS, STATUS_COLORS, VALUE_RAMP, type Lens } from '../render/PlotLayer';
import type { World } from '../game/World';
import type { Owner, Plot, PlotStatus } from '../game/types';
import { hashString } from '../util/random';
import { band, esc, formatDate, initials, money, ownerName, plotHeading, plotTitle, roadLabel } from './format';
import type { Game, Speed, Toast } from '../game/Game';
import { canVisit, type Session } from '../game/negotiation';
import { renderNegotiation, type NegotiationActions } from './negotiationPanel';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

export type PanelMode = 'info' | 'overlay' | 'talk';

export interface HudCallbacks {
  selectMap(key: string): void;
  openMapFile(file: File): void;
  resetView(): void;
  setLens(lens: Lens): void;
  /** Select a plot by id and move the camera to it. */
  focusPlot(id: string): void;
  clearSelection(): void;
  visit(plotId: string): void;
  setSpeed(s: Speed): void;
  negotiation: NegotiationActions;
}

const DEV_KEY = 'kotabaru.dev';

/** DOM-based HUD: top bar, side panel, status bar, legend, tooltip and bottom toolbar. */
export class Hud {
  panel: PanelMode = 'info';
  lens: Lens = 'normal';
  devMode = (() => { try { return localStorage.getItem(DEV_KEY) === '1'; } catch { return false; } })();
  private maps: MapEntry[] = [];
  private currentKey = '';
  private map: MapData | null = null;
  private world: World | null = null;
  private game: Game | null = null;
  private session: Session | null = null;
  private selected: Plot | null = null;
  private tooltipPlot: Plot | null = null;

  constructor(private cb: HudCallbacks, private overlay: OverlayManager) {
    overlay.onChange = () => this.renderAll();
  }

  setMaps(maps: MapEntry[], currentKey: string) {
    this.maps = maps;
    this.currentKey = currentKey;
    this.renderTopBar();
  }

  setMap(map: MapData, key: string, game: Game) {
    this.map = map;
    this.world = game.world;
    this.game = game;
    this.session = null;
    this.panel = 'info';
    this.currentKey = key;
    this.selected = null;
    this.renderAll();
  }

  select(plot: Plot | null) {
    this.selected = plot;
    if (plot || this.panel === 'talk') this.panel = 'info';
    this.session = null;
    this.renderSidePanel();
    this.renderToolbar();
  }

  /** Switch the side panel to a conversation. */
  showSession(s: Session | null) {
    this.session = s;
    this.panel = s ? 'talk' : 'info';
    this.renderSidePanel();
    this.renderToolbar();
  }

  /** Re-render whatever the side panel currently shows (after game changes). */
  refreshPanel() {
    this.renderSidePanel();
  }

  updateStats() {
    const el = document.getElementById('stats');
    const g = this.game;
    if (!el || !g) return;
    const rep = Math.round(g.reputation);
    const repClass = rep < 30 ? 'bad' : rep > 70 ? 'good' : '';
    el.innerHTML = `
      <div class="stat"><small>${t('top.money')}</small><span>${money(g.world, g.money)}</span></div>
      <div class="stat"><small>${t('top.reputation')}</small><span class="rep ${repClass}"><i style="width:${rep}%"></i><b>${rep}</b></span></div>
      <div class="stat"><small>${t('top.date')}</small><span>${formatDate(g.date())}</span></div>
      <div class="speed" role="group">
        ${([0, 1, 2, 4] as Speed[]).map((n) => `<button data-speed="${n}" class="${g.speed === n ? 'active' : ''}" title="${n === 0 ? t('speed.pause') : t('speed.x', { n })}" aria-label="${n === 0 ? t('speed.pause') : t('speed.x', { n })}">${n === 0 ? '❚❚' : '▶'.repeat(n === 4 ? 3 : n)}</button>`).join('')}
      </div>`;
    el.querySelectorAll<HTMLElement>('[data-speed]').forEach((b) => (b.onclick = () => this.cb.setSpeed(parseInt(b.dataset.speed!, 10) as Speed)));
  }

  showToast(toast: Toast) {
    const w = this.world;
    const params: Record<string, string | number> = { ...toast.params };
    if (w && typeof params.ownerId === 'string') params.owner = ownerName(w.owner(params.ownerId)!);
    if (w && typeof params.price === 'number') params.price = money(w, params.price);
    const el = document.createElement('div');
    el.className = `toast ${toast.kind}`;
    el.textContent = tk(toast.key, params);
    $('#toasts').appendChild(el);
    setTimeout(() => el.classList.add('out'), 4200);
    setTimeout(() => el.remove(), 4800);
  }

  renderAll() {
    document.title = t('app.title');
    this.renderTopBar();
    this.renderSidePanel();
    this.renderToolbar();
    this.renderLegend();
    $('#attribution').textContent = this.map?.attribution ?? '';
    $('#canvas-host').classList.toggle('adjusting', this.overlay.active());
  }

  showLoading(text: string | null, isError = false) {
    const el = $('#loading');
    el.hidden = text === null;
    el.textContent = text ?? '';
    el.classList.toggle('error', isError);
    el.onclick = isError ? () => this.showLoading(null) : null;
  }

  updateStatus(cursor: { x: number; y: number; lat: number; lon: number } | null, zoom: number, fps: number) {
    const scale = scaleBar(zoom);
    $('#statusbar').innerHTML = `
      <div class="scalebar"><span>${scale.label}</span><div class="bar" style="width:${scale.px}px"></div></div>
      <span>${t('status.cursor')}: <b>${cursor ? `${cursor.lat.toFixed(5)}, ${cursor.lon.toFixed(5)}` : '—'}</b></span>
      <span>${t('status.zoom')}: <b>${zoom.toFixed(2)} px/m</b></span>
      <span>${t('status.fps')}: <b>${Math.round(fps)}</b></span>`;
  }

  /** Small label that follows the cursor over a plot. */
  showTooltip(plot: Plot | null, sx: number, sy: number) {
    const el = $('#tooltip');
    if (!plot || !this.world || this.overlay.active()) { el.hidden = true; this.tooltipPlot = null; return; }
    if (plot !== this.tooltipPlot) {
      this.tooltipPlot = plot;
      const o = this.world.ownerOf(plot);
      el.innerHTML = `<b>${esc(ownerName(o))}</b><span>${esc(plotTitle(plot))} · ${money(this.world, plot.value)}</span>`;
    }
    el.hidden = false;
    const host = $('#stage').getBoundingClientRect();
    const w = el.offsetWidth;
    el.style.left = `${Math.min(sx + 14, host.width - w - 8)}px`;
    el.style.top = `${sy + 18}px`;
  }

  // ---------------------------------------------------------------- top bar
  private renderTopBar() {
    const el = $('#topbar');
    const options = this.maps
      .map((m) => `<option value="${esc(m.key)}" ${m.key === this.currentKey ? 'selected' : ''}>${esc(m.key)}</option>`)
      .join('');
    const fileOpt = this.currentKey.startsWith('file:') ? `<option selected>${esc(this.currentKey.slice(5))}</option>` : '';
    el.innerHTML = `
      <span class="brand">Kota Baru</span>
      <label>${t('top.map')} <select id="map-select">${fileOpt}${options}</select></label>
      <button id="open-file">${t('top.openFile')}</button>
      <input id="file-input" type="file" accept=".json,application/json" hidden />
      <span class="spacer"></span>
      <div id="stats"></div>
      <span class="spacer"></span>
      <label>${t('top.language')}
        <select id="lang-select">${LANGS.map((l) => `<option value="${l.code}" ${l.code === getLang() ? 'selected' : ''}>${l.label}</option>`).join('')}</select>
      </label>`;
    $<HTMLSelectElement>('#map-select').onchange = (e) => this.cb.selectMap((e.target as HTMLSelectElement).value);
    const input = $<HTMLInputElement>('#file-input');
    $('#open-file').onclick = () => input.click();
    input.onchange = () => {
      if (input.files?.[0]) this.cb.openMapFile(input.files[0]);
      input.value = '';
    };
    $<HTMLSelectElement>('#lang-select').onchange = (e) => setLang((e.target as HTMLSelectElement).value as never);
    this.updateStats();
  }

  // ---------------------------------------------------------------- side panel
  private renderSidePanel() {
    const el = $('#sidepanel');
    el.classList.toggle('plot', this.panel === 'info' && !!this.selected);
    el.classList.toggle('talk', this.panel === 'talk');
    if (this.panel === 'overlay') return this.renderOverlayPanel(el);
    if (this.panel === 'talk' && this.session && this.game) return renderNegotiation(el, this.game, this.session, this.cb.negotiation);
    if (this.selected && this.world) return this.renderPlotPanel(el, this.selected, this.world);
    const m = this.map;
    if (!m) { el.innerHTML = ''; return; }
    const w = m.bounds.maxX - m.bounds.minX, h = m.bounds.maxY - m.bounds.minY;
    const world = this.world;
    const stateArea = world ? world.plots.filter((p) => p.ownerId === 'o_state').reduce((a, p) => a + p.area, 0) : 0;
    el.innerHTML = `
      <h2>${esc(m.name)}</h2>
      <p class="hint">${t('info.clickHint')}</p>
      <dl>
        <dt>${t('info.source')}</dt><dd>${m.source === 'osm' ? t('info.osm') : t('info.synthetic')}</dd>
        <dt>${t('info.country')}</dt><dd>${esc(m.country ?? '—')}</dd>
        <dt>${t('info.size')}</dt><dd>${Math.round(w)} × ${Math.round(h)} m (${((w * h) / 1e6).toFixed(2)} km²)</dd>
        <dt>${t('info.buildings')}</dt><dd>${m.buildings.length.toLocaleString()}</dd>
        <dt>${t('info.roads')}</dt><dd>${m.roads.length.toLocaleString()}</dd>
        ${world ? `
        <dt>${t('info.plots')}</dt><dd>${world.plots.length.toLocaleString()}</dd>
        <dt>${t('info.owners')}</dt><dd>${world.owners.length.toLocaleString()}</dd>
        <dt>${t('info.stateLand')}</dt><dd>${(stateArea / 10000).toFixed(1)} ha</dd>
        <dt>${t('info.owned')}</dt><dd>${world.plots.filter((p) => world.statusOf(p.id) === 'sold').length}</dd>` : ''}
      </dl>
      <label class="check dev"><input id="dev-toggle" type="checkbox" ${this.devMode ? 'checked' : ''}/> ${t('dev.toggle')}</label>
      <p class="hint">${t('help.controls')}</p>`;
    $<HTMLInputElement>('#dev-toggle').onchange = (e) => {
      this.devMode = (e.target as HTMLInputElement).checked;
      try { localStorage.setItem(DEV_KEY, this.devMode ? '1' : '0'); } catch { /* ignore */ }
    };
  }

  private renderPlotPanel(el: HTMLElement, p: Plot, w: World) {
    const o = w.ownerOf(p);
    const status = w.statusOf(p.id);
    const isPerson = o.kind === 'person';
    const name = ownerName(o);
    const avatarHue = hashString(o.id) % 360;
    const otherPlots = o.plotIds.length - 1;

    const roadRow = p.road
      ? t('panel.roadDist', { name: esc(roadLabel(p.road)), dist: p.road.distance.toFixed(0) })
      : p.access
        ? p.access.name ? t('panel.footpathOnly', { name: esc(p.access.name) }) : t('panel.footpathOnlyUnnamed', { dist: p.access.distance.toFixed(0) })
        : t('panel.noRoad');

    const subtitle = isPerson
      ? [o.age ? t('panel.age', { age: o.age }) : '', o.occupation ? tk(`occ.${o.occupation}`) : '', o.familySize ? t('panel.family', { n: o.familySize }) : '']
        .filter(Boolean).join(' · ')
      : tk(`kind.${o.kind}`);

    const bar = (label: string, v: number, text: string) => `
      <div class="trait"><span>${label}</span><div class="meter"><i style="width:${v}%"></i></div><em>${text}${this.devMode ? ` (${v})` : ''}</em></div>`;

    const neighbors = this.neighborList(p, o, w);
    el.innerHTML = `
      <div class="panel-head">
        ${p.name ? `<span class="chip">${esc(tk(`cat.${p.category}`))}</span>` : ''}
        <span class="pill" style="--c:${hex(STATUS_COLORS[status])}">${t(`status.${status}` as StringKey)}</span>
        <button id="panel-close" class="icon" title="${t('panel.close')}" aria-label="${t('panel.close')}">✕</button>
      </div>
      <h2>${esc(plotHeading(p))}</h2>

      <h3>${this.game?.ownsPlot(p.id) && o.kind !== 'state' ? t('panel.formerOwner') : t('panel.owner')}</h3>
      <div class="owner">
        <div class="avatar" style="--h:${avatarHue}">${esc(initials(o.name || name))}</div>
        <div><b>${esc(name)}</b><small>${esc(subtitle)}</small></div>
      </div>
      ${isPerson ? `
        <p class="muted">${t(o.yearsLived > 0 && o.occupation !== 'landlord' ? 'panel.lived' : 'panel.since', { n: o.yearsLived })}</p>
        ${bar(t('panel.attachment'), o.attachment, band('attach', o.attachment))}
        ${bar(t('panel.greed'), o.greed, band('greed', o.greed))}
        <div class="trait"><span>${t('panel.finances')}</span><span class="fin fin-${o.finances}">${t(`fin.${o.finances}` as StringKey)}</span></div>` : ''}
      ${o.kind === 'state' ? `<p class="muted">${t('panel.statePlot')}</p>` : ''}
      ${o.kind === 'institution' && o.holdout ? `<p class="muted">${t('panel.notForSale')}</p>` : ''}
      ${o.stories.length && o.kind !== 'state' ? `<ul class="stories">${o.stories.map((s) => `<li>${esc(tk(`story.${s.key}`, s.params))}</li>`).join('')}</ul>` : ''}
      ${otherPlots > 0 && o.kind !== 'state' ? `<p class="muted owns">${t('panel.ownsMore', { n: otherPlots })}</p>` : ''}

      <h3>${t('panel.property')}</h3>
      <div class="value">
        <strong>${money(w, p.value)}</strong>
        <small>${p.buildingValue ? t('panel.valueSplit', { land: money(w, p.landValue), building: money(w, p.buildingValue) }) : t('panel.perM2', { price: money(w, p.landValue / p.area) })}</small>
      </div>
      <dl>
        <dt>${t('panel.plotArea')}</dt><dd>${p.area.toLocaleString()} m²</dd>
        <dt>${t('panel.building')}</dt><dd>${p.kind === 'building' ? t('panel.buildingValue', { area: p.footprintArea, floors: p.floors }) : t('panel.noBuilding')}</dd>
        <dt>${t('panel.road')}</dt><dd>${roadRow}</dd>
        ${p.mainRoad ? `<dt>${t('panel.mainRoad')}</dt><dd>✓</dd>` : ''}
      </dl>

      ${o.kind !== 'state' ? `<h3>${t('panel.neighbors')}</h3>${neighbors}` : ''}

      ${this.devMode ? `
        <h3>${t('panel.dev')}</h3>
        <dl class="dev">
          <dt>${t('panel.minPrice')}</dt><dd>${o.holdout ? '∞' : money(w, p.value * o.minFactor)} (×${o.minFactor})</dd>
          <dt>${t('panel.holdout')}</dt><dd>${o.holdout ? t('panel.yes') : t('panel.no')}</dd>
          <dt>${t('panel.mood')}</dt><dd>${o.mood}</dd>
          <dt>id</dt><dd>${esc(p.id)} / ${esc(o.id)}</dd>
        </dl>` : ''}

      ${this.visitSection(p, o)}`;

    $('#panel-close').onclick = () => this.cb.clearSelection();
    document.getElementById('panel-visit')?.addEventListener('click', () => this.cb.visit(p.id));
    el.querySelectorAll<HTMLElement>('[data-plot]').forEach((b) => (b.onclick = () => this.cb.focusPlot(b.dataset.plot!)));
  }

  /** Negotiation summary + visit button (or ownership info). */
  private visitSection(p: Plot, o: Owner): string {
    const g = this.game;
    if (!g) return '';
    const w = g.world;
    if (g.ownsPlot(p.id)) {
      const promised = g.obligations.filter((ob) => ob.ownerId === o.id).map((ob) => tk(`opt.${ob.kind}`));
      return `<div class="owned">✓ ${t('panel.youOwn')}${promised.length ? `<small>${t('panel.promised', { list: promised.join(', ') })}</small>` : ''}</div>`;
    }
    const rec = g.records.get(o.id);
    const summary = rec && rec.visits ? `
      <dl class="neg-summary">
        <dt>${t('panel.negSummary', { n: rec.visits })}</dt><dd></dd>
        ${rec.lastOffer ? `<dt>${t('panel.lastOffer')}</dt><dd>${money(w, rec.lastOffer)}</dd>` : ''}
        ${rec.lastAsk ? `<dt>${t('panel.lastAsk')}</dt><dd>${money(w, rec.lastAsk)}</dd>` : ''}
      </dl>` : '';
    const check = canVisit(g, p);
    const label = o.kind === 'state' ? t('panel.applyState') : t('panel.visit');
    return `${summary}
      <button id="panel-visit" class="primary wide" ${check.block ? 'disabled' : ''}>${label}</button>
      ${check.block === 'cooldown' || check.block === 'angry' ? `<p class="hint center">${t('panel.visitBlocked', { days: check.days ?? 1 })}</p>` : ''}`;
  }

  /** Distinct neighbouring owners with their relationship to this owner. */
  private neighborList(p: Plot, o: Owner, w: World): string {
    const seen = new Set<string>([o.id]);
    const rows: string[] = [];
    let extra = 0;
    for (const nid of p.neighbors) {
      const np = w.plot(nid)!;
      const no = w.ownerOf(np);
      if (seen.has(no.id) || no.kind === 'state') continue;
      seen.add(no.id);
      if (rows.length >= 8) { extra++; continue; }
      const rel = o.relations.find((r) => r.ownerId === no.id);
      const kind = rel?.kind ?? 'neutral';
      const st = w.statusOf(np.id);
      rows.push(`<li><button class="link" data-plot="${esc(np.id)}">
        <span class="dot" style="--c:${hex(STATUS_COLORS[st])}"></span>${esc(ownerName(no))}</button>
        <span class="rel rel-${kind}">${tk(`rel.${kind}`)}${this.devMode && rel ? ` ${rel.value}` : ''}</span></li>`);
    }
    if (!rows.length) return `<p class="muted">${t('panel.noNeighbors')}</p>`;
    return `<ul class="neighbors">${rows.join('')}</ul>${extra ? `<p class="muted">${t('panel.moreNeighbors', { n: extra })}</p>` : ''}`;
  }

  private renderOverlayPanel(el: HTMLElement) {
    const o = this.overlay;
    el.innerHTML = `
      <h2>${t('overlay.title')}</h2>
      <p class="hint">${t('overlay.hint')}</p>
      <div class="row">
        <button id="ov-load">${t('overlay.load')}</button>
        <input id="ov-file" type="file" accept="image/*" hidden />
        ${o.loaded ? `<button id="ov-fit">${t('overlay.fit')}</button><button id="ov-remove">${t('overlay.remove')}</button>` : ''}
      </div>
      ${o.loaded ? `
        <div class="row"><span>${t('overlay.opacity')}</span><input id="ov-opacity" type="range" min="0" max="1" step="0.05" value="${o.opacity}" /></div>
        <label class="check"><input id="ov-adjust" type="checkbox" ${o.adjusting ? 'checked' : ''}/> ${t('overlay.adjust')}</label>
        <label class="check"><input id="ov-below" type="checkbox" ${o.below ? 'checked' : ''}/> ${t('overlay.below')}</label>
      ` : `<p class="hint">${t('overlay.none')}</p>`}`;
    const file = $<HTMLInputElement>('#ov-file');
    $('#ov-load').onclick = () => file.click();
    file.onchange = () => { if (file.files?.[0]) void o.loadFile(file.files[0]); };
    if (!o.loaded) return;
    $('#ov-fit').onclick = () => o.fitToMap();
    $('#ov-remove').onclick = () => void o.remove();
    $<HTMLInputElement>('#ov-opacity').oninput = (e) => o.setOpacity(parseFloat((e.target as HTMLInputElement).value));
    $<HTMLInputElement>('#ov-adjust').onchange = (e) => { o.adjusting = (e.target as HTMLInputElement).checked; this.renderAll(); };
    $<HTMLInputElement>('#ov-below').onchange = (e) => o.setBelow((e.target as HTMLInputElement).checked);
  }

  // ---------------------------------------------------------------- legend
  renderLegend() {
    const el = $('#legend');
    if (this.lens === 'normal') { el.hidden = true; return; }
    el.hidden = false;
    if (this.lens === 'value') {
      el.innerHTML = `<b>${t('legend.value')}</b>
        <div class="ramp" style="background:linear-gradient(90deg,${VALUE_RAMP.map(hex).join(',')})"></div>
        <div class="ramp-labels"><span>${t('legend.low')}</span><span>${t('legend.high')}</span></div>`;
      return;
    }
    const statuses: PlotStatus[] = ['not_approached', 'negotiating', 'sold', 'refused'];
    el.innerHTML = `<b>${t('legend.plots')}</b>
      ${statuses.map((s) => `<div class="key"><span class="sw" style="--c:${hex(STATUS_COLORS[s])}"></span>${t(`status.${s}` as StringKey)}</div>`).join('')}
      ${(['state_land', 'park', 'field', 'cemetery'] as const).map((c) => `<div class="key"><span class="sw fill" style="--c:${hex(LAND_COLORS[c])}"></span>${tk(`cat.${c}`)}</div>`).join('')}`;
  }

  // ---------------------------------------------------------------- toolbar
  private renderToolbar() {
    const el = $('#toolbar');
    const future: [string, StringKey][] = [['⛏', 'tool.demolish'], ['🛣', 'tool.road'], ['🏗', 'tool.build']];
    const lenses: [Lens, StringKey, string][] = [['normal', 'lens.normal', '1'], ['plots', 'lens.plots', '2'], ['value', 'lens.value', '3']];
    el.innerHTML = `
      <button id="tb-select" class="${this.panel !== 'overlay' ? 'active' : ''}">🖱 ${t('tool.select')}</button>
      ${future.map(([icon, k]) => `<button disabled title="${t('tool.comingSoon')}">${icon} ${t(k)}</button>`).join('')}
      <span class="sep"></span>
      <span class="group-label">${t('tool.lens')}</span>
      <div class="segmented">${lenses.map(([l, k, key]) => `<button data-lens="${l}" class="${this.lens === l ? 'active' : ''}" title="${key}">${t(k)}</button>`).join('')}</div>
      <span class="sep"></span>
      <button id="tb-overlay" class="${this.panel === 'overlay' ? 'active' : ''}">🛰 ${t('tool.overlay')}</button>
      <button id="tb-reset">⌂ ${t('tool.resetView')}</button>`;
    $('#tb-select').onclick = () => { if (this.panel === 'overlay') this.panel = this.session ? 'talk' : 'info'; this.overlay.adjusting = false; this.renderAll(); };
    $('#tb-overlay').onclick = () => { this.panel = 'overlay'; this.renderAll(); };
    $('#tb-reset').onclick = () => this.cb.resetView();
    el.querySelectorAll<HTMLElement>('[data-lens]').forEach((b) => (b.onclick = () => this.cb.setLens(b.dataset.lens as Lens)));
  }

  setLens(l: Lens) {
    this.lens = l;
    this.renderToolbar();
    this.renderLegend();
  }
}

/** Picks a round distance that is ~80–200 px long at the current zoom. */
function scaleBar(zoom: number): { px: number; label: string } {
  const target = 120 / zoom;
  const pow = 10 ** Math.floor(Math.log10(target));
  const nice = [1, 2, 5, 10].map((n) => n * pow).find((n) => n >= target * 0.7) ?? pow * 10;
  return { px: Math.round(nice * zoom), label: nice >= 1000 ? `${nice / 1000} km` : `${nice} m` };
}
