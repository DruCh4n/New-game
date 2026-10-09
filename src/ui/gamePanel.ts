import { t } from '../i18n';
import { SLOTS, slotMeta, type Slot } from '../game/saveStore';
import { formatDate, money } from './format';
import type { Game } from '../game/Game';
import { START_YEAR } from '../game/owners';

export interface GameMenuActions {
  save(slot: Slot): void;
  load(slot: Slot): void;
  exportFile(): void;
  importFile(file: File): void;
  newGame(): void;
  close(): void;
}

let confirmNew = false;

/** Save / load panel. */
export function renderGameMenu(el: HTMLElement, game: Game | null, a: GameMenuActions) {
  const rows = SLOTS.map((slot) => {
    const meta = slotMeta(slot);
    const label = slot === 'auto' ? t('game.auto') : t('game.slot', { n: slot });
    const info = meta && game
      ? t('game.slotInfo', { map: meta.mapName, date: formatDate(new Date(Date.UTC(START_YEAR, 0, 1 + meta.day))), money: money(game.world, meta.money) })
      : meta ? meta.mapName : t('game.empty');
    return `<li><div><b>${label}</b><small>${info}</small></div>
      <span>${slot !== 'auto' ? `<button data-save="${slot}" ${game ? '' : 'disabled'}>${t('game.save')}</button>` : ''}
      <button data-load="${slot}" ${meta ? '' : 'disabled'}>${t('game.load')}</button></span></li>`;
  }).join('');
  el.innerHTML = `
    <div class="panel-head"><h2>${t('game.title')}</h2><button id="panel-close" class="icon" aria-label="${t('panel.close')}">✕</button></div>
    <ul class="slots">${rows}</ul>
    <div class="row">
      <button id="g-export" ${game ? '' : 'disabled'}>⬇ ${t('game.export')}</button>
      <button id="g-import">⬆ ${t('game.import')}</button>
      <input id="g-file" type="file" accept=".json,application/json" hidden />
    </div>
    <p class="hint">${t('game.hint')}</p>
    <button id="g-new" class="wide danger">${confirmNew ? t('game.newConfirm') : t('game.new')}</button>`;
  el.querySelector<HTMLElement>('#panel-close')!.onclick = a.close;
  el.querySelectorAll<HTMLElement>('[data-save]').forEach((b) => (b.onclick = () => a.save(b.dataset.save as Slot)));
  el.querySelectorAll<HTMLElement>('[data-load]').forEach((b) => (b.onclick = () => a.load(b.dataset.load as Slot)));
  el.querySelector<HTMLElement>('#g-export')!.onclick = a.exportFile;
  const file = el.querySelector<HTMLInputElement>('#g-file')!;
  el.querySelector<HTMLElement>('#g-import')!.onclick = () => file.click();
  file.onchange = () => { if (file.files?.[0]) a.importFile(file.files[0]); file.value = ''; };
  el.querySelector<HTMLElement>('#g-new')!.onclick = () => {
    if (confirmNew) { confirmNew = false; a.newGame(); } else { confirmNew = true; renderGameMenu(el, game, a); }
  };
}
