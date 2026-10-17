import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { createUserMockClient } from "./mockClient";
import type { CreateUserRequest, UserResponse } from "./contract";

/**
 * Property 11: Mock responses conform to the shared contract (user domain).
 *
 * Validates: Requirements 4.4, 4.5.
 *
 * For any valid createUser input, the value returned by the user Mock_Client
 * satisfies the same `UserResponse` shape a future Live_Client would return, so a
 * screen rendered from mock data is indistinguishable from one rendered from live
 * data. Concretely the response must:
 *   - carry a non-empty string id,
 *   - echo cognitoSub / email / fullName from the request,
 *   - expose phone and avatarUrl as string|null (null exactly when omitted),
 *   - have status within the ACTIVE | SUSPENDED set (ACTIVE on create), and
 *   - carry ISO-8601 string timestamps (createdAt, updatedAt).
 * The same conformance must also hold for the record read back via
 * getUser(created.id), which must additionally round-trip the id.
 *
 * A fresh createUserMockClient() is used per run so each client's in-memory store
 * is isolated and deterministic.
 *
 * Tag: Feature: ridenow-frontend, Property 11: Mock responses conform to the shared contract
 */

// Allowed user status values (user-owned enum; mirrors user-service UserStatus).
const USER_STATUS_VALUES = ["ACTIVE", "SUSPENDED"] as const;

/**
 * Runtime conformance helper: asserts (returning a boolean) that an arbitrary value
 * satisfies the `UserResponse` contract shape and field constraints. Kept pure so it
 * can be reused for both the createUser result and the getUser read-back.
 */
function conformsToUserResponse(value: unknown): value is UserResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const u = value as Record<string, unknown>;

  const nonEmptyString = (x: unknown): x is string =>
    typeof x === "string" && x.length > 0;
  const stringOrNull = (x: unknown): x is string | null =>
    x === null || typeof x === "string";
  // Instant serialized as ISO-8601 — Date must parse it and re-serialize identically.
  const isoTimestamp = (x: unknown): x is string => {
    if (typeof x !== "string" || x.length === 0) {
      return false;
    }
    const parsed = Date.parse(x);
    return Number.isFinite(parsed) && new Date(parsed).toISOString() === x;
  };

  return (
    nonEmptyString(u.id) &&
    typeof u.cognitoSub === "string" &&
    typeof u.email === "string" &&
    typeof u.fullName === "string" &&
    stringOrNull(u.phone) &&
    stringOrNull(u.avatarUrl) &&
    typeof u.status === "string" &&
    (USER_STATUS_VALUES as readonly string[]).includes(u.status) &&
    isoTimestamp(u.createdAt) &&
    isoTimestamp(u.updatedAt)
  );
}

// A valid createUser input generator:
//   - cognitoSub / email / fullName are non-empty strings (required @NotBlank fields),
//   - phone / avatarUrl are optional: sometimes a string, sometimes omitted entirely
//     (fc.option with nil:undefined drops the key semantics via the spread below).
const optionalString = fc.option(fc.string({ minLength: 1 }), { nil: undefined });

const createUserRequest: fc.Arbitrary<CreateUserRequest> = fc
  .record({
    cognitoSub: fc.string({ minLength: 1 }),
    email: fc.string({ minLength: 1 }),
    fullName: fc.string({ minLength: 1 }),
    phone: optionalString,
    avatarUrl: optionalString,
  })
  .map((r) => {
    // Omit optional keys entirely when undefined so we exercise the "omitted" path
    // (mock must then default phone/avatarUrl to null).
    const req: CreateUserRequest = {
      cognitoSub: r.cognitoSub,
      email: r.email,
      fullName: r.fullName,
    };
    if (r.phone !== undefined) req.phone = r.phone;
    if (r.avatarUrl !== undefined) req.avatarUrl = r.avatarUrl;
    return req;
  });

describe("Feature: ridenow-frontend, Property 11: Mock responses conform to the shared contract", () => {
  it("createUser returns a contract-conforming UserResponse, and getUser round-trips it", async () => {
    await fc.assert(
      fc.asyncProperty(createUserRequest, async (req) => {
        // Fresh client per run → isolated store.
        const client = createUserMockClient();

        const created = await client.createUser(req);

        // Shape/field conformance of the create result.
        expect(conformsToUserResponse(created)).toBe(true);

        // Field-level contract guarantees on create.
        expect(created.cognitoSub).toBe(req.cognitoSub);
        expect(created.email).toBe(req.email);
        expect(created.fullName).toBe(req.fullName);
        expect(created.phone).toBe(req.phone ?? null);
        expect(created.avatarUrl).toBe(req.avatarUrl ?? null);
        expect(created.status).toBe("ACTIVE");

        // getUser read-back conforms and round-trips the id.
        const readBack = await client.getUser(created.id);
        expect(conformsToUserResponse(readBack)).toBe(true);
        expect(readBack.id).toBe(created.id);
        expect(readBack).toEqual(created);
      }),
      { numRuns: 100 },
    );
  });
});
