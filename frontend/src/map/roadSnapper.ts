/**
 * Road snapping behind one interface (see docs/REALTIME.md section 7).
 *
 *  - `snapTrace` (OSRM `match`): snap recent real GPS points to roads, for display only.
 *  - `route` (OSRM `route`): a road-following list of points from A to B, which the
 *    driver's "simulate drive" walks along.
 *
 * Snapped points are display-only: they are never sent to a service or stored.
 * Any OSRM error or timeout falls back to the raw input (or a straight line).
 * `VITE_OSRM_URL` empty => {@link NoopSnapper}.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

export interface RoadSnapper {
  /** Snap a GPS trace to roads. Returns the input unchanged on any failure. */
  snapTrace(points: LatLng[]): Promise<LatLng[]>;
  /** Road route from `from` to `to`. Returns `[from, to]` on any failure. */
  route(from: LatLng, to: LatLng): Promise<LatLng[]>;
}

/** Snapping off: raw points, straight-line routes. */
export class NoopSnapper implements RoadSnapper {
  snapTrace(points: LatLng[]): Promise<LatLng[]> {
    return Promise.resolve(points);
  }

  route(from: LatLng, to: LatLng): Promise<LatLng[]> {
    return Promise.resolve([from, to]);
  }
}

type FetchLike = (input: string, init?: { signal?: AbortSignal }) => Promise<{
  ok: boolean;
  json(): Promise<unknown>;
}>;

interface OsrmGeometry {
  coordinates: [number, number][];
}

/** OSRM HTTP client. Coordinates go to OSRM as `lng,lat`, as its API requires. */
export class OsrmSnapper implements RoadSnapper {
  private readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly timeoutMs = 2000,
    private readonly fetchFn: FetchLike = (input, init) => fetch(input, init),
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async snapTrace(points: LatLng[]): Promise<LatLng[]> {
    // `match` needs at least two points.
    if (points.length < 2) {
      return points;
    }
    const url =
      `${this.baseUrl}/match/v1/driving/${coords(points)}` +
      `?geometries=geojson&overview=full&gaps=ignore&tidy=true`;
    const body = await this.get(url);
    const matchings = (body as { code?: string; matchings?: { geometry: OsrmGeometry }[] } | null);
    if (!matchings || matchings.code !== "Ok" || !matchings.matchings?.length) {
      return points;
    }
    const snapped = matchings.matchings.flatMap((m) => toLatLng(m.geometry));
    return snapped.length >= 2 ? snapped : points;
  }

  async route(from: LatLng, to: LatLng): Promise<LatLng[]> {
    const url =
      `${this.baseUrl}/route/v1/driving/${coords([from, to])}` +
      `?geometries=geojson&overview=full`;
    const body = await this.get(url);
    const routes = (body as { code?: string; routes?: { geometry: OsrmGeometry }[] } | null);
    if (!routes || routes.code !== "Ok" || !routes.routes?.length) {
      return [from, to];
    }
    const points = toLatLng(routes.routes[0]?.geometry);
    return points.length >= 2 ? points : [from, to];
  }

  /** GET with a timeout; null on any failure. */
  private async get(url: string): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchFn(url, { signal: controller.signal });
      return response.ok ? await response.json() : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}

function coords(points: LatLng[]): string {
  return points.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(";");
}

function toLatLng(geometry: OsrmGeometry | undefined): LatLng[] {
  return (geometry?.coordinates ?? []).map(([lng, lat]) => ({ lat, lng }));
}

/** The snapper for the current configuration. */
export function createRoadSnapper(osrmUrl: string | null): RoadSnapper {
  return osrmUrl ? new OsrmSnapper(osrmUrl) : new NoopSnapper();
}
