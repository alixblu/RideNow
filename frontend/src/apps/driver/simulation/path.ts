/**
 * Pure Path builders for the driver Simulator (requirements 11.8-11.10, 11.18-11.20).
 *
 * A Path is the list of points the Simulator posts, one per Step_Interval. It excludes
 * the start point (the driver is already there), has no two consecutive points further
 * apart than `speed * stepInterval`, and ends exactly on the target.
 */

import type { LatLng, RoadSnapper } from "../../../map/roadSnapper";

const EARTH_RADIUS_M = 6_371_000;
/** Shrinks the step slightly so linear lat/lng interpolation stays under the limit. */
const STEP_SAFETY = 0.99;

/** Great-circle distance in metres. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Maximum distance in metres between consecutive Path points. */
export function maxStepMeters(speedKmh: number, stepIntervalMs: number): number {
  return (speedKmh / 3.6) * (stepIntervalMs / 1000);
}

function sameLocation(a: LatLng, b: LatLng): boolean {
  return a.lat === b.lat && a.lng === b.lng;
}

/** Straight-line interpolation from `from` (excluded) to `to` (included, exact). */
export function buildStraightLinePath(
  from: LatLng,
  to: LatLng,
  speedKmh: number,
  stepIntervalMs: number,
): LatLng[] {
  const step = maxStepMeters(speedKmh, stepIntervalMs) * STEP_SAFETY;
  const distance = haversineMeters(from, to);
  if (!(step > 0) || !Number.isFinite(distance) || distance === 0) {
    return [{ lat: to.lat, lng: to.lng }];
  }
  const count = Math.max(1, Math.ceil(distance / step));
  const points: LatLng[] = [];
  for (let i = 1; i < count; i++) {
    const t = i / count;
    points.push({
      lat: from.lat + (to.lat - from.lat) * t,
      lng: from.lng + (to.lng - from.lng) * t,
    });
  }
  points.push({ lat: to.lat, lng: to.lng });
  return points;
}

/**
 * Path along the OSRM route, resampled so no two points are further apart than the step.
 * Falls back to a straight line when the snapper is absent, throws, or returns no route.
 */
export async function buildRoutedPath(
  snapper: RoadSnapper | null | undefined,
  from: LatLng,
  to: LatLng,
  speedKmh: number,
  stepIntervalMs: number,
): Promise<LatLng[]> {
  let route: LatLng[] | null = null;
  if (snapper) {
    try {
      route = await snapper.route(from, to);
    } catch {
      route = null;
    }
  }
  if (!route || route.length < 2) {
    return buildStraightLinePath(from, to, speedKmh, stepIntervalMs);
  }

  const vertices = [from, ...route];
  const last = route[route.length - 1];
  if (last && !sameLocation(last, to)) {
    vertices.push(to); // OSRM snaps to roads; finish exactly on the target
  }

  const points: LatLng[] = [];
  for (let i = 1; i < vertices.length; i++) {
    const a = vertices[i - 1];
    const b = vertices[i];
    if (!a || !b || sameLocation(a, b)) {
      continue;
    }
    points.push(...buildStraightLinePath(a, b, speedKmh, stepIntervalMs));
  }
  if (points.length === 0) {
    return [{ lat: to.lat, lng: to.lng }];
  }
  return points;
}
