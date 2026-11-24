// Feature: production-grade-frontend, Property 13: Earnings aggregation
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { summarizeEarnings } from "./earnings";
import type { TripResponse } from "../../domain/trip/contract";

const DAY_MS = 86_400_000;
const BASE = Date.UTC(2025, 0, 1);

const nowArb = fc.integer({ min: BASE, max: BASE + 400 * DAY_MS }).map((ms) => new Date(ms));

/** Offsets in ms relative to `now`, spanning ~10 days before to 1 day after. */
const tripSpecArb = fc.record({
  offset: fc.integer({ min: -10 * DAY_MS, max: DAY_MS }),
  fare: fc.integer({ min: 0, max: 1_000_000 }),
});

const inputArb = fc.tuple(nowArb, fc.array(tripSpecArb, { maxLength: 40 }));

function toTrips(now: Date, specs: { offset: number; fare: number }[]): TripResponse[] {
  return specs.map(
    (s, i) =>
      ({
        id: `t${i}`,
        pickupAddress: "A",
        destinationAddress: "B",
        estimatedFare: null,
        finalFare: s.fare,
        completedAt: new Date(now.getTime() + s.offset).toISOString(),
      }) as unknown as TripResponse,
  );
}

describe("summarizeEarnings", () => {
  it("sums same-local-day and 7-day-window fares, with today <= week", () => {
    // **Validates: Requirements 5.7**
    fc.assert(
      fc.property(inputArb, ([now, specs]) => {
        const trips = toTrips(now, specs);
        const out = summarizeEarnings(trips, now);

        const completed = specs
          .map((s) => ({ ...s, at: new Date(now.getTime() + s.offset) }))
          .filter((s) => s.at.getTime() <= now.getTime());

        const expectedToday = completed
          .filter(
            (s) =>
              s.at.getFullYear() === now.getFullYear() &&
              s.at.getMonth() === now.getMonth() &&
              s.at.getDate() === now.getDate(),
          )
          .reduce((sum, s) => sum + s.fare, 0);
        const expectedWeek = completed
          .filter((s) => s.offset >= -7 * DAY_MS)
          .reduce((sum, s) => sum + s.fare, 0);

        expect(out.todayTotal).toBe(expectedToday);
        expect(out.weekTotal).toBe(expectedWeek);
        expect(out.todayTotal).toBeLessThanOrEqual(out.weekTotal);
      }),
      { numRuns: 100 },
    );
  });
});
