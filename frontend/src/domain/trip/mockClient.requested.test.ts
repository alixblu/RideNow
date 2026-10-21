import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { createTripMockClient } from "./mockClient";
import type { CreateTripRequest } from "./contract";
import { VEHICLE_TYPE_VALUES } from "../../shared/enums";

/**
 * Property 13: New trip starts SEARCHING and echoes its request.
 *
 * Validates: Requirements 9.1.
 *
 * Tag: Feature: ridenow-frontend, Property 13: New trip starts SEARCHING and echoes its request
 *
 * For any valid CreateTripRequest, `requestTrip` returns a trip that starts with
 * Trip_Status SEARCHING (the trip-service immediately begins matching) and echoes the
 * submitted pickup/destination coordinates, ride type, and passenger id exactly. A
 * fresh Mock_Client is created per run so each assertion is isolated and deterministic.
 */

// A valid ride type: one of the two allowed Vehicle_Type values.
const rideType = fc.constantFrom(...VEHICLE_TYPE_VALUES);

// Coordinate generator: finite numbers within plausible lat/lng ranges.
// noNaN/noDefaultInfinity keep values finite so echo comparisons are exact.
const coordinate = fc.double({
  min: -180,
  max: 180,
  noNaN: true,
  noDefaultInfinity: true,
});

// A non-empty passenger identifier.
const passengerId = fc.string({ minLength: 1, maxLength: 36 });

const createTripRequest: fc.Arbitrary<CreateTripRequest> = fc.record({
  passengerId,
  rideType,
  pickupLat: coordinate,
  pickupLng: coordinate,
  destinationLat: coordinate,
  destinationLng: coordinate,
});

describe("Feature: ridenow-frontend, Property 13: New trip starts SEARCHING and echoes its request", () => {
  it("returns a SEARCHING trip that echoes the submitted request exactly", async () => {
    await fc.assert(
      fc.asyncProperty(createTripRequest, async (req) => {
        // Fresh client per run keeps each resolved store isolated.
        const client = createTripMockClient();

        const trip = await client.requestTrip(req);

        // A new trip always starts SEARCHING (Req 9.1).
        expect(trip.status).toBe("SEARCHING");

        // The submitted facts are echoed back unchanged.
        expect(trip.passengerId).toBe(req.passengerId);
        expect(trip.rideType).toBe(req.rideType);
        expect(trip.pickupLat).toBe(req.pickupLat);
        expect(trip.pickupLng).toBe(req.pickupLng);
        expect(trip.destinationLat).toBe(req.destinationLat);
        expect(trip.destinationLng).toBe(req.destinationLng);

        // No driver/vehicle assigned at request time.
        expect(trip.driverId).toBeNull();
        expect(trip.vehicleId).toBeNull();
      }),
      { numRuns: 100 },
    );
  });
});
