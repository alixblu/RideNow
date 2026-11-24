/**
 * Feature: production-grade-frontend, Property 18: Seed determinism
 *
 * **Validates: Requirements 7.7**
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { generateAdminRows } from "./adminRows";
import { computeDriverRatings, generateSeedHistory, generateSeedTrips } from "./history";
import { mockProfiles } from "./people";

const seedArb = fc.integer({ min: -2_147_483_648, max: 2_147_483_647 });

describe("Property 18: Seed determinism", () => {
  it("generating profiles, history, ratings, and admin rows twice from the same seed is deeply equal", () => {
    fc.assert(
      fc.property(seedArb, (seed) => {
        const profilesBefore = JSON.stringify(mockProfiles);
        expect(generateSeedTrips(seed)).toEqual(generateSeedTrips(seed));
        expect(generateSeedHistory(seed)).toEqual(generateSeedHistory(seed));
        expect(computeDriverRatings(generateSeedTrips(seed))).toEqual(
          computeDriverRatings(generateSeedTrips(seed)),
        );
        expect(generateAdminRows(seed)).toEqual(generateAdminRows(seed));
        expect(JSON.stringify(mockProfiles)).toBe(profilesBefore);
      }),
      { numRuns: 30 },
    );
  });
});
