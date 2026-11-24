// Feature: production-grade-frontend, Property 17: Seeded ratings in range
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { createDriverMockClient } from "./mockClient";
import { mockProfiles } from "../seed/people";

/**
 * **Validates: Requirements 7.2**
 */
describe("Property 17: Seeded ratings in range", () => {
  it("seeded drivers have 1.0-5.0 average and a non-negative integer rated count", async () => {
    const client = createDriverMockClient();
    expect(mockProfiles.driver.length).toBeGreaterThan(0);
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...mockProfiles.driver), async (driver) => {
        const rating = await client.getDriverRating(driver.userId);
        expect(rating.average).toBeGreaterThanOrEqual(1);
        expect(rating.average).toBeLessThanOrEqual(5);
        expect(Number.isInteger(rating.ratedTrips)).toBe(true);
        expect(rating.ratedTrips).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 100 },
    );
  });
});
