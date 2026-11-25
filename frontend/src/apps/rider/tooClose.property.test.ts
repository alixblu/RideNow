// Feature: frontend-booking-and-password-login, Property 16: The confirm button is disabled exactly when pickup and destination are within 100 metres
// **Validates: Requirements 6.2**
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { isTooClose } from "./tripView";
import type { Place } from "../../geocoding/contract";

const R = 6_371_000;
const METRES_PER_DEGREE_LAT = (R * Math.PI) / 180;

const place = (lat: number, lng: number): Place => ({ address: "x", lat, lng });

/** Independent haversine oracle. */
function haversine(a: Place, b: Place): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

describe("Property 16: too-close rule", () => {
  it("is true exactly when the pair is under 100 m apart (due-north offsets around the threshold)", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -80, max: 80, noNaN: true }),
        fc.double({ min: -180, max: 180, noNaN: true }),
        fc.double({ min: 0, max: 300, noNaN: true }).filter((d) => Math.abs(d - 100) > 0.5),
        (lat, lng, metres) => {
          const pickup = place(lat, lng);
          const destination = place(lat + metres / METRES_PER_DEGREE_LAT, lng);
          expect(isTooClose(pickup, destination)).toBe(metres < 100);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("agrees with an independent haversine for arbitrary coordinate pairs", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -90, max: 90, noNaN: true }),
        fc.double({ min: -180, max: 180, noNaN: true }),
        fc.double({ min: -90, max: 90, noNaN: true }),
        fc.double({ min: -180, max: 180, noNaN: true }),
        (la, lo, lb, lp) => {
          const a = place(la, lo);
          const b = place(lb, lp);
          const d = haversine(a, b);
          fc.pre(Math.abs(d - 100) > 0.01);
          expect(isTooClose(a, b)).toBe(d < 100);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("is true for identical places and symmetric", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -90, max: 90, noNaN: true }),
        fc.double({ min: -180, max: 180, noNaN: true }),
        fc.double({ min: -90, max: 90, noNaN: true }),
        fc.double({ min: -180, max: 180, noNaN: true }),
        (la, lo, lb, lp) => {
          expect(isTooClose(place(la, lo), place(la, lo))).toBe(true);
          expect(isTooClose(place(la, lo), place(lb, lp))).toBe(isTooClose(place(lb, lp), place(la, lo)));
        },
      ),
      { numRuns: 100 },
    );
  });
});
