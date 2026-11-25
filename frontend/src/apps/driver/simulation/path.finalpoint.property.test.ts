// Feature: frontend-booking-and-password-login, Property 31: The final Path point lands within 1 metre of the target
// **Validates: Requirements 11.19**
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { buildRoutedPath, buildStraightLinePath, haversineMeters } from "./path";
import type { LatLng, RoadSnapper } from "../../../map/roadSnapper";

const coordArb: fc.Arbitrary<LatLng> = fc.record({
  lat: fc.double({ min: -60, max: 60, noNaN: true }),
  lng: fc.double({ min: -170, max: 170, noNaN: true }),
});

const pairArb = fc
  .tuple(
    coordArb,
    fc.double({ min: -0.25, max: 0.25, noNaN: true }),
    fc.double({ min: -0.25, max: 0.25, noNaN: true }),
  )
  .map(([from, dLat, dLng]): [LatLng, LatLng] => [from, { lat: from.lat + dLat, lng: from.lng + dLng }]);

const speedArb = fc.integer({ min: 5, max: 120 });
const intervalArb = fc.integer({ min: 500, max: 5000 });

/** Fake OSRM route that ends up to ~20 m away from the target (road snapping). */
function snapperEndingNear(offsetLat: number, offsetLng: number): RoadSnapper {
  return {
    snapTrace: (points) => Promise.resolve(points),
    route: (from, to) =>
      Promise.resolve([
        { lat: (from.lat + to.lat) / 2, lng: (from.lng + to.lng) / 2 },
        { lat: to.lat + offsetLat, lng: to.lng + offsetLng },
      ]),
  };
}

describe("Property 31: final Path point lands on the target", () => {
  it("straight-line Path ends within 1 m of the target", () => {
    fc.assert(
      fc.property(pairArb, speedArb, intervalArb, ([from, to], speed, interval) => {
        const path = buildStraightLinePath(from, to, speed, interval);
        const last = path[path.length - 1];
        expect(last).toBeDefined();
        expect(haversineMeters(last as LatLng, to)).toBeLessThanOrEqual(1);
      }),
      { numRuns: 100 },
    );
  });

  it("routed Path ends within 1 m of the target, even when OSRM snaps elsewhere", async () => {
    await fc.assert(
      fc.asyncProperty(
        pairArb,
        speedArb,
        intervalArb,
        fc.double({ min: -0.0002, max: 0.0002, noNaN: true }),
        fc.double({ min: -0.0002, max: 0.0002, noNaN: true }),
        async ([from, to], speed, interval, dLat, dLng) => {
          const path = await buildRoutedPath(snapperEndingNear(dLat, dLng), from, to, speed, interval);
          const last = path[path.length - 1];
          expect(last).toBeDefined();
          expect(haversineMeters(last as LatLng, to)).toBeLessThanOrEqual(1);
        },
      ),
      { numRuns: 100 },
    );
  });
});
