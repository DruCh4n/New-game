import type { LatLon } from './mapTypes';

const EARTH_RADIUS = 6378137;
const DEG = Math.PI / 180;

/**
 * Simple equirectangular projection around a center point.
 * Accurate to well under 1% for areas of a few km, which is all we need.
 * Output: x east (m), y SOUTH (m) so it maps directly onto screen space.
 */
export class LocalProjection {
  private readonly kx: number;
  private readonly ky: number;

  constructor(public readonly center: LatLon) {
    this.kx = EARTH_RADIUS * DEG * Math.cos(center.lat * DEG);
    this.ky = EARTH_RADIUS * DEG;
  }

  toLocal(lat: number, lon: number): [number, number] {
    return [(lon - this.center.lon) * this.kx, -(lat - this.center.lat) * this.ky];
  }

  toLatLon(x: number, y: number): LatLon {
    return { lat: this.center.lat - y / this.ky, lon: this.center.lon + x / this.kx };
  }
}
