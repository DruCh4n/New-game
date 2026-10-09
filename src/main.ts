import { Application } from 'pixi.js';
import './style.css';
import { getLang, onLangChange, t } from './i18n';
import { formatMoney } from './game/regional';
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
import { DevLayer } from './render/DevLayer';
import type { Tool } from './ui/hud';
import type { BuildingTypeId, RoadTypeId } from './game/catalog';
import type { Check } from './game/Development';
import { pointInPolygon } from './shared/geometry';
import type { FlatPoints } from './shared/mapTypes';
import { tk } from './i18n';

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
  const devLayer = new DevLayer(renderer.devGround, renderer.devTop);

  // ----- building tools state -----
  let tool: Tool = 'select';
  let buildType: BuildingTypeId = 'house';
  let roadTypeId: RoadTypeId = 'street';
  let rotation = 0; // extra rotation added to the auto road alignment (radians)
  let roadPoints: FlatPoints = [];
  let lastClick = { time: 0, x: 0, y: 0 };
  let lastRefresh = { demolished: 0, removed: 0 };

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
        if (e === 'status') { plotLayer.redrawLens(); devLayer.redraw(); }
        if (e === 'dev') {
          const d = g.dev;
          if (d.demolished.size !== lastRefresh.demolished || d.removedRoads.size !== lastRefresh.removed) {
            lastRefresh = { demolished: d.demolished.size, removed: d.removedRoads.size };
            renderer.refresh(d.demolished, d.removedRoads);
          }
          devLayer.redraw();
          if (hud.panel === 'info') hud.refreshPanel();
          hud.renderPalette();
        }
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
      lastRefresh = { demolished: 0, removed: 0 };
      devLayer.setGame(g);
      setTool('select');
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

  function setTool(next: Tool) {
    tool = next;
    roadPoints = [];
    devLayer.clearGhost();
    devLayer.showOwned = next !== 'select';
    devLayer.redraw();
    hud.setTool(next);
    hud.showText(null, 0, 0);
  }

  /** What the demolish tool would do at a world point. */
  function demolishTarget(x: number, y: number): { ok: boolean; label: string; poly?: FlatPoints; line?: { line: FlatPoints; width: number }; act?: () => void } | null {
    if (!game) return null;
    const g = game, dev = g.dev;
    const nb = dev.buildingAt(x, y);
    if (nb) return { ok: true, label: tk('demo.newBuilding', { name: tk(`bt.${nb.type}`) }), poly: nb.poly, act: () => dev.removeBuilding(nb.id) };
    const p = g.world.plotAt(x, y);
    if (p?.footprint && pointInPolygon(x, y, p.footprint) && dev.buildingState(p) === 'standing') {
      if (!g.ownsPlot(p.id)) return { ok: false, label: tk('demo.notYours'), poly: p.footprint };
      const c = dev.demolitionCheck(p, true);
      return {
        ok: c.ok, poly: p.footprint, act: () => g.demolish(p),
        label: `${tk('demo.building')} · ${c.ok ? costText(c) : tk(`prob.${c.problem}`)}`,
      };
    }
    const r = dev.pickRoad(x, y);
    if (r?.kind === 'new') {
      const nr = dev.roads.find((q) => q.id === r.id)!;
      return { ok: true, label: tk('demo.road'), line: { line: nr.line, width: 4 }, act: () => dev.removeRoad(r) };
    }
    if (r) {
      const orig = dev.originalRoad(r.id)!;
      const ok = dev.canRemoveOriginalRoad(r.id);
      const removable = ['service', 'path', 'track', 'living_street', 'pedestrian'].includes(orig.kind);
      return { ok, label: ok ? tk('demo.road') : tk(removable ? 'demo.cantRoad' : 'demo.mainRoad'), line: { line: orig.line, width: orig.width }, act: () => dev.removeRoad(r) };
    }
    return null;
  }

  function costText(c: Check) {
    return tk('tool.cost', { cost: game ? money(game, c.cost) : '', days: c.days });
  }
  function money(g: Game, v: number) {
    return formatMoney(v, g.world.region, getLang());
  }

  function buildAngle(x: number, y: number): number {
    return (game?.dev.roadAngle(x, y) ?? 0) + rotation;
  }

  /** Updates previews for the active tool at a screen position. */
  function previewAt(sx: number, sy: number) {
    if (!game || tool === 'select') return;
    const [wx, wy] = camera.screenToWorld(sx, sy);
    const dev = game.dev;
    if (tool === 'build') {
      const cx = Math.round(wx * 2) / 2, cy = Math.round(wy * 2) / 2;
      const a = buildAngle(cx, cy);
      const c = dev.buildingCheck(buildType, cx, cy, a);
      devLayer.ghostBuilding(game, buildType, cx, cy, a, c.ok);
      hud.showText(`<b>${tk(`bt.${buildType}`)}</b><span>${costText(c)}</span>${c.ok ? '' : `<span class="bad">${tk(`prob.${c.problem}`)}</span>`}`, sx, sy);
    } else if (tool === 'road') {
      const [px, py] = dev.snap(wx, wy, 6 / Math.max(camera.zoom, 0.3) + 3);
      const pts = [...roadPoints, px, py];
      const c = pts.length >= 4 ? dev.roadCheck(pts, roadTypeId) : null;
      devLayer.ghostRoad(pts, roadTypeId, c?.ok ?? true);
      hud.showText(c ? `<b>${tk(`rt.${roadTypeId}`)}</b><span>${costText(c)}</span>${c.ok ? '' : `<span class="bad">${tk(`prob.${c.problem}`)}</span>`}` : `<b>${tk(`rt.${roadTypeId}`)}</b>`, sx, sy);
    } else if (tool === 'demolish') {
      const target = demolishTarget(wx, wy);
      devLayer.ghostTarget(target?.poly ?? null, target?.line ?? null, target?.ok ?? false);
      hud.showText(target ? `<span class="${target.ok ? '' : 'bad'}">${target.label}</span>` : `<span>${tk('demo.nothing')}</span>`, sx, sy);
    }
  }

  function finishRoad() {
    if (!game || roadPoints.length < 4) return;
    const c = game.buildRoad(roadPoints, roadTypeId);
    if (!c.ok) game.toast({ kind: 'bad', key: 'toast.problem', params: { problem: tk(`prob.${c.problem}`) } });
    else game.toast({ kind: 'info', key: 'toast.placed', params: { cost: c.cost } });
    roadPoints = [];
    devLayer.clearGhost();
  }

  /** Clicks with a building tool. Returns true when handled. */
  function toolClick(sx: number, sy: number): boolean {
    if (!game || tool === 'select') return false;
    const [wx, wy] = camera.screenToWorld(sx, sy);
    if (tool === 'build') {
      const cx = Math.round(wx * 2) / 2, cy = Math.round(wy * 2) / 2;
      const c = game.placeBuilding(buildType, cx, cy, buildAngle(cx, cy));
      if (!c.ok) game.toast({ kind: 'bad', key: 'toast.problem', params: { problem: tk(`prob.${c.problem}`) } });
      else game.toast({ kind: 'info', key: 'toast.placed', params: { cost: c.cost } });
    } else if (tool === 'road') {
      const now = performance.now();
      const dbl = now - lastClick.time < 350 && Math.hypot(sx - lastClick.x, sy - lastClick.y) < 8;
      lastClick = { time: now, x: sx, y: sy };
      if (dbl) finishRoad();
      else {
        const [px, py] = game.dev.snap(wx, wy, 6 / Math.max(camera.zoom, 0.3) + 3);
        roadPoints.push(px, py);
      }
    } else if (tool === 'demolish') {
      const target = demolishTarget(wx, wy);
      if (target?.ok && target.act) target.act();
      else if (target) game.toast({ kind: 'bad', key: 'toast.problem', params: { problem: target.label } });
    }
    previewAt(sx, sy);
    return true;
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
      setTool,
      setBuildType: (b) => { buildType = b; rotation = 0; hud.buildType = b; hud.renderPalette(); },
      setRoadType: (r) => { roadTypeId = r; hud.roadType = r; hud.renderPalette(); },
      demolishPlot: (id) => { const p = world?.plot(id); if (p && game) game.demolish(p); },
      removeNewBuilding: (id) => { game?.dev.removeBuilding(id); hud.select(null); },
      addMoney: () => game?.addMoney(game.world.region.landPerM2 * 15000),
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
      if (tool !== 'select' && !game?.session) {
        plotLayer.setHovered(null);
        previewAt(sx, sy);
        return;
      }
      const p = overlay.active() ? null : pickAt(sx, sy);
      plotLayer.setHovered(p);
      hud.showTooltip(p, sx, sy);
    },
    onClick: (sx, sy) => {
      if (overlay.active()) return;
      if (game?.session) return; // finish or leave the conversation first
      if (toolClick(sx, sy)) return;
      const [wx, wy] = camera.screenToWorld(sx, sy);
      const nb = game?.dev.buildingAt(wx, wy);
      if (nb) {
        selected = null;
        plotLayer.setSelected(null);
        hud.selectNewBuilding(nb);
        return;
      }
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
    if (e.key === 'Escape' && !game?.session) {
      if (roadPoints.length) { roadPoints = []; devLayer.clearGhost(); }
      else if (tool !== 'select') setTool('select');
      else select(null);
    }
    if (!game?.session) {
      const k = e.key.toLowerCase();
      if (k === 'v') setTool('select');
      if (k === 'x') setTool('demolish');
      if (k === 'n') setTool('road');
      if (k === 'b') setTool('build');
      if (tool === 'build' && (k === 'r' || k === 'q' || k === 'e')) {
        rotation += k === 'r' ? Math.PI / 2 : k === 'q' ? -Math.PI / 12 : Math.PI / 12;
        if (cursor) previewAt(cursor.sx, cursor.sy);
      }
      if (tool === 'road' && e.key === 'Enter') finishRoad();
      if (tool === 'road' && e.key === 'Backspace') { roadPoints.splice(-2, 2); if (cursor) previewAt(cursor.sx, cursor.sy); }
    }
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
