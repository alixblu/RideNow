import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { swapPlaces } from "./place";

const placeArb = fc.record({
  lat: fc.double({ min: -90, max: 90, noNaN: true }),
  lng: fc.double({ min: -180, max: 180, noNaN: true }),
  address: fc.string(),
});
const maybePlace = fc.option(placeArb, { nil: null });

describe("swapPlaces", () => {
  // Feature: frontend-booking-and-password-login, Property 14: Swapping pickup and destination is its own inverse
  // **Validates: Requirements 5.9**
  it("exchanges the pair once and restores it when applied twice", () => {
    fc.assert(
      fc.property(maybePlace, maybePlace, (pickup, destination) => {
        const once = swapPlaces(pickup, destination);
        expect(once.pickup).toEqual(destination);
        expect(once.destination).toEqual(pickup);
        const twice = swapPlaces(once.pickup, once.destination);
        expect(twice.pickup).toEqual(pickup);
        expect(twice.destination).toEqual(destination);
      }),
      { numRuns: 100 },
    );
  });
});
