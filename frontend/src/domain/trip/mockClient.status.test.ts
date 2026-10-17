import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { createTripMockClient } from "./mockClient";
import type { CreateTripRequest } from "./contract";
import { TRIP_STATUS_VALUES, VEHICLE_TYPE_VALUES } from "../../shared/enums";

/**
 * Property 14: Trip status is always within the defined set.
 *
 * Validates: Requirements 9.2.
 *
 * Every trip the trip Mock_Client produces or returns must carry a status drawn
 * from the Trip_Status set (REQUESTED, SEARCHING, DRIVER_ASSIGNED, DRIVER_ARRIVED,
 * IN_PROGRESS, COMPLETED, CANCELLED). This exercises multiple operations so the
 * returned trips come from different code paths: requestTrip mints a new trip,
 * getTrip reads it back, and cancelTrip flips its status — each returned trip's
 * status must still be one of TRIP_STATUS_VALUES.
 *
 * Tag: Feature: ridenow-frontend, Property 14: Trip status is always within the defined set
 */

const TRIP_STATUSES = TRIP_STATUS_VALUES as readonly string[];

// Generate a valid CreateTripRequest: a passenger id, a valid ride type, and
// finite pickup/destination coordinates.
const createTripRequest: fc.Arbitrary<CreateTripRequest> = fc.record({
  passengerId: fc.uuid(),
  rideType: fc.constantFrom(...VEHICLE_TYPE_VALUES),
  pickupLat: fc.double({ min: -90, max: 90, noNaN: true }),
  pickupLng: fc.double({ min: -180, max: 180, noNaN: true }),
  destinationLat: fc.double({ min: -90, max: 90, noNaN: true }),
  destinationLng: fc.double({ min: -180, max: 180, noNaN: true }),
});

describe("Feature: ridenow-frontend, Property 14: Trip status is always within the defined set", () => {
  it("every trip returned across requestTrip, getTrip, and cancelTrip has a status in TRIP_STATUS_VALUES", async () => {
    await fc.assert(
      fc.asyncProperty(createTripRequest, async (req) => {
        const client = createTripMockClient();

        // Path 1: requestTrip mints a brand-new trip.
        const requested = await client.requestTrip(req);
        expect(TRIP_STATUSES.includes(requested.status)).toBe(true);

        // Path 2: getTrip reads the stored trip back.
        const fetched = await client.getTrip(requested.id);
        expect(TRIP_STATUSES.includes(fetched.status)).toBe(true);

        // Path 3: cancelTrip flips the stored status.
        const cancelled = await client.cancelTrip(requested.id);
        expect(TRIP_STATUSES.includes(cancelled.status)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});
