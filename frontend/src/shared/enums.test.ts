import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  isVehicleType,
  isDriverStatus,
  VEHICLE_TYPE_VALUES,
  DRIVER_STATUS_VALUES,
} from "./enums";

/**
 * Property 6: Only allowed enum values validate.
 *
 * Validates: Requirements 6.3, 7.1.
 *
 * A candidate string validates as a VehicleType only if it is exactly
 * "MOTORBIKE" or "CAR", and as a DriverStatus only if it is exactly "ACTIVE"
 * or "SUSPENDED". The type-guard helpers must agree with their allowed-value
 * lists for every possible string — and reject non-string inputs.
 *
 * Tag: Feature: ridenow-frontend, Property 6: Only allowed enum values validate
 */

const VEHICLE_TYPES: readonly string[] = VEHICLE_TYPE_VALUES;
const DRIVER_STATUSES: readonly string[] = DRIVER_STATUS_VALUES;

// A candidate-string generator that mixes overwhelmingly-invalid random strings
// with the valid literals (via constantFrom) so BOTH branches of each guard are
// exercised: the "accept" branch (valid literal) and the "reject" branch
// (arbitrary string). Random strings are highly unlikely to collide with a
// literal, so constantFrom guarantees positive cases appear.
const candidateString = fc.oneof(
  { weight: 5, arbitrary: fc.string() },
  {
    weight: 1,
    arbitrary: fc.constantFrom(
      ...VEHICLE_TYPE_VALUES,
      ...DRIVER_STATUS_VALUES,
    ),
  },
);

describe("Feature: ridenow-frontend, Property 6: Only allowed enum values validate", () => {
  it("isVehicleType(s) is true iff s is exactly one of the allowed VehicleType values", () => {
    fc.assert(
      fc.property(candidateString, (s) => {
        expect(isVehicleType(s)).toBe(VEHICLE_TYPES.includes(s));
      }),
      { numRuns: 200 },
    );
  });

  it("isDriverStatus(s) is true iff s is exactly one of the allowed DriverStatus values", () => {
    fc.assert(
      fc.property(candidateString, (s) => {
        expect(isDriverStatus(s)).toBe(DRIVER_STATUSES.includes(s));
      }),
      { numRuns: 200 },
    );
  });

  it("accepts every allowed literal exactly (positive branch is reachable)", () => {
    for (const v of VEHICLE_TYPE_VALUES) {
      expect(isVehicleType(v)).toBe(true);
      // A VehicleType literal is not a DriverStatus.
      expect(isDriverStatus(v)).toBe(false);
    }
    for (const s of DRIVER_STATUS_VALUES) {
      expect(isDriverStatus(s)).toBe(true);
      expect(isVehicleType(s)).toBe(false);
    }
  });

  it("rejects non-string inputs for both guards", () => {
    const nonStringInput = fc.oneof(
      fc.integer(),
      fc.double(),
      fc.boolean(),
      fc.constant(null),
      fc.constant(undefined),
      fc.object(),
      fc.array(fc.anything()),
    );

    fc.assert(
      fc.property(nonStringInput, (value) => {
        expect(isVehicleType(value)).toBe(false);
        expect(isDriverStatus(value)).toBe(false);
      }),
      { numRuns: 200 },
    );
  });
});
