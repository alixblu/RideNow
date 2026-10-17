import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { createTripMockClient } from "./mockClient";
import { VEHICLE_TYPE_VALUES } from "../../shared/enums";
import type { CreateTripRequest } from "./contract";

/**
 * Property 15: Trip read-back round-trip.
 *
 * Validates: Requirements 9.3.
 *
 * For any trip created through the trip Service_Client via requestTrip(req),
 * reading that trip back with getTrip(createdTrip.id) returns a trip with the
 * same id, the same pickup/destination coordinates, and the same ride type as
 * the created trip. A fresh createTripMockClient() is used per run so each
 * client's in-memory store is isolated and deterministic.
 *
 * Tag: Feature: ridenow-frontend, Property 15: Trip read-back round-trip
 */

// A valid CreateTripRequest generator:
//   - rideType restricted to the allowed Vehicle_Type literals (MOTORBIKE | CAR)
//   - finite coordinate numbers (no NaN/Infinity) so equality is meaningful
//   - a non-empty passengerId string
const finiteCoordinate = fc.double({ noNaN: true, noDefaultInfinity: true });

const createTripRequest: fc.Arbitrary<CreateTripRequest> = fc.record({
  passengerId: fc.string({ minLength: 1 }),
  rideType: fc.constantFrom(...VEHICLE_TYPE_VALUES),
  pickupLat: finiteCoordinate,
  pickupLng: finiteCoordinate,
  destinationLat: finiteCoordinate,
  destinationLng: finiteCoordinate,
});

describe("Feature: ridenow-frontend, Property 15: Trip read-back round-trip", () => {
  it("getTrip(createdTrip.id) echoes the id, coordinates, and ride type of the created trip", async () => {
    await fc.assert(
      fc.asyncProperty(createTripRequest, async (req) => {
        // Fresh client per run → isolated store.
        const client = createTripMockClient();

        const created = await client.requestTrip(req);
        const readBack = await client.getTrip(created.id);

        // Deep equality on the relevant fields between request result and read-back.
        expect({
          id: readBack.id,
          pickupLat: readBack.pickupLat,
          pickupLng: readBack.pickupLng,
          destinationLat: readBack.destinationLat,
          destinationLng: readBack.destinationLng,
          rideType: readBack.rideType,
        }).toEqual({
          id: created.id,
          pickupLat: created.pickupLat,
          pickupLng: created.pickupLng,
          destinationLat: created.destinationLat,
          destinationLng: created.destinationLng,
          rideType: created.rideType,
        });
      }),
      { numRuns: 100 },
    );
  });
});
