// Feature: production-grade-frontend, Property 9: Trip status view model
// **Validates: Requirements 4.5, 4.6, 4.7, 5.6**
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { tripView } from "./tripView";
import { TRIP_STATUS_VALUES, type TripStatus } from "../../shared/enums";

const statusArb = fc.constantFrom<TripStatus>(...TRIP_STATUS_VALUES);

const ACTIVE: TripStatus[] = ["DRIVER_ASSIGNED", "DRIVER_ARRIVED", "IN_PROGRESS"];
const CANCELLABLE: TripStatus[] = ["SEARCHING", "DRIVER_ASSIGNED", "DRIVER_ARRIVED"];
const NEXT: Partial<Record<TripStatus, "arrive" | "start" | "complete">> = {
  DRIVER_ASSIGNED: "arrive",
  DRIVER_ARRIVED: "start",
  IN_PROGRESS: "complete",
};

describe("Property 9: Trip status view model", () => {
  it("maps every status to the expected flags and driver action", () => {
    fc.assert(
      fc.property(statusArb, (status) => {
        const v = tripView(status);
        expect(v.showDriverCard).toBe(ACTIVE.includes(status));
        expect(v.showDriverMarker).toBe(ACTIVE.includes(status));
        expect(v.showCancel).toBe(CANCELLABLE.includes(status));
        expect(v.showSummary).toBe(status === "COMPLETED");
        expect(v.driverNextAction).toBe(NEXT[status] ?? null);
      }),
      { numRuns: 100 },
    );
  });
});
