import { describe, it } from "vitest";
import fc from "fast-check";
import { fromRequestFields, toRequestFields } from "./place";

describe("Place request fields", () => {
  // Feature: frontend-booking-and-password-login, Property 13: Place round-trips through its request fields
  // **Validates: Requirements 5.13**
  it("round-trips through toRequestFields / fromRequestFields", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -90, max: 90, noNaN: true }),
        fc.double({ min: -180, max: 180, noNaN: true }),
        fc.string(),
        (lat, lng, address) => {
          const place = { lat, lng, address };
          const result = fromRequestFields(toRequestFields(place));
          return (
            Object.is(result.lat, lat) &&
            Object.is(result.lng, lng) &&
            result.address === address
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});
