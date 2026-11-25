// Feature: frontend-booking-and-password-login, Property 21: History is always sorted most-recent-first and is a permutation of its input
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { sortHistory } from "./history";

// Small timestamp pool so duplicate requestedAt values are common.
const baseMs = Date.UTC(2024, 0, 1);
const requestedAtArb = fc.integer({ min: 0, max: 5 }).map((n) => new Date(baseMs + n * 60_000).toISOString());

const listArb = fc
  .array(requestedAtArb, { maxLength: 40 })
  .map((times) => times.map((requestedAt, i) => ({ trip: { id: `t${i}`, requestedAt } })));

describe("sortHistory ordering", () => {
  it("is most-recent-first and a permutation of its input", () => {
    // **Validates: Requirements 8.2**
    fc.assert(
      fc.property(listArb, (input) => {
        const ids = input.map((e) => e.trip.id);
        const out = sortHistory(input);

        expect(out).toHaveLength(input.length);
        expect(out.map((e) => e.trip.id).sort()).toEqual([...ids].sort());
        expect(input.map((e) => e.trip.id)).toEqual(ids);
        for (let i = 1; i < out.length; i++) {
          expect(Date.parse(out[i]!.trip.requestedAt)).toBeLessThanOrEqual(Date.parse(out[i - 1]!.trip.requestedAt));
        }
      }),
      { numRuns: 100 },
    );
  });
});
