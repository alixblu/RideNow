// Feature: frontend-booking-and-password-login, Property 27: Pausing and resuming the Simulator loses no point and repeats no point
// **Validates: Requirements 11.11**
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  advance,
  currentPoint,
  initialSimulatorState,
  pause,
  recordPostResult,
  resume,
  start,
  type SimulatorState,
} from "./simulationMachine";
import type { LatLng } from "../../../map/roadSnapper";

const pointArb: fc.Arbitrary<LatLng> = fc.record({
  lat: fc.double({ min: -80, max: 80, noNaN: true }),
  lng: fc.double({ min: -179, max: 179, noNaN: true }),
});

const pathArb = fc.array(pointArb, { minLength: 1, maxLength: 60 });

/** Posts every available point while running; each post may fail first (retry). */
function drain(initial: SimulatorState, failuresBefore: number[], posted: LatLng[]): SimulatorState {
  let s = initial;
  let step = 0;
  let guard = 0;
  while (guard++ < 10_000) {
    const p = currentPoint(s);
    if (p === null) break;
    const fails = failuresBefore[step % Math.max(failuresBefore.length, 1)] ?? 0;
    for (let i = 0; i < fails; i++) s = recordPostResult(s, false); // failed post: same point retried
    posted.push(p);
    s = recordPostResult(s, true);
    s = advance(s);
    step++;
  }
  return s;
}

describe("Property 27: pause and resume", () => {
  it("posted points before pause + after resume equal the Path exactly, in order", () => {
    fc.assert(
      fc.property(
        pathArb,
        fc.nat(),
        fc.array(fc.integer({ min: 0, max: 2 }), { maxLength: 5 }),
        fc.integer({ min: 1, max: 5 }),
        (path, pauseSeed, failures, extraTicks) => {
          const pauseAt = pauseSeed % (path.length + 1);
          const before: LatLng[] = [];
          const after: LatLng[] = [];

          let s = start(initialSimulatorState, "trip", path);
          for (let i = 0; i < pauseAt; i++) {
            const p = currentPoint(s);
            if (p) before.push(p);
            s = advance(recordPostResult(s, true));
          }

          s = pause(s);
          expect(s.state).toBe("paused");
          // While paused nothing is posted and the position is kept.
          for (let i = 0; i < extraTicks; i++) {
            expect(currentPoint(s)).toBeNull();
            s = advance(s);
          }
          expect(s.index).toBe(pauseAt);

          s = resume(s);
          expect(s.state).toBe("running");
          drain(s, failures, after);

          expect([...before, ...after]).toEqual(path);
        },
      ),
      { numRuns: 100 },
    );
  });
});
