import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { estimateFare } from "./estimateFare";

// Feature: production-grade-frontend, Property 7: Fare estimate derivation
// **Validates: Requirements 7.1**

const lat = fc.double({ min: 8.5, max: 23, noNaN: true });
const lng = fc.double({ min: 102.5, max: 109, noNaN: true });

const route = fc.record({
  pickupLat: lat,
  pickupLng: lng,
  destinationLat: lat,
  destinationLng: lng,
});

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
          const at = (t: number) => ({
            pickupLat: pLat,
            pickupLng: pLng,
            destinationLat: pLat + dLat * t,
            destinationLng: pLng + dLng * t,
          });
          for (const vt of ["MOTORBIKE", "CAR"] as const) {
            expect(estimateFare(at(far), vt).amount).toBeGreaterThanOrEqual(estimateFare(at(near), vt).amount);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
