import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { createDriverMockClient } from "./mockClient";
import type { CreateDriverRequest, DriverResponse } from "./contract";
import { DRIVER_STATUS_VALUES } from "../../shared/enums";

/**
 * Property 11: Mock responses conform to the shared contract (driver domain).
 *
 * Validates: Requirements 4.4, 4.5.
 *
 * Tag: Feature: ridenow-frontend, Property 11: Mock responses conform to the shared contract
 *
 * For any valid CreateDriverRequest, the Driver Mock_Client returns objects that
 * satisfy the exact `DriverResponse` shape the Live_Client would return, so a
 * mock-backed screen renders identically (no mock marker). This test asserts the
 * runtime shape rather than relying on the compile-time type: every key is present
 * with the right JS type, `status` is one of the allowed enum values, `averageRating`
 * is a number or null, timestamps are parseable ISO-8601 strings, and the server-owned
 * defaults on create (ACTIVE, totalTrips 0) hold. The same conformance check is applied
 * to the results of `getDriver` and `changeStatus` so every surface stays in contract.
 */

// A non-empty user identifier (UUID-ish length cap, but any non-empty string works).
const userId = fc.string({ minLength: 1, maxLength: 36 });

// A non-empty license number.
const licenseNumber = fc.string({ minLength: 1, maxLength: 32 });

const createDriverRequest: fc.Arbitrary<CreateDriverRequest> = fc.record({
  userId,
  licenseNumber,
});

const DRIVER_STATUS_SET = new Set<string>(DRIVER_STATUS_VALUES);

/**
 * Runtime conformance helper: asserts the given value has exactly the key/type
 * shape of a `DriverResponse`. Throws (via expect) on any deviation. Returns the
 * value narrowed to `DriverResponse` for convenient further assertions.
 */
function assertConformsToDriverResponse(value: unknown): DriverResponse {
  // Must be a non-null object.
  expect(value).toBeTypeOf("object");
  expect(value).not.toBeNull();
  const d = value as Record<string, unknown>;

  // id: non-empty string.
  expect(typeof d.id).toBe("string");
  expect((d.id as string).length).toBeGreaterThan(0);

  // userId: non-empty string.
  expect(typeof d.userId).toBe("string");
  expect((d.userId as string).length).toBeGreaterThan(0);

  // licenseNumber: non-empty string.
  expect(typeof d.licenseNumber).toBe("string");
  expect((d.licenseNumber as string).length).toBeGreaterThan(0);

  // status: one of the allowed DriverStatus values.
  expect(typeof d.status).toBe("string");
  expect(DRIVER_STATUS_SET.has(d.status as string)).toBe(true);

  // averageRating: number or null.
  const ratingOk =
    d.averageRating === null || typeof d.averageRating === "number";
  expect(ratingOk).toBe(true);

  // totalTrips: a number.
  expect(typeof d.totalTrips).toBe("number");

  // createdAt / updatedAt: ISO-8601 strings parseable via Date (not NaN).
  for (const key of ["createdAt", "updatedAt"] as const) {
    expect(typeof d[key]).toBe("string");
    const parsed = Date.parse(d[key] as string);
    expect(Number.isNaN(parsed)).toBe(false);
  }

  return value as DriverResponse;
}

describe("Feature: ridenow-frontend, Property 11: Mock responses conform to the shared contract", () => {
  it("returns DriverResponse objects that conform across create, get, and changeStatus", async () => {
    await fc.assert(
      fc.asyncProperty(createDriverRequest, async (req) => {
        // Fresh client per run keeps each in-memory store isolated and deterministic.
        const client = createDriverMockClient();

        // --- createDriver -------------------------------------------------
        const created = await client.createDriver(req);
        assertConformsToDriverResponse(created);

        // Request facts are echoed back exactly.
        expect(created.userId).toBe(req.userId);
        expect(created.licenseNumber).toBe(req.licenseNumber);

        // Server-owned defaults on create.
        expect(created.status).toBe("ACTIVE");
        expect(created.totalTrips).toBe(0);

        // --- getDriver ----------------------------------------------------
        const fetched = await client.getDriver(created.id);
        assertConformsToDriverResponse(fetched);
        expect(fetched.id).toBe(created.id);

        // --- changeStatus -------------------------------------------------
        const suspended = await client.changeStatus(created.id, "SUSPENDED");
        assertConformsToDriverResponse(suspended);
        expect(suspended.status).toBe("SUSPENDED");
        expect(suspended.id).toBe(created.id);
      }),
      { numRuns: 100 },
    );
  });
});
