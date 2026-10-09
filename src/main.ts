import { Application } from 'pixi.js';
import './style.css';
import { getLang, onLangChange, t } from './i18n';
import { formatMoney } from './game/regional';
import { Camera } from './render/Camera';
import { attachCameraControls } from './render/controls';
import { MapRenderer } from './render/MapRenderer';
import { OverlayManager } from './render/OverlayManager';
import { PlotLayer, type Lens } from './render/PlotLayer';
import { lastMap, listBundledMaps, listMaps, loadMapFile, rememberMap, saveImportedMap } from './map/mapStore';
import type { BBox } from './shared/mapTypes';
import type { DifficultyId } from './game/balance';
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
import { Terrain } from './render/Terrain';
import { Life } from './render/Life';
import { sound } from './audio/Sound';
import type { Tool } from './ui/hud';
import type { BuildingTypeId, RoadTypeId } from './game/catalog';
import type { Check } from './game/Development';
import { pointInPolygon } from './shared/geometry';
import type { FlatPoints } from './shared/mapTypes';
import { ROAD } from './game/LandGrid';
import { paintZone, type Zone } from './game/District';
import type { InputInterceptor } from './render/controls';
import { tk } from './i18n';
import { isSaveData, restore, serialize, type SaveData } from './game/save';
import { readSlot, writeSlot } from './game/saveStore';

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
  const life = new Life();

  // ----- building tools state -----
  let tool: Tool = 'select';
  let buildType: BuildingTypeId = 'house';
  let roadTypeId: RoadTypeId = 'street';
  let rotation = 0; // extra rotation added to the auto road alignment (radians)
  let roadPoints: FlatPoints = [];
  let lastClick = { time: 0, x: 0, y: 0 };
  let lastRefresh = { demolished: 0, removed: 0 };
  let zoneSel: Zone = 1;
  let brushR = 8;
  let paintAt = [0, 0];
  let zonesDirty = false;
  let terrain: Terrain | null = null;
  let terrainVersion = '';

  /** Trees disappear where land is cleared, built on or paved. */
  function refreshCanopy(g: Game) {
    const d = g.dev;
    const v = `${d.demolished.size}|${d.buildings.length}|${d.roads.length}|${d.removedRoads.size}`;
    if (!terrain || v === terrainVersion) return;
    terrainVersion = v;
    const w = g.world, P = w.parcels, f = w.grid.flags;
    terrain.bakeCanopy((i) => {
      if (f[i] & ROAD) return true;
      const k = P[i];
      const b = k >= 0 ? w.plots[k].buildingId : undefined;
      return !!b && d.demolished.has(b);
    });
  }

  let map: MapData | null = null;
  let world: World | null = null;
  let game: Game | null = null;
  let projection: LocalProjection | null = null;
  let cursor: { sx: number; sy: number } | null = null;
  let selected: Plot | null = null;
  let currentKey = '';
  let currentLoader: (() => Promise<MapData>) | null = null;

  let maps = listBundledMaps();

  /** Opens a map file or converts an Overpass download, keeping imported maps in the browser. */
  async function openFile(file: File, bbox?: BBox, name?: string) {
    hud.showLoading(t('loading'));
    try {
      const { map: m, stats } = await loadMapFile(file, bbox, name);
      if (!stats) return void show(() => Promise.resolve(m), `file:${file.name}`);
      const key = await saveImportedMap(m).catch(() => `file:${file.name}`);
      maps = await listMaps();
      hud.setMaps(maps, key);
      rememberMap(key);
      hud.showToast({ kind: 'good', key: 'imp.done', params: { n: stats.buildings, pois: stats.pois } });
      for (const w of stats.warnings) hud.showToast({ kind: 'info', key: 'toast.problem', params: { problem: w } });
      hud.openPanel('info');
      await show(() => Promise.resolve(m), key);
    } catch (e) {
      hud.showLoading(t('loading.failed', { error: (e as Error).message }), true);
    }
  }

  async function show(loader: () => Promise<MapData>, key: string, save?: SaveData, difficulty: DifficultyId = 'normal') {
    hud.showLoading(t('loading'));
    try {
      const m = await loader();
      await new Promise((r) => setTimeout(r, 30)); // let the loading message paint before heavy work
      const g = save ? restore(save, m) : new Game(new World(m), difficulty);
      const w = g.world;
      currentKey = key;
      currentLoader = () => Promise.resolve(m);
      g.on((e) => {
        if (e === 'status') { plotLayer.redrawLens(); devLayer.redraw(); if (tool === 'zone') hud.renderPalette(); }
        if (e === 'dev') {
          const d = g.dev;
          if (d.demolished.size !== lastRefresh.demolished || d.removedRoads.size !== lastRefresh.removed) {
            lastRefresh = { demolished: d.demolished.size, removed: d.removedRoads.size };
            renderer.refresh(d.demolished, d.removedRoads);
          }
          devLayer.redraw();
          refreshCanopy(g);
          life.rebuildLanes();
          if (hud.panel === 'info') hud.refreshPanel();
          hud.renderPalette();
        }
        if (e === 'day' || e === 'money' || e === 'speed') hud.updateStats();
        if (e === 'month') {
          writeSlot('auto', serialize(g, currentKey));
          if (hud.panel === 'finance') hud.refreshPanel();
        }
        if (e === 'day' && selected && hud.panel === 'info') hud.refreshPanel();
      });
      g.onToast((tst) => {
        hud.showToast(tst);
        if (tst.key === 'toast.sold') sound.play('coin');
        else if (tst.key === 'toast.built' || tst.key === 'toast.civic') sound.play('done');
        else if (tst.key === 'toast.month') sound.play('month');
        else if (tst.key === 'toast.placed') sound.play('build');
        else if (tst.kind === 'bad') sound.play('error');
      });
      map = m;
      world = w;
      game = g;
      selected = null;
      projection = new LocalProjection(m.center);
      renderer.setMap(m);
      renderer.highlights.addChild(plotLayer.container);
      plotLayer.setWorld(w);
      terrain?.destroy();
      terrain = new Terrain(w);
      terrainVersion = '';
      renderer.terrainSlot.addChild(terrain.ground);
      renderer.canopySlot.addChild(terrain.canopy);
      renderer.lifeSlot.addChild(life.below);
      renderer.devTop.addChild(life.above);
      life.setGame(g);
      refreshCanopy(g);
      lastRefresh = { demolished: g.dev.demolished.size, removed: g.dev.removedRoads.size };
      renderer.refresh(g.dev.demolished, g.dev.removedRoads);
      devLayer.setGame(g);
      setTool('select');
      camera.resize(app.screen.width, app.screen.height);
      camera.fitBounds(m.bounds);
      hud.setMap(m, key, g);
      await overlay.setMap(m, key);
      hud.showLoading(null);
      if (save) hud.showToast({ kind: 'good', key: 'game.loaded' });
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

  function paint(x: number, y: number) {
    if (!game) return;
    if (paintZone(game, x, y, brushR, zoneSel)) { game.zoneVersion++; zonesDirty = true; }
  }

  /** Routes drags to the overlay alignment or the zone brush; everything else pans. */
  const interceptor: InputInterceptor = {
    active: () => overlay.active() || (tool === 'zone' && !!game?.districtUnlocked && !game.session),
    get button() { return overlay.active() ? undefined : 0; },
    dragStart: (wx, wy) => {
      if (overlay.active()) return;
      paintAt = [wx, wy];
      paint(wx, wy);
    },
    drag: (dx, dy) => {
      if (overlay.active()) return overlay.drag(dx, dy);
      paintAt = [paintAt[0] + dx, paintAt[1] + dy];
      paint(paintAt[0], paintAt[1]);
      devLayer.ghostBrush(paintAt[0], paintAt[1], brushR, zoneSel);
    },
    wheel: (sx, sy, deltaY, shift) => {
      if (overlay.active()) return overlay.wheel(sx, sy, deltaY, shift);
      camera.zoomAt(sx, sy, Math.exp(-deltaY * 0.0015));
    },
  };

  function setTool(next: Tool) {
    tool = next;
    devLayer.zoneStrong = next === 'zone';
    devLayer.redrawZones();
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
    if (tool === 'zone') {
      hud.showText(null, 0, 0);
      if (game.districtUnlocked) devLayer.ghostBrush(wx, wy, brushR, zoneSel);
      return;
    }
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
    if (tool === 'zone') { paint(wx, wy); return true; }
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
      if (target?.ok && target.act) { target.act(); sound.play('demolish'); }
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
      openMapFile: (file) => void openFile(file),
      importer: {
        load: (file, bbox, name) => void openFile(file, bbox, name),
        close: () => hud.openPanel('info'),
      },
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
      demolishPlot: (id) => { const p = world?.plot(id); if (p && game && game.demolish(p).ok) sound.play('demolish'); },
      removeNewBuilding: (id) => { game?.dev.removeBuilding(id); hud.select(null); },
      addMoney: () => game?.addMoney(game.world.region.landPerM2 * 15000),
      setZone: (z, b) => { zoneSel = z; brushR = b; },
      gameMenu: {
        save: (slot) => {
          if (!game) return;
          const ok = writeSlot(slot, serialize(game, currentKey));
          hud.showToast({ kind: ok ? 'good' : 'bad', key: ok ? 'game.saved' : 'game.saveFailed' });
          hud.refreshPanel();
        },
        load: (slot) => { const d = readSlot(slot); if (d) loadSave(d); },
        exportFile: () => {
          if (!game) return;
          const blob = new Blob([JSON.stringify(serialize(game, currentKey))], { type: 'application/json' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = `kotabaru-${currentKey.replace(/^file:/, '').replace(/[^a-z0-9-]+/gi, '-')}-day${game.day}.json`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        },
        importFile: async (file) => {
          try {
            const data = JSON.parse(await file.text());
            if (!isSaveData(data)) throw new Error('not a Kota Baru save file');
            loadSave(data);
          } catch (e) {
            hud.showToast({ kind: 'bad', key: 'game.loadFailed', params: { error: (e as Error).message } });
          }
        },
        newGame: (d) => { if (currentLoader) void show(currentLoader, currentKey, undefined, d); },
        close: () => hud.openPanel('info'),
      },
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

  /** Loads a save, switching to its map if needed. */
  function loadSave(data: SaveData) {
    if (data.mapKey === currentKey && currentLoader) return void show(currentLoader, currentKey, data);
    const entry = maps.find((m) => m.key === data.mapKey);
    if (!entry) {
      hud.showToast({ kind: 'bad', key: 'game.otherMap', params: { map: data.mapName } });
      return;
    }
    rememberMap(entry.key);
    hud.setMaps(maps, entry.key);
    void show(entry.load, entry.key, data);
  }

  /** Runs a negotiation action on the current conversation and refreshes the panel. */
  function talk(fn: (g: Game, s: NonNullable<Game['session']>) => unknown) {
    if (!game?.session) return;
    sound.play('talk');
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
    interceptor,
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
      if (k === 'z') setTool('zone');
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
  let zoneTimer = 0;
  app.ticker.add((ticker) => {
    const dt = Math.min(ticker.deltaMS / 1000, 0.1);
    camera.resize(app.screen.width, app.screen.height);
    updateKeys(dt);
    camera.update(dt);
    game?.tick(dt);
    camera.apply(renderer.world);
    plotLayer.update(camera.zoom);
    life.update(dt, camera.zoom, game?.speed ?? 0);
    zoneTimer += dt;
    if (zonesDirty && zoneTimer > 0.08) {
      zonesDirty = false;
      zoneTimer = 0;
      devLayer.redrawZones();
      hud.renderPalette();
    }

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

  // sound starts with the first interaction; buttons click
  window.addEventListener('pointerdown', () => sound.unlock(), { capture: true });
  document.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('button')) sound.play('click'); });
  try {
    const v = JSON.parse(localStorage.getItem('kotabaru.visuals') ?? '{}');
    if (typeof v.traffic === 'boolean') life.showTraffic = v.traffic;
    if (typeof v.clouds === 'boolean') life.showClouds = v.clouds;
  } catch { /* ignore */ }
  hud.life = life;

  if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__game = { app, camera, renderer, life, get terrain() { return terrain; }, get world() { return world; }, get game() { return game; }, get selected() { return selected; } };

  maps = await listMaps();
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
