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
import { currentEmotion, renderNegotiation, type NegotiationActions } from './negotiationPanel';
import { renderChats, renderMeeting, renderMulti, type ChatActions, type MeetingActions } from './chatPanel';
import { portrait } from './portrait';
import { unreadRooms } from '../game/messages';
import { BUILDING_TYPES, ROAD_TYPES, buildingType, type BuildingTypeId, type RoadTypeId } from '../game/catalog';
import type { NewBuilding } from '../game/Development';
import { demand, monthlyIncome, unitPrice } from '../game/Economy';
import { renderFinance } from './financePanel';
import { renderGameMenu, type GameMenuActions } from './gamePanel';
import { sound } from '../audio/Sound';
import { renderImport, type ImportActions } from './importPanel';
import type { Life } from '../render/Life';
import { DISTRICT_MIN_AREA, districtStats, largestOwnedArea, type Zone } from '../game/District';

export type Tool = 'select' | 'demolish' | 'road' | 'build' | 'zone';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

export type PanelMode = 'info' | 'overlay' | 'talk' | 'finance' | 'game' | 'import' | 'chats' | 'room' | 'meeting' | 'multi';

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
  setTool(t: Tool): void;
  setBuildType(b: BuildingTypeId): void;
  setRoadType(r: RoadTypeId): void;
  demolishPlot(plotId: string): void;
  removeNewBuilding(id: string): void;
  addMoney(): void;
  gameMenu: GameMenuActions;
  setZone(z: Zone, brush: number): void;
  importer: ImportActions;
  negotiation: NegotiationActions;
  chats: ChatActions;
  meeting: MeetingActions;
  multi: { meet(): void; clear(): void; focus(id: string): void; remove(id: string): void; addNeighbors(id: string): void };
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
  tool: Tool = 'select';
  buildType: BuildingTypeId = 'house';
  roadType: RoadTypeId = 'street';
  private selectedNew: NewBuilding | null = null;
  life: Life | null = null;
  zone: Zone = 1;
  brush = 8;
  private selected: Plot | null = null;
  /** Owner whose chat room is open (panel 'room' or 'talk'). */
  roomOwner: string | null = null;
  /** Meeting room open in panel 'meeting'. */
  roomMeeting: string | null = null;
  /** Plots picked with shift+click. */
  multi: string[] = [];
  /** The map info card was closed by the player. */
  infoHidden = false;
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
    this.multi = [];
    this.roomOwner = this.roomMeeting = null;
    this.currentKey = key;
    this.selected = null;
    this.renderAll();
  }

  select(plot: Plot | null) {
    this.selected = plot;
    this.selectedNew = null;
    if (plot || this.panel === 'talk') this.panel = 'info';
    this.session = null;
    this.renderSidePanel();
    this.renderToolbar();
  }

  selectNewBuilding(b: NewBuilding | null) {
    this.selected = null;
    this.selectedNew = b;
    this.session = null;
    this.panel = 'info';
    this.renderSidePanel();
  }

  setTool(tool: Tool) {
    this.tool = tool;
    this.renderToolbar();
    this.renderPalette();
  }

  /** Free-form tooltip (used by the building tools). */
  showText(html: string | null, sx: number, sy: number) {
    const el = $('#tooltip');
    this.tooltipPlot = null;
    if (!html) { el.hidden = true; return; }
    el.innerHTML = html;
    el.hidden = false;
    const host = $('#stage').getBoundingClientRect();
    el.style.left = `${Math.min(sx + 14, host.width - el.offsetWidth - 8)}px`;
    el.style.top = `${sy + 18}px`;
  }

  renderPalette() {
    const el = $('#palette');
    const g = this.game;
    const hint = `<div class="toolhint">${tk(`tool.hint.${this.tool}`)}</div>`;
    if (g && this.tool === 'zone') {
      el.hidden = false;
      if (!g.districtUnlocked) {
        const area = largestOwnedArea(g);
        const pct = Math.min(100, Math.round((area / DISTRICT_MIN_AREA) * 100));
        el.innerHTML = `<div class="district locked"><b>🔒 ${t('dist.locked', { need: (DISTRICT_MIN_AREA / 10000).toFixed(0) })}</b>
          <div class="progress"><i style="width:${pct}%"></i></div>
          <small>${t('dist.progress', { have: area.toLocaleString(), need: DISTRICT_MIN_AREA.toLocaleString() })}</small></div>`;
        return;
      }
      const st = districtStats(g);
      const zones: [Zone, string, string][] = [[1, '🏘', 'dist.res'], [2, '🏬', 'dist.com'], [3, '🌳', 'dist.green'], [0, '⌫', 'dist.erase']];
      const share = (z: number) => (st.zoned ? Math.round((st.area[z] / st.zoned) * 100) : 0);
      el.innerHTML = `<div class="cards">
          ${zones.map(([z, icon, k]) => `<button class="card zone-${z} ${this.zone === z ? 'active' : ''}" data-zone="${z}"><span class="icon">${icon}</span><b>${tk(k)}</b>
            ${z ? `<small>${(st.area[z] / 10000).toFixed(2)} ha · ${share(z)}%</small>` : '<small>&nbsp;</small>'}</button>`).join('')}
          <div class="district-stats">
            <b>${t('dist.balance')}: ${Math.round(st.balance * 100)}%</b>
            <div class="progress"><i style="width:${Math.round(st.balance * 100)}%"></i></div>
            <small>${t('dist.target')}</small>
            <div class="row">${[5, 8, 14].map((b) => `<button data-brush="${b}" class="${this.brush === b ? 'active' : ''}">${t('dist.brush', { m: b * 2 })}</button>`).join('')}</div>
          </div>
        </div>
        <div class="toolhint">${t('tool.hint.zone')}</div>`;
      el.querySelectorAll<HTMLElement>('[data-zone]').forEach((b) => (b.onclick = () => { this.zone = parseInt(b.dataset.zone!, 10) as Zone; this.cb.setZone(this.zone, this.brush); this.renderPalette(); }));
      el.querySelectorAll<HTMLElement>('[data-brush]').forEach((b) => (b.onclick = () => { this.brush = parseInt(b.dataset.brush!, 10); this.cb.setZone(this.zone, this.brush); this.renderPalette(); }));
      return;
    }
    if (!g || this.tool === 'select' || this.tool === 'demolish') {
      el.innerHTML = this.tool === 'select' ? '' : hint;
      el.hidden = this.tool === 'select';
      return;
    }
    el.hidden = false;
    if (this.tool === 'build') {
      el.innerHTML = `<div class="cards">${BUILDING_TYPES.map((b) => {
        const { cost, days } = g.dev.buildingCost(b.id);
        return `<button class="card ${this.buildType === b.id ? 'active' : ''}" data-bt="${b.id}">
          <span class="icon">${b.icon}</span><b>${tk(`bt.${b.id}`)}</b>
          <small>${t('bt.size', { w: b.width, d: b.depth, floors: b.floors })}</small>
          <small class="${cost > g.money ? 'bad' : ''}">${t('tool.cost', { cost: money(g.world, cost), days })}</small></button>`;
      }).join('')}</div>${hint}`;
      el.querySelectorAll<HTMLElement>('[data-bt]').forEach((b) => (b.onclick = () => this.cb.setBuildType(b.dataset.bt as BuildingTypeId)));
    } else {
      el.innerHTML = `<div class="cards">${ROAD_TYPES.map((r) => `<button class="card ${this.roadType === r.id ? 'active' : ''}" data-rt="${r.id}">
          <b>${tk(`rt.${r.id}`)}</b><small>${t('rt.width', { w: r.width })}</small></button>`).join('')}</div>${hint}`;
      el.querySelectorAll<HTMLElement>('[data-rt]').forEach((b) => (b.onclick = () => this.cb.setRoadType(b.dataset.rt as RoadTypeId)));
    }
  }

  /** Switch the side panel to a conversation. */
  showSession(s: Session | null) {
    this.session = s;
    if (s) this.roomOwner = s.ownerId;
    this.panel = s ? 'talk' : 'info';
    this.renderSidePanel();
    this.renderToolbar();
  }

  /** Chat list, one person's room, a meeting, or the multi-selection. */
  openRoom(kind: 'chats' | 'room' | 'meeting' | 'multi', id?: string) {
    if (kind === 'room') this.roomOwner = id ?? this.roomOwner;
    if (kind === 'meeting') this.roomMeeting = id ?? this.roomMeeting;
    this.panel = kind;
    this.renderSidePanel();
    this.renderToolbar();
    this.updateChatBadge();
  }

  updateChatBadge() {
    const b = document.getElementById('chat-btn');
    if (!b || !this.game) return;
    const n = unreadRooms(this.game) + this.game.meetings.filter((m) => m.read < m.log.length).length;
    b.innerHTML = `💬 ${t('chat.title')}${n ? `<i class="badge">${n}</i>` : ''}`;
    b.classList.toggle('active', this.panel === 'chats' || this.panel === 'room' || this.panel === 'meeting');
  }

  openPanel(mode: 'finance' | 'game' | 'info' | 'import') {
    this.panel = mode;
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
      <button id="stat-money" class="stat statbtn" title="${t('top.finance')}"><small>${t('top.money')}</small><span class="${g.money < 0 ? 'neg' : ''}">${money(g.world, g.money)}</span>
        ${g.reports.length ? `<em class="${g.reports[g.reports.length - 1].net >= 0 ? 'pos' : 'neg'}">${g.reports[g.reports.length - 1].net >= 0 ? '▲' : '▼'} ${money(g.world, Math.abs(g.reports[g.reports.length - 1].net))}</em>` : ''}</button>
      <div class="stat"><small>${t('top.reputation')}</small><span class="rep ${repClass}"><i style="width:${rep}%"></i><b>${rep}</b></span></div>
      <div class="stat"><small>${t('top.date')}</small><span>${formatDate(g.date())}</span></div>
      <div class="speed" role="group">
        ${([0, 1, 2, 4, 8] as Speed[]).map((n) => `<button data-speed="${n}" class="${g.speed === n ? 'active' : ''}" title="${n === 0 ? t('speed.pause') : t('speed.x', { n })}" aria-label="${n === 0 ? t('speed.pause') : t('speed.x', { n })}">${n === 0 ? '❚❚' : n === 8 ? '8×' : '▶'.repeat(n === 4 ? 3 : n)}</button>`).join('')}
      </div>`;
    el.querySelectorAll<HTMLElement>('[data-speed]').forEach((b) => (b.onclick = () => this.cb.setSpeed(parseInt(b.dataset.speed!, 10) as Speed)));
    document.getElementById('stat-money')!.onclick = () => this.openPanel(this.panel === 'finance' ? 'info' : 'finance');
    this.updateChatBadge();
  }

  showToast(toast: Toast) {
    const w = this.world;
    const params: Record<string, string | number> = { ...toast.params };
    if (w && typeof params.ownerId === 'string') params.owner = ownerName(w.owner(params.ownerId)!);
    if (w && typeof params.price === 'number') params.price = money(w, params.price);
    if (w && typeof params.cost === 'number') params.cost = money(w, params.cost);
    if (this.game && typeof params.buildingId === 'string') {
      const b = this.game.dev.buildings.find((x) => x.id === params.buildingId);
      params.building = b ? tk(`bt.${b.type}`) : '';
    }
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
      .map((m) => `<option value="${esc(m.key)}" ${m.key === this.currentKey ? 'selected' : ''}>${esc(m.label)}</option>`)
      .join('');
    const fileOpt = this.currentKey.startsWith('file:') ? `<option selected>${esc(this.currentKey.slice(5))}</option>` : '';
    el.innerHTML = `
      <span class="brand">Kota Baru</span>
      <label>${t('top.map')} <select id="map-select">${fileOpt}${options}</select></label>
      <button id="open-import">🌏 ${t('imp.button')}</button>
      <button id="open-file">${t('top.openFile')}</button>
      <input id="file-input" type="file" accept=".json,application/json" hidden />
      <span class="spacer"></span>
      <div id="stats"></div>
      <span class="spacer"></span>
      <button id="chat-btn"></button>
      <button id="mute" class="icon" title="${t('set.sound')}" aria-label="${t('set.sound')}">${sound.muted ? '🔇' : '🔊'}</button>
      <button id="game-menu">☰ ${t('top.game')}</button>
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
    $('#game-menu').onclick = () => this.openPanel(this.panel === 'game' ? 'info' : 'game');
    $('#open-import').onclick = () => this.openPanel(this.panel === 'import' ? 'info' : 'import');
    $('#chat-btn').onclick = () => {
      const inChat = this.panel === 'chats' || this.panel === 'room' || this.panel === 'meeting';
      if (inChat) this.openPanel('info'); else this.openRoom('chats');
    };
    $('#mute').onclick = () => { sound.unlock(); sound.setMuted(!sound.muted); this.renderTopBar(); };
    this.updateStats();
  }

  // ---------------------------------------------------------------- side panel
  private renderSidePanel(): void {
    const el = $('#sidepanel');
    el.classList.toggle('plot', this.panel === 'info' && !!this.selected);
    el.classList.toggle('talk', ['talk', 'room', 'meeting', 'chats'].includes(this.panel));
    el.hidden = false;
    const g0 = this.game;
    if (g0 && g0.meetingSession && !g0.meetingSession.ended && this.panel !== 'meeting' && this.panel !== 'room') {
      this.panel = 'meeting';
      this.roomMeeting = g0.meetingSession.meeting.id;
    }
    if (this.panel === 'chats' && g0) return renderChats(el, g0, this.cb.chats);
    if (this.panel === 'room' && g0 && this.roomOwner) return renderNegotiation(el, g0, this.roomOwner, this.session, this.cb.negotiation);
    if (this.panel === 'meeting' && g0 && this.roomMeeting) {
      const m = g0.meetings.find((x) => x.id === this.roomMeeting);
      if (m) return renderMeeting(el, g0, m, g0.meetingSession, this.cb.meeting);
    }
    if (this.panel === 'multi' && g0 && this.multi.length) return renderMulti(el, g0, this.multi, this.cb.multi);
    if (this.panel === 'overlay') return this.renderOverlayPanel(el);
    if (this.panel === 'import') return renderImport(el, this.cb.importer);
    if (this.panel === 'game') {
      renderGameMenu(el, this.game, this.cb.gameMenu);
      el.insertAdjacentHTML('beforeend', this.settingsHtml());
      this.wireSettings(el);
      return;
    }
    if (this.panel === 'finance' && this.game) {
      renderFinance(el, this.game, () => { this.updateStats(); this.renderSidePanel(); });
      $('#panel-close').onclick = () => this.openPanel('info');
      return;
    }
    if (this.panel === 'talk' && this.session && this.game) return renderNegotiation(el, this.game, this.session.ownerId, this.session, this.cb.negotiation);
    if (this.selected && this.world) return this.renderPlotPanel(el, this.selected, this.world);
    if (this.selectedNew && this.game) return this.renderNewBuildingPanel(el, this.selectedNew, this.game);
    const m = this.map;
    if (!m) { el.innerHTML = ''; return; }
    if (this.infoHidden) { el.hidden = true; el.innerHTML = ''; return; }
    const w = m.bounds.maxX - m.bounds.minX, h = m.bounds.maxY - m.bounds.minY;
    const world = this.world;
    const stateArea = world ? world.plots.filter((p) => p.ownerId === 'o_state').reduce((a, p) => a + p.area, 0) : 0;
    el.innerHTML = `
      <div class="panel-head"><span></span><button id="panel-close" class="icon" title="${t('panel.close')}" aria-label="${t('panel.close')}">✕</button></div>
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
        ${this.game ? `<dt>${t('diff.label')}</dt><dd>${tk(`diff.${this.game.difficulty.id}`)}</dd>` : ''}
        <dt>${t('info.owned')}</dt><dd>${world.plots.filter((p) => world.statusOf(p.id) === 'sold').length}</dd>
        ${this.game ? `<dt>${t('info.ownedArea')}</dt><dd>${this.game.dev.ownedArea().toLocaleString()} m²</dd>` : ''}` : ''}
      </dl>
      ${this.devMode ? `<button id="dev-money" class="wide">${t('dev.addMoney')}</button>` : ''}
      <label class="check dev"><input id="dev-toggle" type="checkbox" ${this.devMode ? 'checked' : ''}/> ${t('dev.toggle')}</label>
      <p class="hint">${t('help.controls')}</p>`;
    $('#panel-close').onclick = () => { this.infoHidden = true; this.renderSidePanel(); this.renderToolbar(); };
    $<HTMLInputElement>('#dev-toggle').onchange = (e) => {
      this.devMode = (e.target as HTMLInputElement).checked;
      try { localStorage.setItem(DEV_KEY, this.devMode ? '1' : '0'); } catch { /* ignore */ }
      this.renderSidePanel();
    };
    document.getElementById('dev-money')?.addEventListener('click', () => this.cb.addMoney());
  }

  private renderNewBuildingPanel(el: HTMLElement, b: NewBuilding, g: Game): void {
    const bt = buildingType(b.type);
    if (!g.dev.buildings.includes(b)) { this.selectedNew = null; return this.renderSidePanel(); }
    const pct = Math.round((1 - b.daysLeft / b.total) * 100);
    el.innerHTML = `
      <div class="panel-head">
        <span class="pill" style="--c:${b.daysLeft ? '#f2c14e' : '#4caf7d'}">${b.daysLeft ? `${pct}%` : t('nb.done')}</span>
        <button id="panel-close" class="icon" aria-label="${t('panel.close')}">✕</button>
      </div>
      <h2>${bt.icon} ${tk(`bt.${b.type}`)}</h2>
      ${b.daysLeft ? `<div class="progress"><i style="width:${pct}%"></i></div>` : ''}
      <dl>
        <dt>${t('nb.status')}</dt><dd>${b.permitDays > 0 ? t('nb.permit', { days: b.permitDays }) : b.daysLeft ? t('nb.building', { pct, days: b.daysLeft }) : t('nb.done')}</dd>
        <dt>${t('panel.building')}</dt><dd>${t('bt.size', { w: bt.width, d: bt.depth, floors: bt.floors })}</dd>
        <dt>${t('nb.floorArea')}</dt><dd>${(bt.width * bt.depth * bt.floors).toLocaleString()} m²</dd>
        <dt>${t('nb.cost')}</dt><dd>${money(g.world, b.cost)}</dd>
      </dl>
      ${this.buildingEconomy(b, g)}
      <button id="nb-remove" class="wide danger">${t('nb.remove')}</button>`;
    $('#panel-close').onclick = () => this.cb.clearSelection();
    $('#nb-remove').onclick = () => this.cb.removeNewBuilding(b.id);
  }

  private buildingEconomy(b: NewBuilding, g: Game): string {
    const bt = buildingType(b.type);
    if (b.daysLeft > 0 || b.permitDays > 0) return '';
    if (bt.income === 'civic') return `<p class="hint">${t('nb.civic')}</p>`;
    const rows: string[] = [];
    if (bt.income === 'sale') {
      rows.push(`<dt>${t('nb.sold')}</dt><dd>${b.unitsSold} / ${bt.units - b.reserved} · ${money(g.world, unitPrice(b))}</dd>`);
    } else {
      rows.push(`<dt>${t('nb.occupancy')}</dt><dd>${Math.round(b.occupancy * 100)}% · ${money(g.world, monthlyIncome(b, g.difficulty.income))}/mo</dd>`);
    }
    if (b.reserved) rows.push(`<dt></dt><dd>${t('nb.reserved', { n: b.reserved })}</dd>`);
    rows.push(`<dt>${t('nb.income')}</dt><dd>${money(g.world, b.incomeLastMonth)}</dd>`);
    rows.push(`<dt>${t('nb.demand')}</dt><dd>×${demand(g, b).toFixed(2)}</dd>`);
    return `<dl>${rows.join('')}</dl>`;
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
        <span class="face">${o.kind === 'state' ? `<div class="avatar" style="--h:${avatarHue}">${esc(initials(o.name || name))}</div>` : portrait(o, currentEmotion(o, this.game?.records.get(o.id)?.log ?? []), 56)}</span>
        <div><b>${esc(name)}</b><small>${esc(subtitle)}</small></div>
        ${this.game?.records.get(o.id)?.log.length ? `<button id="panel-chat" class="icon" title="${t('chat.open')}">💬</button>` : ''}
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
        <dt>${t('panel.building')}</dt><dd>${p.kind !== 'building' ? t('panel.noBuilding')
          : this.game?.dev.buildingState(p) === 'demolished' ? t('panel.cleared')
            : t('panel.buildingValue', { area: p.footprintArea, floors: p.floors })}</dd>
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
    document.getElementById('panel-chat')?.addEventListener('click', () => this.openRoom('room', o.id));
    document.getElementById('panel-multi')?.addEventListener('click', () => this.cb.multi.addNeighbors(p.id));
    document.getElementById('panel-demolish')?.addEventListener('click', () => this.cb.demolishPlot(p.id));
    el.querySelectorAll<HTMLElement>('[data-plot]').forEach((b) => (b.onclick = () => this.cb.focusPlot(b.dataset.plot!)));
  }

  /** Negotiation summary + visit button (or ownership info). */
  private visitSection(p: Plot, o: Owner): string {
    const g = this.game;
    if (!g) return '';
    const w = g.world;
    if (g.ownsPlot(p.id)) {
      const promised = g.obligations.filter((ob) => ob.ownerId === o.id).map((ob) => tk(`opt.${ob.kind}`));
      const state = g.dev.buildingState(p);
      const dc = g.dev.demolitionCheck(p, true);
      const demolishing = g.dev.demolishing.get(p.buildingId ?? '');
      return `<div class="owned">✓ ${t('panel.youOwn')}${promised.length ? `<small>${t('panel.promised', { list: promised.join(', ') })}</small>` : ''}</div>
        ${state === 'standing' ? `<button id="panel-demolish" class="wide danger" ${dc.ok ? '' : 'disabled'}>⛏ ${t('panel.demolish', { cost: money(w, dc.cost), days: dc.days })}</button>` : ''}
        ${demolishing ? `<p class="hint center">${t('panel.demolishing', { days: demolishing.daysLeft })}</p>` : ''}`;
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
      ${check.block === 'cooldown' || check.block === 'angry' ? `<p class="hint center">${t('panel.visitBlocked', { days: check.days ?? 1 })}</p>` : ''}
      ${o.kind !== 'state' ? `<button id="panel-multi" class="wide">👥 ${t('multi.addNeighbors')}</button><p class="hint center">${t('multi.shiftHint')}</p>` : ''}`;
  }

  private settingsHtml(): string {
    const l = this.life;
    return `<h3>${t('set.title')}</h3>
      <div class="row"><span>${t('set.volume')}</span><input id="set-vol" type="range" min="0" max="1" step="0.05" value="${sound.volume}" /></div>
      <label class="check"><input id="set-mute" type="checkbox" ${sound.muted ? '' : 'checked'}/> ${t('set.sound')}</label>
      <label class="check"><input id="set-amb" type="checkbox" ${sound.ambient ? 'checked' : ''}/> ${t('set.ambient')}</label>
      <label class="check"><input id="set-traffic" type="checkbox" ${l?.showTraffic ? 'checked' : ''}/> ${t('set.traffic')}</label>
      <label class="check"><input id="set-clouds" type="checkbox" ${l?.showClouds ? 'checked' : ''}/> ${t('set.clouds')}</label>`;
  }

  private wireSettings(el: HTMLElement) {
    const q = (id: string) => el.querySelector<HTMLInputElement>(id)!;
    const saveVisuals = () => {
      try { localStorage.setItem('kotabaru.visuals', JSON.stringify({ traffic: this.life?.showTraffic, clouds: this.life?.showClouds })); } catch { /* ignore */ }
    };
    q('#set-vol').oninput = () => { sound.unlock(); sound.setVolume(parseFloat(q('#set-vol').value)); };
    q('#set-mute').onchange = () => { sound.unlock(); sound.setMuted(!q('#set-mute').checked); this.renderTopBar(); };
    q('#set-amb').onchange = () => { sound.unlock(); sound.setAmbient(q('#set-amb').checked); };
    q('#set-traffic').onchange = () => { if (this.life) this.life.showTraffic = q('#set-traffic').checked; saveVisuals(); };
    q('#set-clouds').onchange = () => { if (this.life) this.life.showClouds = q('#set-clouds').checked; saveVisuals(); };
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
    const tools: [Tool, string, StringKey, string][] = [
      ['select', '🖱', 'tool.select', 'V'], ['demolish', '⛏', 'tool.demolish', 'X'], ['road', '🛣', 'tool.road', 'N'], ['build', '🏗', 'tool.build', 'B'],
      ['zone', '🗺', 'tool.zone', 'Z'],
    ];
    const lenses: [Lens, StringKey, string][] = [['normal', 'lens.normal', '1'], ['plots', 'lens.plots', '2'], ['value', 'lens.value', '3']];
    el.innerHTML = `
      <div class="segmented">${tools.map(([id, icon, k, key]) => `<button data-tool="${id}" class="${this.tool === id && this.panel !== 'overlay' ? 'active' : ''}" title="${t(k)} (${key})">${icon} ${t(k)}</button>`).join('')}</div>
      <span class="sep"></span>
      <span class="group-label">${t('tool.lens')}</span>
      <div class="segmented">${lenses.map(([l, k, key]) => `<button data-lens="${l}" class="${this.lens === l ? 'active' : ''}" title="${key}">${t(k)}</button>`).join('')}</div>
      <span class="sep"></span>
      <button id="tb-overlay" class="${this.panel === 'overlay' ? 'active' : ''}">🛰 ${t('tool.overlay')}</button>
      <button id="tb-reset">⌂ ${t('tool.resetView')}</button>
      ${this.infoHidden ? `<button id="tb-info" title="${t('info.show')}">ⓘ ${t('info.show')}</button>` : ''}`;
    el.querySelectorAll<HTMLElement>('[data-tool]').forEach((b) => (b.onclick = () => {
      if (this.panel === 'overlay') { this.panel = this.session ? 'talk' : 'info'; this.overlay.adjusting = false; this.renderAll(); }
      this.cb.setTool(b.dataset.tool as Tool);
    }));
    $('#tb-overlay').onclick = () => { this.panel = 'overlay'; this.renderAll(); };
    $('#tb-reset').onclick = () => this.cb.resetView();
    document.getElementById('tb-info')?.addEventListener('click', () => { this.infoHidden = false; this.openPanel('info'); });
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
