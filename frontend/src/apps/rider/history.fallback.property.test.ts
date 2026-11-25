// Feature: frontend-booking-and-password-login, Property 22: A missing address displays as its coordinates rounded to 4 decimal places
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { formatTripAddress } from "./history";

// A coordinate is (k + frac) / 10^4 with frac kept away from the .5 tie, so the expected
// 4dp value is computed with integer math, independent of Number#toFixed.
const coordArb = fc
  .record({
    neg: fc.boolean(),
    k: fc.integer({ min: 1, max: 1_800_000 }),
    frac: fc.oneof(fc.double({ min: 0.1, max: 0.4, noNaN: true }), fc.double({ min: 0.6, max: 0.9, noNaN: true })),
  })
  .map(({ neg, k, frac }) => {
    const scaled = frac < 0.5 ? k : k + 1;
    const sign = neg ? -1 : 1;
    const expected = `${neg ? "-" : ""}${Math.floor(scaled / 10_000)}.${String(scaled % 10_000).padStart(4, "0")}`;
    return { value: (sign * (k + frac)) / 10_000, expected };
  });

const missingArb = fc.constantFrom<string | null | undefined>(null, undefined, "", "   ");

describe("formatTripAddress coordinate fallback", () => {
  it("shows coordinates rounded to 4 decimal places when the address is missing", () => {
    // **Validates: Requirements 8.3**
    fc.assert(
      fc.property(missingArb, coordArb, coordArb, (address, lat, lng) => {
        expect(formatTripAddress(address, lat.value, lng.value)).toBe(`${lat.expected}, ${lng.expected}`);
      }),
      { numRuns: 100 },
    );
  });
});
