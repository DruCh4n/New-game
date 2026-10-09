import { Application } from 'pixi.js';
import './style.css';
import { onLangChange, t } from './i18n';
import { Camera } from './render/Camera';
import { attachCameraControls } from './render/controls';
import { MapRenderer } from './render/MapRenderer';
import { OverlayManager } from './render/OverlayManager';
import { lastMap, listBundledMaps, loadMapFile, rememberMap } from './map/mapStore';
import { LocalProjection } from './shared/projection';
import type { MapData } from './shared/mapTypes';
import { Hud } from './ui/hud';
import { COLORS } from './render/styles';

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
  app.stage.addChild(renderer.world);
  const overlay = new OverlayManager(renderer, camera);

  let map: MapData | null = null;
  let projection: LocalProjection | null = null;
  let cursor: { sx: number; sy: number } | null = null;

  const maps = listBundledMaps();

  async function show(loader: () => Promise<MapData>, key: string) {
    hud.showLoading(t('loading'));
    try {
      const m = await loader();
      map = m;
      projection = new LocalProjection(m.center);
      renderer.setMap(m);
      camera.resize(app.screen.width, app.screen.height);
      camera.fitBounds(m.bounds);
      hud.setMap(m, key);
      await overlay.setMap(m, key);
      hud.showLoading(null);
    } catch (e) {
      console.error(e);
      hud.showLoading(t('loading.failed', { error: (e as Error).message }), true);
    }
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
    },
    overlay,
  );
  onLangChange(() => hud.renderAll());

  const updateKeys = attachCameraControls(host, camera, {
    onPointerMove: (sx, sy) => (cursor = { sx, sy }),
    interceptor: overlay,
  });
  host.addEventListener('pointerleave', () => (cursor = null));
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Home' && map) camera.fitBounds(map.bounds, 40, false);
  });

  let statusTimer = 0;
  app.ticker.add((ticker) => {
    const dt = Math.min(ticker.deltaMS / 1000, 0.1);
    camera.resize(app.screen.width, app.screen.height);
    updateKeys(dt);
    camera.update(dt);
    camera.apply(renderer.world);

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

  if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__game = { app, camera, renderer };

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
