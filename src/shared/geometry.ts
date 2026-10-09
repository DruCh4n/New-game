import type { FlatPoints } from './mapTypes';

/** Signed area (shoelace). Positive = clockwise on screen (y down). */
export function signedArea(p: FlatPoints): number {
  let a = 0;
  const n = p.length;
  for (let i = 0; i < n; i += 2) {
    const j = (i + 2) % n;
    a += p[i] * p[j + 1] - p[j] * p[i + 1];
  }
  return a / 2;
}

export function polygonArea(p: FlatPoints): number {
  return Math.abs(signedArea(p));
}

export function centroid(p: FlatPoints): [number, number] {
  let x = 0;
  let y = 0;
  const n = p.length / 2;
  for (let i = 0; i < p.length; i += 2) {
    x += p[i];
    y += p[i + 1];
  }
  return [x / n, y / n];
}

export function pointInPolygon(x: number, y: number, p: FlatPoints): boolean {
  let inside = false;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const xi = p[i], yi = p[i + 1], xj = p[j], yj = p[j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function bboxOf(p: FlatPoints): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < p.length; i += 2) {
    if (p[i] < minX) minX = p[i];
    if (p[i] > maxX) maxX = p[i];
    if (p[i + 1] < minY) minY = p[i + 1];
    if (p[i + 1] > maxY) maxY = p[i + 1];
  }
  return { minX, minY, maxX, maxY };
}

/** Distance from point to segment. */
export function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx - px, cy = ay + t * dy - py;
  return Math.sqrt(cx * cx + cy * cy);
}

/** Douglas-Peucker simplification on an open polyline. */
export function simplifyLine(p: FlatPoints, tolerance: number): FlatPoints {
  const n = p.length / 2;
  if (n <= 2 || tolerance <= 0) return p.slice();
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let maxD = 0, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = distToSegment(p[i * 2], p[i * 2 + 1], p[a * 2], p[a * 2 + 1], p[b * 2], p[b * 2 + 1]);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (idx >= 0 && maxD > tolerance) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  const out: FlatPoints = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(p[i * 2], p[i * 2 + 1]);
  return out;
}

export function roundPoints(p: FlatPoints, decimals = 1): FlatPoints {
  const f = 10 ** decimals;
  return p.map((v) => Math.round(v * f) / f);
}

/** Grows a simple polygon outward by d meters (miter joins, clamped so sharp corners don't spike). */
export function offsetPolygon(p: FlatPoints, d: number): FlatPoints {
  const n = p.length / 2;
  // On screen coords (y down) a positive shoelace area means clockwise; outward normal flips with orientation.
  const sign = signedArea(p) > 0 ? -1 : 1;
  const out: FlatPoints = [];
  for (let i = 0; i < n; i++) {
    const pi = (i + n - 1) % n, ni = (i + 1) % n;
    const x = p[i * 2], y = p[i * 2 + 1];
    let e1x = x - p[pi * 2], e1y = y - p[pi * 2 + 1];
    let e2x = p[ni * 2] - x, e2y = p[ni * 2 + 1] - y;
    const l1 = Math.hypot(e1x, e1y) || 1, l2 = Math.hypot(e2x, e2y) || 1;
    e1x /= l1; e1y /= l1; e2x /= l2; e2y /= l2;
    // left normals of each edge, flipped to point outward
    const n1x = -e1y * sign, n1y = e1x * sign, n2x = -e2y * sign, n2y = e2x * sign;
    let mx = n1x + n2x, my = n1y + n2y;
    const ml = Math.hypot(mx, my);
    if (ml < 1e-6) { mx = n1x; my = n1y; } else { mx /= ml; my /= ml; }
    const cos = mx * n1x + my * n1y;
    const len = Math.min(d / Math.max(cos, 0.25), d * 2);
    out.push(x + mx * len, y + my * len);
  }
  return out;
}

/** Minimum distance between two polygons (0 if they overlap). */
export function polygonDistance(a: FlatPoints, b: FlatPoints): number {
  if (pointInPolygon(a[0], a[1], b) || pointInPolygon(b[0], b[1], a)) return 0;
  let best = Infinity;
  const edgeScan = (pts: FlatPoints, poly: FlatPoints) => {
    for (let i = 0; i < pts.length; i += 2) {
      for (let j = 0; j < poly.length; j += 2) {
        const k = (j + 2) % poly.length;
        const d = distToSegment(pts[i], pts[i + 1], poly[j], poly[j + 1], poly[k], poly[k + 1]);
        if (d < best) best = d;
      }
    }
  };
  edgeScan(a, b);
  edgeScan(b, a);
  if (best > 0 && segmentsCross(a, b)) return 0;
  return best;
}

function segmentsCross(a: FlatPoints, b: FlatPoints): boolean {
  for (let i = 0; i < a.length; i += 2) {
    const i2 = (i + 2) % a.length;
    for (let j = 0; j < b.length; j += 2) {
      const j2 = (j + 2) % b.length;
      if (segIntersect(a[i], a[i + 1], a[i2], a[i2 + 1], b[j], b[j + 1], b[j2], b[j2 + 1])) return true;
    }
  }
  return false;
}

function segIntersect(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
  const o = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) => (qx - px) * (ry - py) - (qy - py) * (rx - px);
  const d1 = o(ax, ay, bx, by, cx, cy), d2 = o(ax, ay, bx, by, dx, dy);
  const d3 = o(cx, cy, dx, dy, ax, ay), d4 = o(cx, cy, dx, dy, bx, by);
  return d1 * d2 < 0 && d3 * d4 < 0;
}
