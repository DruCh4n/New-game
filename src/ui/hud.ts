import { LANGS, getLang, setLang, t } from '../i18n';
import type { StringKey } from '../i18n/strings';
import type { MapData } from '../shared/mapTypes';
import type { MapEntry } from '../map/mapStore';
import type { OverlayManager } from '../render/OverlayManager';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

export type PanelMode = 'info' | 'overlay';

export interface HudCallbacks {
  selectMap(key: string): void;
  openMapFile(file: File): void;
  resetView(): void;
}

/** DOM-based HUD: top bar, side panel, status bar and bottom toolbar. */
export class Hud {
  panel: PanelMode = 'info';
  private maps: MapEntry[] = [];
  private currentKey = '';
  private map: MapData | null = null;

  constructor(private cb: HudCallbacks, private overlay: OverlayManager) {
    overlay.onChange = () => this.renderAll();
  }

  setMaps(maps: MapEntry[], currentKey: string) {
    this.maps = maps;
    this.currentKey = currentKey;
    this.renderTopBar();
  }

  setMap(map: MapData, key: string) {
    this.map = map;
    this.currentKey = key;
    this.renderAll();
  }

  renderAll() {
    document.title = t('app.title');
    this.renderTopBar();
    this.renderSidePanel();
    this.renderToolbar();
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
  }

  private renderSidePanel() {
    const el = $('#sidepanel');
    if (this.panel === 'overlay') return this.renderOverlayPanel(el);
    const m = this.map;
    if (!m) { el.innerHTML = ''; return; }
    const w = m.bounds.maxX - m.bounds.minX, h = m.bounds.maxY - m.bounds.minY;
    el.innerHTML = `
      <h2>${esc(m.name)}</h2>
      <dl>
        <dt>${t('info.source')}</dt><dd>${m.source === 'osm' ? t('info.osm') : t('info.synthetic')}</dd>
        <dt>${t('info.country')}</dt><dd>${esc(m.country ?? '—')}</dd>
        <dt>${t('info.size')}</dt><dd>${Math.round(w)} × ${Math.round(h)} m (${((w * h) / 1e6).toFixed(2)} km²)</dd>
        <dt>${t('info.center')}</dt><dd>${m.center.lat.toFixed(4)}, ${m.center.lon.toFixed(4)}</dd>
        <dt>${t('info.buildings')}</dt><dd>${m.buildings.length.toLocaleString()}</dd>
        <dt>${t('info.roads')}</dt><dd>${m.roads.length.toLocaleString()}</dd>
        <dt>${t('info.trees')}</dt><dd>${(m.trees.length / 2).toLocaleString()}</dd>
      </dl>
      <p class="hint">${t('help.controls')}</p>`;
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

  private renderToolbar() {
    const el = $('#toolbar');
    const future: [string, StringKey][] = [['🖱', 'tool.select'], ['⛏', 'tool.demolish'], ['🛣', 'tool.road'], ['🏗', 'tool.build']];
    el.innerHTML = `
      <button id="tb-pan" class="${this.panel === 'info' ? 'active' : ''}">✋ ${t('tool.pan')}</button>
      ${future.map(([icon, k]) => `<button disabled title="${t('tool.comingSoon')}">${icon} ${t(k)}</button>`).join('')}
      <span class="sep"></span>
      <button id="tb-overlay" class="${this.panel === 'overlay' ? 'active' : ''}">🛰 ${t('tool.overlay')}</button>
      <button id="tb-reset">⌂ ${t('tool.resetView')}</button>
      <span class="help">${t('help.controls')}</span>`;
    $('#tb-pan').onclick = () => { this.panel = 'info'; this.overlay.adjusting = false; this.renderAll(); };
    $('#tb-overlay').onclick = () => { this.panel = 'overlay'; this.renderAll(); };
    $('#tb-reset').onclick = () => this.cb.resetView();
  }
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Picks a round distance that is ~80–200 px long at the current zoom. */
function scaleBar(zoom: number): { px: number; label: string } {
  const target = 120 / zoom;
  const pow = 10 ** Math.floor(Math.log10(target));
  const nice = [1, 2, 5, 10].map((n) => n * pow).find((n) => n >= target * 0.7) ?? pow * 10;
  return { px: Math.round(nice * zoom), label: nice >= 1000 ? `${nice / 1000} km` : `${nice} m` };
}
