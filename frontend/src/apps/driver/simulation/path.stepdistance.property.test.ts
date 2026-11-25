// Feature: frontend-booking-and-password-login, Property 32: Consecutive Path points never exceed the speed-derived step distance
// **Validates: Requirements 11.20**
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { buildRoutedPath, buildStraightLinePath, haversineMeters, maxStepMeters } from "./path";
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

function expectStepsWithinLimit(from: LatLng, path: LatLng[], speed: number, interval: number): void {
  const limit = maxStepMeters(speed, interval);
  let prev = from;
  for (const p of path) {
    expect(haversineMeters(prev, p)).toBeLessThanOrEqual(limit + EPS_M);
    prev = p;
  }
}

/** Fake OSRM route with arbitrary intermediate vertices around the from-to line. */
function snapperWithVertices(offsets: LatLng[]): RoadSnapper {
  return {
    snapTrace: (points) => Promise.resolve(points),
    route: (from, to) => {
      const n = offsets.length;
      const mids = offsets.map((o, i) => {
        const t = (i + 1) / (n + 1);
        return {
          lat: from.lat + (to.lat - from.lat) * t + o.lat,
          lng: from.lng + (to.lng - from.lng) * t + o.lng,
        };
      });
      return Promise.resolve([...mids, to]);
    },
  };
}

describe("Property 32: step distance never exceeds speed * stepInterval", () => {
  it("straight-line Path points stay within the step distance", () => {
    fc.assert(
      fc.property(pairArb, speedArb, intervalArb, ([from, to], speed, interval) => {
        expectStepsWithinLimit(from, buildStraightLinePath(from, to, speed, interval), speed, interval);
      }),
      { numRuns: 100 },
    );
  });

  it("routed Path points stay within the step distance", async () => {
    const offsetArb = fc.record({
      lat: fc.double({ min: -0.01, max: 0.01, noNaN: true }),
      lng: fc.double({ min: -0.01, max: 0.01, noNaN: true }),
    });
    await fc.assert(
      fc.asyncProperty(
        pairArb,
        speedArb,
        intervalArb,
        fc.array(offsetArb, { maxLength: 5 }),
        async ([from, to], speed, interval, offsets) => {
          const path = await buildRoutedPath(snapperWithVertices(offsets), from, to, speed, interval);
          expectStepsWithinLimit(from, path, speed, interval);
        },
      ),
      { numRuns: 100 },
    );
  });
});
