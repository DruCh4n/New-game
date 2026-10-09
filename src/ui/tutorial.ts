import { t, tk } from '../i18n';
import type { Game } from '../game/Game';
import { TUTORIAL_STEPS, checkObjectives } from '../game/scenarios';
import type { Plot } from '../game/types';

export interface TutorialContext {
  selected(): Plot | null;
  panel(): string;
  /** Pulsing ring on the map (null to hide). */
  marker(x: number, y: number, on: boolean): void;
}

interface Step { target?: string; done: (g: Game, plot: Plot, c: TutorialContext) => boolean }

const owned = (g: Game, plot: Plot) => g.world.ownerOf(plot).plotIds.filter((id) => g.ownsPlot(id)).map((id) => g.world.plot(id)!);

/** The guided first deal, step by step. Checked a few times a second; highlights the UI to use. */
const STEPS: Step[] = [
  { done: (_g, p, c) => c.selected()?.id === p.id || c.selected()?.ownerId === p.ownerId },
  { target: '#panel-visit', done: (g, p) => g.session?.ownerId === p.ownerId },
  { target: '#neg-listen', done: (g) => !!g.session?.listened },
  { target: '#neg-offer', done: (g, p) => g.record(p.ownerId).lastOffer !== undefined },
  { target: '#neg-accept, #neg-offer', done: (g, p) => g.ownsPlot(p.id) },
  { target: '#neg-close, #neg-back', done: (g) => !g.session },
  { target: '[data-tool="demolish"]', done: (g, p) => owned(g, p).some((q) => g.dev.buildingState(q) !== 'standing') },
  { target: '[data-speed="4"]', done: (g, p) => owned(g, p).every((q) => g.dev.buildingState(q) !== 'standing' && g.dev.buildingState(q) !== 'demolishing') },
  { target: '[data-tool="build"]', done: (g) => g.dev.buildings.length > 0 },
  { target: '[data-speed="4"]', done: (g) => g.dev.buildings.some((b) => b.daysLeft === 0) },
  { target: '#stat-money', done: (_g, _p, c) => c.panel() === 'finance' },
  { target: '#tut-finish', done: () => false }, // finished with the button
];

export class Tutorial {
  private highlighted: Element[] = [];

  constructor(private el: HTMLElement, private game: Game, private plot: Plot, private ctx: TutorialContext) {
    this.render();
  }

  get step() { return this.game.scenario.tutorialStep; }

  /** Call regularly; advances when the current step is done. */
  update() {
    const g = this.game;
    if (this.step >= TUTORIAL_STEPS) return this.stop();
    let advanced = false;
    while (this.step < TUTORIAL_STEPS - 1 && STEPS[this.step].done(g, this.plot, this.ctx)) {
      g.scenario.tutorialStep++;
      advanced = true;
    }
    if (advanced) this.render();
    this.ctx.marker(this.plot.cx, this.plot.cy, this.step < 6);
    this.highlight();
  }

  private highlight() {
    for (const e of this.highlighted) e.classList.remove('coach-target');
    this.highlighted = [];
    const sel = STEPS[this.step]?.target;
    if (!sel) return;
    const e = document.querySelector(sel);
    if (e) { e.classList.add('coach-target'); this.highlighted.push(e); }
  }

  render() {
    const n = this.step;
    if (n >= TUTORIAL_STEPS) { this.el.hidden = true; return; }
    this.el.hidden = false;
    this.el.innerHTML = `
      <div class="coach-head"><b>🎓 ${t('tut.step', { n: n + 1, total: TUTORIAL_STEPS })}</b><button id="tut-skip" class="link">${t('tut.skip')}</button></div>
      <p>${tk(`tut.${n}`)}</p>
      ${n === TUTORIAL_STEPS - 1 ? `<button id="tut-finish" class="primary wide">${t('tut.next')}</button>` : ''}
      <div class="dots">${Array.from({ length: TUTORIAL_STEPS }, (_, i) => `<i class="${i < n ? 'on' : i === n ? 'now' : ''}"></i>`).join('')}</div>`;
    this.el.querySelector<HTMLElement>('#tut-skip')!.onclick = () => this.finish();
    this.el.querySelector<HTMLElement>('#tut-finish')?.addEventListener('click', () => this.finish());
  }

  finish() {
    this.game.scenario.tutorialStep = TUTORIAL_STEPS;
    checkObjectives(this.game);
    this.stop();
  }

  stop() {
    for (const e of this.highlighted) e.classList.remove('coach-target');
    this.highlighted = [];
    this.ctx.marker(0, 0, false);
    this.el.hidden = true;
  }
}
