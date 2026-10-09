import type { MapData } from '../shared/mapTypes';
import { pointInPolygon } from '../shared/geometry';
import { hashString } from '../util/random';
import { buildPlots } from './plots';
import { generateOwners } from './owners';
import { regionFor, type Region } from './regional';
import type { SpatialGrid } from './spatial';
import type { Owner, Plot, PlotStatus } from './types';

/**
 * Everything generated from a map: plots, owners, spatial lookup.
 * Generation is deterministic (same map + seed → same owners), so saves only need what changed.
 */
export class World {
  readonly region: Region;
  readonly seed: number;
  readonly plots: Plot[];
  readonly owners: Owner[];
  private plotById: Map<string, Plot>;
  private ownerById: Map<string, Owner>;
  private grid: SpatialGrid<Plot>;
  readonly status = new Map<string, PlotStatus>();
  /** Range of value per m² (for the value lens). */
  readonly valueRange: [number, number];

  constructor(readonly map: MapData, seed?: number) {
    this.region = regionFor(map.country);
    this.seed = seed ?? hashString(`${map.name}|${map.center.lat}|${map.center.lon}`);
    const { plots, grid } = buildPlots(map, this.region, this.seed);
    this.plots = plots;
    this.grid = grid;
    this.owners = generateOwners(plots, map.country, this.seed);
    this.plotById = new Map(plots.map((p) => [p.id, p]));
    this.ownerById = new Map(this.owners.map((o) => [o.id, o]));
    const perM2 = plots.filter((p) => p.kind === 'building').map((p) => p.landValue / p.area).sort((a, b) => a - b);
    this.valueRange = perM2.length ? [perM2[Math.floor(perM2.length * 0.05)], perM2[Math.floor(perM2.length * 0.95)]] : [0, 1];
  }

  plot(id: string): Plot | undefined {
    return this.plotById.get(id);
  }

  owner(id: string): Owner | undefined {
    return this.ownerById.get(id);
  }

  ownerOf(plot: Plot): Owner {
    return this.ownerById.get(plot.ownerId)!;
  }

  statusOf(plotId: string): PlotStatus {
    return this.status.get(plotId) ?? 'not_approached';
  }

  /** Plot under a world point. Building footprints win over yard buffers of neighbours. */
  plotAt(x: number, y: number): Plot | null {
    const cands = this.grid.queryUnique(x, y, x, y);
    let buffered: Plot | null = null;
    for (const p of cands) {
      if (p.footprint && pointInPolygon(x, y, p.footprint)) return p;
      if (!buffered && pointInPolygon(x, y, p.poly)) buffered = p;
    }
    return buffered;
  }
}
