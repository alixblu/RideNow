// Feature: frontend-booking-and-password-login, Property 30: Generated Path points progress monotonically toward the target
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { buildRoutedPath, buildStraightLinePath, haversineMeters } from "./path";
import type { LatLng, RoadSnapper } from "../../../map/roadSnapper";

/** Tolerance for floating point noise in haversine, in metres. */
const EPS_M = 1e-3;

const coordArb: fc.Arbitrary<LatLng> = fc.record({
  lat: fc.double({ min: -60, max: 60, noNaN: true }),
  lng: fc.double({ min: -170, max: 170, noNaN: true }),
});

/** A target within roughly 30 km of the pickup. */
const pairArb = fc
  .tuple(
    coordArb,
    fc.double({ min: -0.25, max: 0.25, noNaN: true }),
    fc.double({ min: -0.25, max: 0.25, noNaN: true }),
  )
  .map(([from, dLat, dLng]): [LatLng, LatLng] => [from, { lat: from.lat + dLat, lng: from.lng + dLng }]);

const speedArb = fc.integer({ min: 5, max: 120 });
const intervalArb = fc.integer({ min: 500, max: 5000 });

function expectMonotonic(from: LatLng, to: LatLng, path: LatLng[]): void {
  let prev = haversineMeters(from, to);
  for (const p of path) {
    const d = haversineMeters(p, to);
    expect(d).toBeLessThanOrEqual(prev + EPS_M);
    prev = d;
  }
}

/** Fake OSRM route whose vertices advance along the from-to line. */
function snapperAlongLine(ts: number[]): RoadSnapper {
  return {
    snapTrace: (points) => Promise.resolve(points),
    route: (from, to) => {
      const sorted = [...ts].sort((a, b) => a - b);
      const mids = sorted.map((t) => ({
        lat: from.lat + (to.lat - from.lat) * t,
        lng: from.lng + (to.lng - from.lng) * t,
      }));
      return Promise.resolve([...mids, to]);
    },
  };
}

describe("Property 30: monotonic progress toward the target", () => {
  it("straight-line Path points never move away from the target", () => {
    fc.assert(
      fc.property(pairArb, speedArb, intervalArb, ([from, to], speed, interval) => {
        expectMonotonic(from, to, buildStraightLinePath(from, to, speed, interval));
      }),
      { numRuns: 100 },
    );
  });

  it("routed Path points never move away from the target", async () => {
    await fc.assert(
      fc.asyncProperty(
        pairArb,
        speedArb,
        intervalArb,
        fc.array(fc.double({ min: 0.01, max: 0.99, noNaN: true }), { maxLength: 5 }),
        async ([from, to], speed, interval, ts) => {
          const path = await buildRoutedPath(snapperAlongLine(ts), from, to, speed, interval);
          expectMonotonic(from, to, path);
        },
      ),
      { numRuns: 100 },
    );
  });
});
