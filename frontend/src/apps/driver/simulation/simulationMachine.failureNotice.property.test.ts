import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  start,
  advance,
  recordPostResult,
  currentPoint,
  isNoticeVisible,
} from "./simulationMachine";

// Feature: frontend-booking-and-password-login, Property 28: The simulation failure notice tracks the consecutive-failure run length
describe("simulationMachine failure notice (Property 28)", () => {
  /** **Validates: Requirements 11.14** */
  it("notice is visible iff the current failure run is >= 3, and failures retry the same point", () => {
    fc.assert(
      fc.property(
        fc.array(fc.boolean(), { maxLength: 60 }),
        fc.integer({ min: 1, max: 80 }),
        (outcomes, pathLen) => {
          const path = Array.from({ length: pathLen }, (_, i) => ({
            lat: i,
            lng: i,
          }));
          let s = start({} as never, "trip", path);
          let run = 0;
          for (const ok of outcomes) {
            const before = s.index;
            const pointBefore = currentPoint(s);
            s = recordPostResult(s, ok);
            if (ok) {
              run = 0;
              s = advance(s);
            } else {
              run += 1;
              // failed attempt does not advance: same point retried
              expect(s.index).toBe(before);
              expect(currentPoint(s)).toEqual(pointBefore);
            }
            expect(isNoticeVisible(s)).toBe(run >= 3);
            if (ok) expect(isNoticeVisible(s)).toBe(false);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
