// Feature: production-grade-frontend, Property 10: Trip history ordering
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { sortHistory } from "./history";
import type { HistoryEntry } from "../../domain/trip/contract";

const entryArb = fc
  .record({
    ms: fc.integer({ min: Date.UTC(2020, 0, 1), max: Date.UTC(2030, 0, 1) }),
    rating: fc.option(fc.integer({ min: 1, max: 5 }), { nil: null }),
  })
  .map(
    ({ ms, rating }) =>
      ({
        trip: { id: "", requestedAt: new Date(ms).toISOString() },
        counterpartName: "n",
        counterpartRating: null,
        vehicleLabel: null,
        paymentStatus: "PENDING",
        rating,
      }) as unknown as HistoryEntry,
  );

const listArb = fc
  .array(entryArb, { maxLength: 40 })
  .map((list) => list.map((e, i) => ({ ...e, trip: { ...e.trip, id: `t${i}` } }) as HistoryEntry));

describe("sortHistory", () => {
  it("returns a permutation ordered by requestedAt non-increasing", () => {
    // **Validates: Requirements 4.8**
    fc.assert(
      fc.property(listArb, (input) => {
        const snapshot = input.map((e) => e.trip.id);
        const out = sortHistory(input);

        expect(input.map((e) => e.trip.id)).toEqual(snapshot);
        expect(out.map((e) => e.trip.id).sort()).toEqual([...snapshot].sort());
        for (let i = 1; i < out.length; i++) {
          expect(Date.parse(out[i - 1]!.trip.requestedAt)).toBeGreaterThanOrEqual(
            Date.parse(out[i]!.trip.requestedAt),
          );
        }
      }),
      { numRuns: 100 },
    );
  });
});
