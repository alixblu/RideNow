import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { findResumableTrip, isCancelVisible } from "./tripView";
import { TRIP_STATUS_VALUES } from "../../shared/enums";
import type { TripResponse } from "../../domain/trip/contract";

const TERMINAL = ["COMPLETED", "CANCELLED"] as const;
const NON_TERMINAL = TRIP_STATUS_VALUES.filter((s) => s !== "COMPLETED" && s !== "CANCELLED");

const trip = (id: string, status: string) => ({ id, status }) as unknown as TripResponse;

describe("resume and cancel visibility properties", () => {
  // Feature: frontend-booking-and-password-login, Property 19: Exactly one non-terminal trip, if any, is resumed
  it("Property 19: returns the single non-terminal trip, or null", () => {
    /** **Validates: Requirements 6.10** */
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...TERMINAL), { maxLength: 10 }),
        fc.option(fc.constantFrom(...NON_TERMINAL), { nil: undefined }),
        fc.nat(10),
        (terminals, active, pos) => {
          const trips = terminals.map((s, i) => trip(`t${i}`, s));
          if (active !== undefined) {
            trips.splice(Math.min(pos, trips.length), 0, trip("active", active));
          }
          const result = findResumableTrip(trips);
          if (active === undefined) expect(result).toBeNull();
          else expect(result?.id).toBe("active");
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: frontend-booking-and-password-login, Property 20: The cancel control is visible exactly for the three cancellable statuses
  it("Property 20: cancel visible iff SEARCHING, DRIVER_ASSIGNED or DRIVER_ARRIVED", () => {
    /** **Validates: Requirements 7.5** */
    fc.assert(
      fc.property(fc.constantFrom(...TRIP_STATUS_VALUES), (status) => {
        expect(isCancelVisible(status)).toBe(
          status === "SEARCHING" || status === "DRIVER_ASSIGNED" || status === "DRIVER_ARRIVED",
        );
      }),
      { numRuns: 100 },
    );
  });
});
