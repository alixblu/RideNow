import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { createPaymentMockClient } from "./mockClient";
import type { PaymentResponse } from "./contract";
import { PAYMENT_STATUS_VALUES } from "../../shared/enums";

/**
 * Property 11: Mock responses conform to the shared contract (payment domain).
 *
 * Validates: Requirements 4.4, 4.5.
 *
 * Tag: Feature: ridenow-frontend, Property 11: Mock responses conform to the shared contract
 *
 * For any non-empty tripId, the PaymentResponse the Mock_Client returns from
 * getPaymentForTrip conforms to the full documented contract shape: exactly the
 * documented keys, each with the correct type, tripId echoes the input, amount is a
 * finite number, currency is a non-empty string, method is one of CASH /
 * SIMULATED_CARD, status is a valid Payment_Status, failureReason is a string or
 * null, and the timestamps are ISO-8601 strings. A fresh createPaymentMockClient()
 * is used per run so each assertion is isolated and deterministic.
 */

// The payment-owned method union, mirrored for runtime checking.
const PAYMENT_METHOD_VALUES = ["CASH", "SIMULATED_CARD"] as const;

// A non-empty trip identifier.
const tripIdArb = fc.string({ minLength: 1, maxLength: 64 });

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
 * PaymentResponse keys, each with the correct type (and nullable fields typed as
 * "that type or null"). Throws via expect on the first violation. `expectedTripId`
 * is the input tripId the response must echo back.
 */
function assertConformsToContract(
  value: unknown,
  expectedTripId: string,
): asserts value is PaymentResponse {
  // Must be a plain, non-null object.
  expect(typeof value).toBe("object");
  expect(value).not.toBeNull();
  const payment = value as Record<string, unknown>;

  // Exactly the documented keys — no missing and no extra fields.
  const expectedKeys = [
    "id",
    "tripId",
    "amount",
    "currency",
    "method",
    "status",
    "failureReason",
    "createdAt",
    "updatedAt",
  ].sort();
  expect(Object.keys(payment).sort()).toEqual(expectedKeys);

  // id is a non-empty string.
  expect(typeof payment.id).toBe("string");
  expect((payment.id as string).length).toBeGreaterThan(0);

  // tripId echoes the input exactly.
  expect(typeof payment.tripId).toBe("string");
  expect(payment.tripId).toBe(expectedTripId);

  // amount is a finite number.
  expect(typeof payment.amount).toBe("number");
  expect(Number.isFinite(payment.amount as number)).toBe(true);

  // currency is a non-empty string.
  expect(typeof payment.currency).toBe("string");
  expect((payment.currency as string).length).toBeGreaterThan(0);

  // method is a valid Payment_Method.
  expect(
    (PAYMENT_METHOD_VALUES as readonly string[]).includes(payment.method as string),
  ).toBe(true);

  // status is a valid Payment_Status.
  expect(
    (PAYMENT_STATUS_VALUES as readonly string[]).includes(payment.status as string),
  ).toBe(true);

  // failureReason: string or null.
  expect(
    payment.failureReason === null || typeof payment.failureReason === "string",
  ).toBe(true);

  // Timestamps are ISO-8601 strings.
  expect(isIsoTimestamp(payment.createdAt)).toBe(true);
  expect(isIsoTimestamp(payment.updatedAt)).toBe(true);
}

describe("Feature: ridenow-frontend, Property 11: Mock responses conform to the shared contract", () => {
  it("returns contract-conforming responses from getPaymentForTrip", async () => {
    await fc.assert(
      fc.asyncProperty(tripIdArb, async (tripId) => {
        // Fresh client per run keeps each run isolated.
        const client = createPaymentMockClient();

        const payment = await client.getPaymentForTrip(tripId);
        assertConformsToContract(payment, tripId);
      }),
      { numRuns: 100 },
    );
  });
});
