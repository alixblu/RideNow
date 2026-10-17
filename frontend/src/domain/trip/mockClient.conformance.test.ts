import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { createTripMockClient } from "./mockClient";
import type { CreateTripRequest, TripResponse } from "./contract";
import { TRIP_STATUS_VALUES, VEHICLE_TYPE_VALUES } from "../../shared/enums";

/**
 * Property 11: Mock responses conform to the shared contract (trip domain).
 *
 * Validates: Requirements 4.4, 4.5.
 *
 * Tag: Feature: ridenow-frontend, Property 11: Mock responses conform to the shared contract
 *
 * For any valid CreateTripRequest, every TripResponse the Mock_Client hands back —
 * from requestTrip, from a getTrip read-back, and from cancelTrip — conforms to the
 * full documented contract shape: every field is present with the correct type, the
 * nullable fields are "right type or null", status is a valid Trip_Status, the
 * coordinates/fares are numbers, and the timestamps are ISO-8601 strings. A fresh
 * createTripMockClient() is used per run so each assertion is isolated and
 * deterministic.
 */

// A valid ride type: one of the two allowed Vehicle_Type values.
const rideType = fc.constantFrom(...VEHICLE_TYPE_VALUES);

// Coordinate generator: finite numbers within plausible lat/lng ranges.
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

/** True when `value` is an ISO-8601 string that round-trips through Date. */
function isIsoTimestamp(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }
  const parsed = Date.parse(value);
  return !Number.isNaN(parsed) && new Date(parsed).toISOString() === value;
}

/**
 * Runtime conformance check: asserts `value` has exactly the documented
 * TripResponse keys, each with the correct type (and nullable fields typed as
 * "that type or null"). Throws via expect on the first violation.
 */
function assertConformsToContract(value: unknown): asserts value is TripResponse {
  // Must be a plain, non-null object.
  expect(typeof value).toBe("object");
  expect(value).not.toBeNull();
  const trip = value as Record<string, unknown>;

  // Exactly the documented keys — no missing and no extra fields.
  const expectedKeys = [
    "id",
    "passengerId",
    "driverId",
    "vehicleId",
    "rideType",
    "status",
    "pickupLat",
    "pickupLng",
    "destinationLat",
    "destinationLng",
    "estimatedFare",
    "finalFare",
    "cancellationReason",
    "requestedAt",
    "createdAt",
    "updatedAt",
  ].sort();
  expect(Object.keys(trip).sort()).toEqual(expectedKeys);

  // Required strings.
  expect(typeof trip.id).toBe("string");
  expect(typeof trip.passengerId).toBe("string");

  // Cross-service ids: string or null.
  expect(trip.driverId === null || typeof trip.driverId === "string").toBe(true);
  expect(trip.vehicleId === null || typeof trip.vehicleId === "string").toBe(true);

  // Ride type is a valid Vehicle_Type.
  expect((VEHICLE_TYPE_VALUES as readonly string[]).includes(trip.rideType as string)).toBe(true);

  // Status is a valid Trip_Status.
  expect((TRIP_STATUS_VALUES as readonly string[]).includes(trip.status as string)).toBe(true);

  // Coordinates are finite numbers.
  for (const coord of ["pickupLat", "pickupLng", "destinationLat", "destinationLng"]) {
    expect(typeof trip[coord]).toBe("number");
    expect(Number.isFinite(trip[coord] as number)).toBe(true);
  }

  // Fares: number or null.
  expect(trip.estimatedFare === null || typeof trip.estimatedFare === "number").toBe(true);
  expect(trip.finalFare === null || typeof trip.finalFare === "number").toBe(true);

  // Cancellation reason: string or null.
  expect(
    trip.cancellationReason === null || typeof trip.cancellationReason === "string",
  ).toBe(true);

  // Timestamps are ISO-8601 strings.
  expect(isIsoTimestamp(trip.requestedAt)).toBe(true);
  expect(isIsoTimestamp(trip.createdAt)).toBe(true);
  expect(isIsoTimestamp(trip.updatedAt)).toBe(true);
}

describe("Feature: ridenow-frontend, Property 11: Mock responses conform to the shared contract", () => {
  it("returns contract-conforming responses from requestTrip, getTrip, and cancelTrip", async () => {
    await fc.assert(
      fc.asyncProperty(createTripRequest, async (req) => {
        // Fresh client per run keeps each resolved store isolated.
        const client = createTripMockClient();

        // requestTrip result conforms.
        const requested = await client.requestTrip(req);
        assertConformsToContract(requested);

        // getTrip read-back conforms.
        const fetched = await client.getTrip(requested.id);
        assertConformsToContract(fetched);

        // cancelTrip result conforms.
        const cancelled = await client.cancelTrip(requested.id);
        assertConformsToContract(cancelled);
      }),
      { numRuns: 100 },
    );
  });
});
