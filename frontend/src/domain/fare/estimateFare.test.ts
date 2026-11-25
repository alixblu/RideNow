import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { estimateFare } from "./estimateFare";
import type { Place } from "../../geocoding/contract";

// Feature: production-grade-frontend, Property 7: Fare estimate derivation
// **Validates: Requirements 7.1, 6.1**

const lat = fc.double({ min: 8.5, max: 23, noNaN: true });
const lng = fc.double({ min: 102.5, max: 109, noNaN: true });

const place = fc
  .record({ address: fc.string({ minLength: 1, maxLength: 40 }), lat, lng })
  .map((p): Place => p);

/** Requests are derived from selected Places, as the Booking_Sheet does (Req 6.1). */
function fromPlaces(pickup: Place, destination: Place) {
  return {
    pickupLat: pickup.lat,
    pickupLng: pickup.lng,
    destinationLat: destination.lat,
    destinationLng: destination.lng,
  };
}

const route = fc.tuple(place, place).map(([a, b]) => fromPlaces(a, b));

describe("Property 7: Fare estimate derivation", () => {
  it("is deterministic and yields positive integer VND amounts", () => {
    fc.assert(
      fc.property(route, fc.constantFrom("MOTORBIKE" as const, "CAR" as const), (req, vt) => {
        const a = estimateFare(req, vt);
        const b = estimateFare({ ...req }, vt);
        expect(a).toEqual(b);
        expect(Number.isInteger(a.amount)).toBe(true);
        expect(a.amount).toBeGreaterThan(0);
        expect(a.currency).toBe("VND");
      }),
      { numRuns: 100 },
    );
  });

  it("MOTORBIKE is strictly cheaper than CAR for the same route", () => {
    fc.assert(
      fc.property(route, (req) => {
        expect(estimateFare(req, "MOTORBIKE").amount).toBeLessThan(estimateFare(req, "CAR").amount);
      }),
      { numRuns: 100 },
    );
  });

  it("does not decrease when the destination is farther on the same bearing", () => {
    fc.assert(
      fc.property(
        lat,
        lng,
        fc.double({ min: -0.2, max: 0.2, noNaN: true }),
        fc.double({ min: -0.2, max: 0.2, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (pLat, pLng, dLat, dLng, s1, s2) => {
          const [near, far] = s1 <= s2 ? [s1, s2] : [s2, s1];
          const pickup: Place = { address: "pickup", lat: pLat, lng: pLng };
          const at = (t: number) =>
            fromPlaces(pickup, { address: "destination", lat: pLat + dLat * t, lng: pLng + dLng * t });
          for (const vt of ["MOTORBIKE", "CAR"] as const) {
            expect(estimateFare(at(far), vt).amount).toBeGreaterThanOrEqual(estimateFare(at(near), vt).amount);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
