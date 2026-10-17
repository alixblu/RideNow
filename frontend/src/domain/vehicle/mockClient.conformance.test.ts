import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { createVehicleMockClient } from "./mockClient";
import type { CreateVehicleRequest, VehicleResponse } from "./contract";
import { VEHICLE_TYPE_VALUES, isVehicleType } from "../../shared/enums";

/**
 * Property 11: Mock responses conform to the shared contract (vehicle domain).
 *
 * Validates: Requirements 4.4, 4.5.
 *
 * Tag: Feature: ridenow-frontend, Property 11: Mock responses conform to the shared contract
 *
 * For any valid `addVehicle` input, the `VehicleResponse` returned by the
 * Mock_Client must satisfy the exact same shape a Live_Client would return, so a
 * mock-backed screen renders identically and carries no mock marker (Req 4.4, 4.5):
 *   - `id` is a non-empty string,
 *   - `driverId` echoes the supplied driver id,
 *   - `plateNumber` echoes the submitted plate number,
 *   - `vehicleType` is one of the allowed Vehicle_Type values,
 *   - `brand` / `model` / `color` are each `string | null` (and `null` precisely
 *     when the optional request field was omitted),
 *   - `active` is a boolean (and `true` on create),
 *   - `createdAt` / `updatedAt` are ISO-8601 strings.
 *
 * The same conformance helper is reused to check every element of
 * `listVehicles(driverId)` and the single vehicle fetched via `getVehicle(id)`.
 * A fresh `createVehicleMockClient()` is created per run so each store is isolated
 * and deterministic.
 */

// ---------------------------------------------------------------------------
// Runtime conformance helper.
// ---------------------------------------------------------------------------

/** True when `value` is a non-empty string. */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** True when `value` is either a string or explicit `null` (never `undefined`). */
function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

/**
 * True when `value` parses as an ISO-8601 instant and round-trips back to the same
 * string — the shape Jackson produces for an `Instant` (e.g. `2024-01-01T00:00:00.000Z`).
 */
function isIso8601String(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) {
    return false;
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return false;
  }
  return new Date(parsed).toISOString() === value;
}

/**
 * Assert a value conforms to the `VehicleResponse` contract. Returns the value
 * narrowed to `VehicleResponse` so callers can make further field assertions.
 */
function assertConformsToVehicleResponse(value: unknown): VehicleResponse {
  expect(value).toBeTypeOf("object");
  expect(value).not.toBeNull();

  const v = value as Record<string, unknown>;

  expect(isNonEmptyString(v.id)).toBe(true);
  expect(isNonEmptyString(v.driverId)).toBe(true);
  expect(isNonEmptyString(v.plateNumber)).toBe(true);
  expect(isVehicleType(v.vehicleType)).toBe(true);
  expect(isStringOrNull(v.brand)).toBe(true);
  expect(isStringOrNull(v.model)).toBe(true);
  expect(isStringOrNull(v.color)).toBe(true);
  expect(typeof v.active).toBe("boolean");
  expect(isIso8601String(v.createdAt)).toBe(true);
  expect(isIso8601String(v.updatedAt)).toBe(true);

  return value as VehicleResponse;
}

// ---------------------------------------------------------------------------
// Generators.
// ---------------------------------------------------------------------------

// A non-empty driver identifier (scalar id stored on the vehicle).
const driverId = fc.string({ minLength: 1, maxLength: 36 });

// A non-empty plate number.
const plateNumber = fc.string({ minLength: 1, maxLength: 16 });

// Vehicle_Type from the allowed set.
const vehicleType = fc.constantFrom(...VEHICLE_TYPE_VALUES);

// Optional descriptive fields: sometimes omitted, sometimes a string. Each resolves
// to either a single-key object (the field present) or an empty object (the field
// absent). Spreading these into the request OMITS the key entirely when absent,
// which is what `exactOptionalPropertyTypes` requires: an optional `brand?: string`
// may be missing, but if present it must be a `string` — never `undefined`.
const optionalBrand = fc.option(fc.string({ maxLength: 24 }), { nil: undefined }).map(
  (value): Partial<Pick<CreateVehicleRequest, "brand">> =>
    value === undefined ? {} : { brand: value },
);
const optionalModel = fc.option(fc.string({ maxLength: 24 }), { nil: undefined }).map(
  (value): Partial<Pick<CreateVehicleRequest, "model">> =>
    value === undefined ? {} : { model: value },
);
const optionalColor = fc.option(fc.string({ maxLength: 24 }), { nil: undefined }).map(
  (value): Partial<Pick<CreateVehicleRequest, "color">> =>
    value === undefined ? {} : { color: value },
);

const createVehicleRequest: fc.Arbitrary<CreateVehicleRequest> = fc
  .record({
    plateNumber,
    vehicleType,
    brand: optionalBrand,
    model: optionalModel,
    color: optionalColor,
  })
  .map(
    ({ plateNumber: plate, vehicleType: type, brand, model, color }): CreateVehicleRequest => ({
      plateNumber: plate,
      vehicleType: type,
      ...brand,
      ...model,
      ...color,
    }),
  );

describe("Feature: ridenow-frontend, Property 11: Mock responses conform to the shared contract", () => {
  it("addVehicle returns a VehicleResponse conforming to the shared contract", async () => {
    await fc.assert(
      fc.asyncProperty(
        driverId,
        createVehicleRequest,
        async (dId, req) => {
          // Fresh client per run keeps each store isolated.
          const client = createVehicleMockClient();

          const created = await client.addVehicle(dId, req);

          // Shape conformance.
          const vehicle = assertConformsToVehicleResponse(created);

          // Echoed and server-owned facts.
          expect(vehicle.driverId).toBe(dId);
          expect(vehicle.plateNumber).toBe(req.plateNumber);
          expect(vehicle.vehicleType).toBe(req.vehicleType);
          expect(vehicle.active).toBe(true);

          // Optional fields are null exactly when omitted, else echo the string.
          expect(vehicle.brand).toBe(req.brand ?? null);
          expect(vehicle.model).toBe(req.model ?? null);
          expect(vehicle.color).toBe(req.color ?? null);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("listVehicles(driverId) returns elements that each conform to the contract", async () => {
    await fc.assert(
      fc.asyncProperty(
        driverId,
        fc.array(createVehicleRequest, { minLength: 1, maxLength: 5 }),
        async (dId, reqs) => {
          const client = createVehicleMockClient();

          for (const req of reqs) {
            await client.addVehicle(dId, req);
          }

          const vehicles = await client.listVehicles(dId);

          // All added vehicles belong to this driver and are returned.
          expect(vehicles.length).toBe(reqs.length);
          for (const vehicle of vehicles) {
            const conformed = assertConformsToVehicleResponse(vehicle);
            expect(conformed.driverId).toBe(dId);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("getVehicle(created.id) returns a VehicleResponse conforming to the contract", async () => {
    await fc.assert(
      fc.asyncProperty(
        driverId,
        createVehicleRequest,
        async (dId, req) => {
          const client = createVehicleMockClient();

          const created = await client.addVehicle(dId, req);
          const fetched = await client.getVehicle(created.id);

          const vehicle = assertConformsToVehicleResponse(fetched);

          // The fetched vehicle is the one just created.
          expect(vehicle.id).toBe(created.id);
          expect(vehicle.driverId).toBe(dId);
          expect(vehicle.plateNumber).toBe(req.plateNumber);
          expect(vehicle.vehicleType).toBe(req.vehicleType);
        },
      ),
      { numRuns: 100 },
    );
  });
});
