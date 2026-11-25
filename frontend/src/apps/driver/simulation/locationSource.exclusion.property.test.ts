import { describe, it, expect, vi, afterEach } from "vitest";
import fc from "fast-check";
import { renderHook } from "@testing-library/react";
import { selectLocationSource } from "./locationSource";
import { useLocationSender, type LocationSource } from "../useLocationSender";
import type { SimState } from "./simulationMachine";

afterEach(() => {
  vi.useRealTimers();
});

// Feature: frontend-booking-and-password-login, Property 26: GPS and Simulator location posting are mutually exclusive
describe("Property 26: location source exclusion", () => {
  /** **Validates: Requirements 10.9** */
  it("selects simulate for running/paused and gps for stopped", () => {
    fc.assert(
      fc.property(fc.constantFrom<SimState>("stopped", "running", "paused"), (state) => {
        expect(selectLocationSource(state)).toBe(state === "stopped" ? "gps" : "simulate");
      }),
      { numRuns: 100 },
    );
  });

  /** **Validates: Requirements 10.9** */
  it("at most one of GPS watch / simulator loop is active across state transitions, and GPS posts nothing while simulating", () => {
    const states = fc.array(fc.constantFrom<SimState>("stopped", "running", "paused"), {
      minLength: 1,
      maxLength: 8,
    });
    fc.assert(
      fc.property(states, fc.boolean(), (sequence, online) => {
        vi.useFakeTimers();
        const active = new Set<number>();
        let nextId = 1;
        const geolocation = {
          watchPosition: vi.fn((ok: PositionCallback) => {
            const id = nextId++;
            active.add(id);
            ok({ coords: { latitude: 1, longitude: 2 } } as GeolocationPosition);
            return id;
          }),
          clearWatch: vi.fn((id: number) => {
            active.delete(id);
          }),
        } as unknown as Geolocation;
        const gpsPoint = { lat: 1, lng: 2 };
        const simPoint = { lat: 50, lng: 60 };
        const route = [simPoint];
        const send = vi.fn();

        const props = (s: SimState) => ({
          online,
          source: selectLocationSource(s) as LocationSource,
          route,
          send,
          intervalMs: 1000,
          geolocation,
        });
        const { rerender, unmount } = renderHook((p) => useLocationSender(p), {
          initialProps: props(sequence[0]!),
        });

        for (const s of sequence) {
          rerender(props(s));
          send.mockClear();
          vi.advanceTimersByTime(1000);
          const simulating = s !== "stopped";
          if (simulating) {
            expect(active.size).toBe(0);
            for (const call of send.mock.calls) {
              expect(call[0]).toEqual(simPoint);
            }
          } else {
            expect(active.size).toBe(online ? 1 : 0);
            for (const call of send.mock.calls) {
              expect(call[0]).toEqual(gpsPoint);
            }
          }
        }
        unmount();
        expect(active.size).toBe(0);
        vi.useRealTimers();
      }),
      { numRuns: 100 },
    );
  });
});
