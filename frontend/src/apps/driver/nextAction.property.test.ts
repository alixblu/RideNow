// Feature: frontend-booking-and-password-login, Property 25: The driver's next-action button maps each trip status to the documented action
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { driverNextAction } from "./nextAction";
import { TRIP_STATUS_VALUES } from "../../shared/enums";

const EXPECTED = {
  DRIVER_ASSIGNED: { action: "arrive", label: "I have arrived" },
  DRIVER_ARRIVED: { action: "start", label: "Start trip" },
  IN_PROGRESS: { action: "complete", label: "Complete trip" },
} as const;

describe("Property 25: driver next-action mapping", () => {
  /** **Validates: Requirements 10.7** */
  it("maps every trip status to the documented action, or null", () => {
    fc.assert(
      fc.property(fc.constantFrom(...TRIP_STATUS_VALUES), (status) => {
        const result = driverNextAction(status);
        const expected = (EXPECTED as Record<string, unknown>)[status];
        if (expected) {
          expect(result).toEqual(expected);
        } else {
          expect(result).toBeNull();
        }
      }),
      { numRuns: 100 },
    );
  });
});
