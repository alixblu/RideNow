import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { createTripMockClient } from "./mockClient";
import { VEHICLE_TYPE_VALUES } from "../../shared/enums";
import type { CreateTripRequest } from "./contract";

/**
 * Property 16: Cancelling an eligible trip yields CANCELLED.
 *
 * Validates: Requirements 9.4.
 *
 * A freshly requested trip is in a cancellation-eligible state (SEARCHING). For any
 * such trip, cancelTrip(trip.id) resolves to the same trip id with status CANCELLED,
 * and the stored state is updated so a subsequent getTrip(id) also reflects CANCELLED.
 *
 * Tag: Feature: ridenow-frontend, Property 16: Cancelling an eligible trip yields CANCELLED
 */

// A generator for a valid CreateTripRequest: a passenger id, an allowed ride type,
// and finite pickup/destination coordinates within plausible lat/lng ranges.
const createTripRequest: fc.Arbitrary<CreateTripRequest> = fc.record({
  passengerId: fc.uuid(),
  rideType: fc.constantFrom(...VEHICLE_TYPE_VALUES),
  pickupLat: fc.double({ min: -90, max: 90, noNaN: true }),
  pickupLng: fc.double({ min: -180, max: 180, noNaN: true }),
  destinationLat: fc.double({ min: -90, max: 90, noNaN: true }),
  destinationLng: fc.double({ min: -180, max: 180, noNaN: true }),
});

describe("Feature: ridenow-frontend, Property 16: Cancelling an eligible trip yields CANCELLED", () => {
  it("cancelling a freshly REQUESTED trip returns the same trip with status CANCELLED", async () => {
    await fc.assert(
      fc.asyncProperty(createTripRequest, async (req) => {
        // Fresh, isolated client per run so stores never bleed between iterations.
        const client = createTripMockClient();

        const created = await client.requestTrip(req);
        // Precondition: a new trip is in the cancellation-eligible SEARCHING state.
        expect(created.status).toBe("SEARCHING");

        const cancelled = await client.cancelTrip(created.id);

        // cancelTrip yields the same trip id with status CANCELLED.
        expect(cancelled.id).toBe(created.id);
        expect(cancelled.status).toBe("CANCELLED");

        // The stored state is updated: a read-back after cancel reflects CANCELLED.
        const readBack = await client.getTrip(created.id);
        expect(readBack.id).toBe(created.id);
        expect(readBack.status).toBe("CANCELLED");
      }),
      { numRuns: 100 },
    );
  });
});
