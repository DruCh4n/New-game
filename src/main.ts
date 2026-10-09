import { Application } from 'pixi.js';
import './style.css';
import { onLangChange, t } from './i18n';
import { Camera } from './render/Camera';
import { attachCameraControls } from './render/controls';
import { MapRenderer } from './render/MapRenderer';
import { OverlayManager } from './render/OverlayManager';
import { PlotLayer, type Lens } from './render/PlotLayer';
import { lastMap, listBundledMaps, loadMapFile, rememberMap } from './map/mapStore';
import { LocalProjection } from './shared/projection';
import type { MapData } from './shared/mapTypes';
import { Hud } from './ui/hud';
import { COLORS } from './render/styles';
import { World } from './game/World';
import type { Plot } from './game/types';
import { Game } from './game/Game';
import { acceptCounter, giveGift, leave, listen, makeOffer, pressure, startVisit } from './game/negotiation';
import { resetDraft } from './ui/negotiationPanel';

async function boot() {
  const host = document.getElementById('canvas-host')!;
  const app = new Application();
  await app.init({
    resizeTo: host,
    background: COLORS.background,
    antialias: true,
    autoDensity: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
  });
  host.appendChild(app.canvas);

  const camera = new Camera();
  const renderer = new MapRenderer();
  const plotLayer = new PlotLayer();
  renderer.highlights.addChild(plotLayer.container);
  app.stage.addChild(renderer.world);
  const overlay = new OverlayManager(renderer, camera);

  let map: MapData | null = null;
  let world: World | null = null;
  let game: Game | null = null;
  let projection: LocalProjection | null = null;
  let cursor: { sx: number; sy: number } | null = null;
  let selected: Plot | null = null;

  const maps = listBundledMaps();

  async function show(loader: () => Promise<MapData>, key: string) {
    hud.showLoading(t('loading'));
    try {
      const m = await loader();
      await new Promise((r) => setTimeout(r, 30)); // let the loading message paint before heavy work
      const w = new World(m);
      const g = new Game(w);
      g.on((e) => {
        if (e === 'status') plotLayer.redrawLens();
        if (e === 'day' || e === 'money' || e === 'speed') hud.updateStats();
        if (e === 'day' && selected && hud.panel === 'info') hud.refreshPanel();
      });
      g.onToast((tst) => hud.showToast(tst));
      map = m;
      world = w;
      game = g;
      selected = null;
      projection = new LocalProjection(m.center);
      renderer.setMap(m);
      renderer.highlights.addChild(plotLayer.container);
      plotLayer.setWorld(w);
      camera.resize(app.screen.width, app.screen.height);
      camera.fitBounds(m.bounds);
      hud.setMap(m, key, g);
      await overlay.setMap(m, key);
      hud.showLoading(null);
    } catch (e) {
      console.error(e);
      hud.showLoading(t('loading.failed', { error: (e as Error).message }), true);
    }
  }

  function select(p: Plot | null) {
    selected = p;
    plotLayer.setSelected(p);
    hud.select(p);
  }

  function setLens(l: Lens) {
    plotLayer.setLens(l);
    hud.setLens(l);
  }

  const hud = new Hud(
    {
      selectMap: (key) => {
        const entry = maps.find((m) => m.key === key);
        if (!entry) return;
        rememberMap(key);
        void show(entry.load, key);
      },
      openMapFile: (file) => void show(() => loadMapFile(file), `file:${file.name}`),
      resetView: () => map && camera.fitBounds(map.bounds, 40, false),
      setLens,
      focusPlot: (id) => {
        const p = world?.plot(id);
        if (!p) return;
        select(p);
        camera.centerOn(p.cx, p.cy, 3);
      },
      clearSelection: () => select(null),
      visit: (id) => {
        const p = world?.plot(id);
        if (!p || !game) return;
        resetDraft();
        game.pauseForTalk(true);
        hud.showSession(startVisit(game, p));
      },
      setSpeed: (sp) => game?.setSpeed(sp),
      negotiation: {
        offer: (cash, opts) => talk((g, s) => makeOffer(g, s, cash, opts)),
        acceptAsk: () => talk((g, s) => acceptCounter(g, s)),
        listen: () => talk((g, s) => listen(g, s)),
        gift: () => talk((g, s) => giveGift(g, s)),
        pressure: () => talk((g, s) => pressure(g, s)),
        leave: () => talk((g, s) => leave(g, s)),
        back: () => {
          if (game?.session && !game.session.ended) leave(game, game.session);
          if (game) { game.session = null; game.pauseForTalk(false); }
          hud.showSession(null);
          select(selected);
        },
      },
    },
    overlay,
  );
  onLangChange(() => hud.renderAll());

  /** Runs a negotiation action on the current conversation and refreshes the panel. */
  function talk(fn: (g: Game, s: NonNullable<Game['session']>) => unknown) {
    if (!game?.session) return;
    fn(game, game.session);
    hud.refreshPanel();
    hud.updateStats();
  }

  const pickAt = (sx: number, sy: number): Plot | null => {
    if (!world) return null;
    const [x, y] = camera.screenToWorld(sx, sy);
    return world.plotAt(x, y);
  };

  const updateKeys = attachCameraControls(host, camera, {
    onPointerMove: (sx, sy) => {
      cursor = { sx, sy };
      const p = overlay.active() ? null : pickAt(sx, sy);
      plotLayer.setHovered(p);
      hud.showTooltip(p, sx, sy);
    },
    onClick: (sx, sy) => {
      if (overlay.active()) return;
      if (game?.session) return; // finish or leave the conversation first
      select(pickAt(sx, sy));
    },
    interceptor: overlay,
  });
  host.addEventListener('pointerleave', () => {
    cursor = null;
    plotLayer.setHovered(null);
    hud.showTooltip(null, 0, 0);
  });
  host.addEventListener('pointerdown', () => hud.showTooltip(null, 0, 0));
  window.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement)?.closest('input, select, textarea')) return;
    if (e.key === 'Home' && map) camera.fitBounds(map.bounds, 40, false);
    if (e.key === 'Escape' && !game?.session) select(null);
    if (e.key === ' ' && game && !game.session) {
      e.preventDefault();
      game.setSpeed(game.speed === 0 ? 1 : 0);
    }
    if (e.key === '1') setLens('normal');
    if (e.key === '2') setLens('plots');
    if (e.key === '3') setLens('value');
  });

  let statusTimer = 0;
  app.ticker.add((ticker) => {
    const dt = Math.min(ticker.deltaMS / 1000, 0.1);
    camera.resize(app.screen.width, app.screen.height);
    updateKeys(dt);
    camera.update(dt);
    game?.tick(dt);
    camera.apply(renderer.world);
    plotLayer.update(camera.zoom);

    statusTimer += dt;
    if (statusTimer > 0.15) {
      statusTimer = 0;
      let c = null;
      if (cursor && projection) {
        const [x, y] = camera.screenToWorld(cursor.sx, cursor.sy);
        const ll = projection.toLatLon(x, y);
        c = { x, y, lat: ll.lat, lon: ll.lon };
      }
      hud.updateStatus(c, camera.zoom, ticker.FPS);
    }
  });

  if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__game = { app, camera, renderer, get world() { return world; }, get game() { return game; }, get selected() { return selected; } };

  hud.setMaps(maps, '');
  hud.renderAll();
  if (!maps.length) {
    hud.showLoading(t('nomaps'), true);
    return;
  }
  const start = maps.find((m) => m.key === lastMap()) ?? maps.find((m) => m.key === 'sample-kampung') ?? maps[0];
  hud.setMaps(maps, start.key);
  await show(start.load, start.key);
}

void boot();
