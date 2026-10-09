import { t } from '../i18n';
import { buildOverpassQuery } from '../shared/osm';
import { bboxAround } from '../map/mapStore';
import type { BBox } from '../shared/mapTypes';
import { esc } from './format';

export interface ImportActions {
  load(file: File, bbox: BBox | undefined, name: string): void;
  close(): void;
}

/** Remembered between renders. */
const state = { name: '', coords: '', size: 1000, query: '' };

function parseCoords(s: string): [number, number] | null {
  const m = s.match(/(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)/);
  if (!m) return null;
  const lat = parseFloat(m[1]), lon = parseFloat(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? [lat, lon] : null;
}

/** Step-by-step import of a real neighbourhood without Node: query → overpass-turbo → load file. */
export function renderImport(el: HTMLElement, a: ImportActions) {
  const coords = parseCoords(state.coords);
  const bbox = coords ? bboxAround(coords[0], coords[1], state.size) : undefined;
  el.innerHTML = `
    <div class="panel-head"><h2>${t('imp.title')}</h2><button id="panel-close" class="icon" aria-label="${t('panel.close')}">✕</button></div>
    <p class="hint">${t('imp.intro')}</p>
    <ol class="steps">
      <li>
        <b>${t('imp.step1')}</b>
        <label class="field">${t('imp.name')}<input id="imp-name" type="text" value="${esc(state.name)}" placeholder="Kampung Melayu" /></label>
        <label class="field">${t('imp.coords')}<input id="imp-coords" type="text" value="${esc(state.coords)}" placeholder="-6.2297, 106.8295" /></label>
        <small class="muted">${t('imp.coordsHint')}</small>
        <label class="field">${t('imp.size')}
          <select id="imp-size">${[500, 750, 1000, 1500].map((v) => `<option value="${v}" ${v === state.size ? 'selected' : ''}>${v} × ${v} m</option>`).join('')}</select>
        </label>
        ${state.coords && !coords ? `<p class="warn">${t('imp.badCoords')}</p>` : ''}
      </li>
      <li>
        <b>${t('imp.step2')}</b>
        ${bbox ? `<textarea id="imp-query" readonly rows="6">${esc(buildOverpassQuery(bbox))}</textarea>
          <div class="row"><button id="imp-copy">${t('imp.copy')}</button>
          <a href="https://overpass-turbo.eu/" target="_blank" rel="noopener">overpass-turbo.eu ↗</a></div>
          <small class="muted">${t('imp.turboHint')}</small>` : `<small class="muted">${t('imp.needCoords')}</small>`}
      </li>
      <li>
        <b>${t('imp.step3')}</b>
        <button id="imp-load" class="primary">${t('imp.load')}</button>
        <input id="imp-file" type="file" accept=".json,.geojson,application/json" hidden />
        <small class="muted">${t('imp.loadHint')}</small>
      </li>
    </ol>
    <p class="hint">${t('imp.attribution')}</p>`;

  const q = <T extends HTMLElement>(s: string) => el.querySelector<T>(s);
  q('#panel-close')!.onclick = a.close;
  q<HTMLInputElement>('#imp-name')!.oninput = (e) => { state.name = (e.target as HTMLInputElement).value; };
  q<HTMLInputElement>('#imp-coords')!.onchange = (e) => { state.coords = (e.target as HTMLInputElement).value; renderImport(el, a); };
  q<HTMLSelectElement>('#imp-size')!.onchange = (e) => { state.size = parseInt((e.target as HTMLSelectElement).value, 10); renderImport(el, a); };
  q('#imp-copy')?.addEventListener('click', async () => {
    const ta = q<HTMLTextAreaElement>('#imp-query')!;
    try { await navigator.clipboard.writeText(ta.value); q('#imp-copy')!.textContent = t('imp.copied'); }
    catch { ta.select(); }
  });
  const file = q<HTMLInputElement>('#imp-file')!;
  q('#imp-load')!.onclick = () => file.click();
  file.onchange = () => {
    if (file.files?.[0]) a.load(file.files[0], bbox, state.name.trim() || file.files[0].name.replace(/\.json$/i, ''));
    file.value = '';
  };
}
