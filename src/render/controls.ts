import type { Camera } from './Camera';

/** Lets another tool (e.g. overlay alignment) take over drag/wheel input. */
export interface InputInterceptor {
  active(): boolean;
  /** Only intercept drags with this mouse button (others still pan). */
  button?: number;
  dragStart?(wx: number, wy: number): void;
  drag(dwx: number, dwy: number): void;
  wheel?(sx: number, sy: number, deltaY: number, shift: boolean): void;
}

export interface ControlsOptions {
  onPointerMove?(sx: number, sy: number): void;
  onClick?(sx: number, sy: number, e?: PointerEvent): void;
  interceptor?: InputInterceptor;
}

export function attachCameraControls(el: HTMLElement, cam: Camera, opts: ControlsOptions = {}) {
  let dragging = false;
  let moved = 0;
  let lastX = 0, lastY = 0, lastT = 0;
  let vx = 0, vy = 0;
  let intercepted = false;
  const keys = new Set<string>();
  /** Active touch/mouse pointers for multi-touch pinch. */
  const pointers = new Map<number, { x: number; y: number }>();
  let pinchDist = 0; // last two-finger distance
  let pinched = false;

  const local = (e: { clientX: number; clientY: number }) => {
    const r = el.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };

  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.button !== 1 && e.button !== 2) return;
    try { el.setPointerCapture(e.pointerId); } catch { /* synthetic or already-released pointer */ }
    const [px, py] = local(e);
    pointers.set(e.pointerId, { x: px, y: py });
    if (pointers.size === 2) { pinchDist = twoFingerDist(); pinched = true; return; }
    if (pointers.size > 2) return;
    dragging = true;
    moved = 0;
    [lastX, lastY] = [px, py];
    lastT = performance.now();
    vx = vy = 0;
    cam.stopInertia();
    const ic = opts.interceptor;
    intercepted = !!ic?.active() && (ic.button === undefined || ic.button === e.button);
    if (intercepted) opts.interceptor!.dragStart?.(...cam.screenToWorld(lastX, lastY));
    el.classList.add('dragging');
  });

  el.addEventListener('pointermove', (e) => {
    const [x, y] = local(e);
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x, y });
    // two fingers: pinch to zoom around their midpoint
    if (pointers.size === 2) {
      const [mx, my] = twoFingerMid();
      const d = twoFingerDist();
      if (pinchDist > 0 && d > 0) cam.zoomAt(mx, my, d / pinchDist);
      pinchDist = d;
      dragging = false;
      return;
    }
    opts.onPointerMove?.(x, y);
    if (!dragging) return;
    const dx = x - lastX, dy = y - lastY;
    moved += Math.abs(dx) + Math.abs(dy);
    const now = performance.now();
    const dt = Math.max(1, now - lastT) / 1000;
    if (intercepted) opts.interceptor!.drag(dx / cam.zoom, dy / cam.zoom);
    else {
      cam.panByScreen(dx, dy);
      vx = vx * 0.6 + (dx / dt) * 0.4;
      vy = vy * 0.6 + (dy / dt) * 0.4;
    }
    lastX = x; lastY = y; lastT = now;
  });

  const end = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchDist = 0;
    if (pointers.size === 1) {
      // lifted one finger of a pinch: re-anchor the remaining one so the view doesn't jump
      const [only] = [...pointers.values()];
      lastX = only.x; lastY = only.y; lastT = performance.now();
      dragging = true; moved = 999; // don't treat as a tap
      return;
    }
    if (!dragging) { if (pinched && pointers.size === 0) pinched = false; return; }
    dragging = false;
    el.classList.remove('dragging');
    if (moved < 5 && !pinched) {
      const [x, y] = local(e);
      opts.onClick?.(x, y, e);
    } else if (!intercepted && performance.now() - lastT < 80) {
      cam.setInertia(vx, vy);
    }
    if (pointers.size === 0) pinched = false;
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('contextmenu', (e) => e.preventDefault());

  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    const [x, y] = local(e);
    // normalise pixel/line/page wheel deltas
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
    if (opts.interceptor?.active() && opts.interceptor.wheel) {
      opts.interceptor.wheel(x, y, dy, e.shiftKey);
      return;
    }
    cam.zoomAt(x, y, Math.exp(-dy * 0.0015));
  }, { passive: false });

  window.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement)?.closest('input, select, textarea')) return;
    keys.add(e.key.toLowerCase());
    if (e.key === '+' || e.key === '=') cam.zoomAt(cam.width / 2, cam.height / 2, 1.4);
    if (e.key === '-' || e.key === '_') cam.zoomAt(cam.width / 2, cam.height / 2, 1 / 1.4);
  });
  window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  window.addEventListener('blur', () => keys.clear());

  function twoFingerDist(): number {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }
  function twoFingerMid(): [number, number] {
    const [a, b] = [...pointers.values()];
    return [(a.x + b.x) / 2, (a.y + b.y) / 2];
  }

  /** Call every frame for continuous keyboard panning. */
  return function updateKeys(dt: number) {
    let dx = 0, dy = 0;
    if (keys.has('a') || keys.has('arrowleft')) dx -= 1;
    if (keys.has('d') || keys.has('arrowright')) dx += 1;
    if (keys.has('w') || keys.has('arrowup')) dy -= 1;
    if (keys.has('s') || keys.has('arrowdown')) dy += 1;
    if (dx || dy) cam.nudge(dx * 700 * dt, dy * 700 * dt);
  };
}
