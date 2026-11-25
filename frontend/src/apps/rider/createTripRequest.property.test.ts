// Feature: frontend-booking-and-password-login, Property 17: The create-trip request body is a pure function of the booking state
// **Validates: Requirements 6.4**
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { buildCreateTripRequest, type BookingState } from "./tripView";
import { PAYMENT_METHOD_VALUES, VEHICLE_TYPE_VALUES } from "../../shared/enums";
import type { Place } from "../../geocoding/contract";

const placeArb: fc.Arbitrary<Place> = fc.record({
  address: fc.string({ minLength: 1 }),
  lat: fc.double({ min: -90, max: 90, noNaN: true }),
  lng: fc.double({ min: -180, max: 180, noNaN: true }),
}) as fc.Arbitrary<Place>;

const stateArb: fc.Arbitrary<BookingState> = fc.record({
  passengerId: fc.uuid(),
  pickup: placeArb,
  destination: placeArb,
  rideType: fc.constantFrom(...VEHICLE_TYPE_VALUES),
  paymentMethod: fc.constantFrom(...PAYMENT_METHOD_VALUES),
});

describe("Property 17: create-trip request body", () => {
  it("copies each booking field into the matching request field", () => {
    fc.assert(
      fc.property(stateArb, (s) => {
        expect(buildCreateTripRequest(s)).toEqual({
          passengerId: s.passengerId,
          rideType: s.rideType,
          pickupLat: s.pickup.lat,
          pickupLng: s.pickup.lng,
          pickupAddress: s.pickup.address,
          destinationLat: s.destination.lat,
          destinationLng: s.destination.lng,
          destinationAddress: s.destination.address,
          paymentMethod: s.paymentMethod,
        });
      }),
      { numRuns: 100 },
    );
  });

  it("is pure: same state gives equal bodies and the input is not mutated", () => {
    fc.assert(
      fc.property(stateArb, (s) => {
        const before = JSON.stringify(s);
        expect(buildCreateTripRequest(s)).toEqual(buildCreateTripRequest(s));
        expect(JSON.stringify(s)).toBe(before);
      }),
      { numRuns: 100 },
    );
  });
});
