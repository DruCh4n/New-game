/** Uniform grid index of items by bounding box. */
export class SpatialGrid<T> {
  private cells = new Map<number, T[]>();
  constructor(private size: number) {}

  private key(cx: number, cy: number) {
    return (cx + 32768) * 65536 + (cy + 32768);
  }

  insert(item: T, minX: number, minY: number, maxX: number, maxY: number) {
    const s = this.size;
    for (let cx = Math.floor(minX / s); cx <= Math.floor(maxX / s); cx++)
      for (let cy = Math.floor(minY / s); cy <= Math.floor(maxY / s); cy++) {
        const k = this.key(cx, cy);
        const l = this.cells.get(k);
        if (l) l.push(item);
        else this.cells.set(k, [item]);
      }
  }

  /** Items whose cells overlap the box (may contain duplicates). */
  query(minX: number, minY: number, maxX: number, maxY: number, out: T[] = []): T[] {
    const s = this.size;
    for (let cx = Math.floor(minX / s); cx <= Math.floor(maxX / s); cx++)
      for (let cy = Math.floor(minY / s); cy <= Math.floor(maxY / s); cy++) {
        const l = this.cells.get(this.key(cx, cy));
        if (l) for (const it of l) out.push(it);
      }
    return out;
  }

  queryUnique(minX: number, minY: number, maxX: number, maxY: number): Set<T> {
    return new Set(this.query(minX, minY, maxX, maxY));
  }
}
