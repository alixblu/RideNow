import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fc from "fast-check";
import { act, renderHook } from "@testing-library/react";
import type { Geocoder, Place } from "./contract";
import { useDebouncedGeocoder } from "./useDebouncedGeocoder";

const placeArb: fc.Arbitrary<Place> = fc.record({
  lat: fc.double({ min: -90, max: 90, noNaN: true }),
  lng: fc.double({ min: -180, max: 180, noNaN: true }),
  address: fc.string(),
});

const stepArb = fc.record({
  query: fc.string({ minLength: 0, maxLength: 12 }),
  waitMs: fc.integer({ min: 0, max: 2500 }),
});

describe("useDebouncedGeocoder", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // Feature: frontend-booking-and-password-login, Property 12: Geocoder suggestions never exceed 5 and the debounced request rate never exceeds 1 per second
  // **Validates: Requirements 5.2, 5.3**
  it("caps suggestions at 5 and starts at most one request per second", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(stepArb, { minLength: 1, maxLength: 15 }),
        fc.array(placeArb, { minLength: 0, maxLength: 12 }),
        async (steps, results) => {
          const starts: number[] = [];
          const geocoder: Geocoder = {
            search: () => {
              starts.push(Date.now());
              return Promise.resolve(results);
            },
            reverse: () => Promise.resolve(null),
          };
          const { result, unmount } = renderHook(() => useDebouncedGeocoder(geocoder));

          for (const step of steps) {
            act(() => result.current.search(step.query));
            expect(result.current.suggestions.length).toBeLessThanOrEqual(5);
            await act(async () => {
              await vi.advanceTimersByTimeAsync(step.waitMs);
            });
            expect(result.current.suggestions.length).toBeLessThanOrEqual(5);
          }
          // Let any pending throttled request fire.
          await act(async () => {
            await vi.advanceTimersByTimeAsync(5000);
          });
          expect(result.current.suggestions.length).toBeLessThanOrEqual(5);

          for (let i = 1; i < starts.length; i++) {
            expect(starts[i]! - starts[i - 1]!).toBeGreaterThanOrEqual(1000);
          }
          unmount();
        },
      ),
      { numRuns: 100 },
    );
  });
});
