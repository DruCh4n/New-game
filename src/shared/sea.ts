import type { MapData } from './mapTypes';
import { decodeRle } from './rle';

/** Returns a fast "is this point sea?" test for a map, or null if it has no sea. */
export function seaSampler(map: MapData): ((x: number, y: number) => boolean) | null {
  if (!map.sea) return null;
  const { res, rle } = map.sea;
  const b = map.bounds;
  const w = Math.ceil((b.maxX - b.minX) / res), h = Math.ceil((b.maxY - b.minY) / res);
  const data = new Uint8Array(w * h);
  decodeRle(rle, data);
  return (x, y) => {
    const cx = Math.floor((x - b.minX) / res), cy = Math.floor((y - b.minY) / res);
    return cx >= 0 && cy >= 0 && cx < w && cy < h && data[cy * w + cx] === 1;
  };
}
