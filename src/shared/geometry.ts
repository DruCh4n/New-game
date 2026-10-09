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
