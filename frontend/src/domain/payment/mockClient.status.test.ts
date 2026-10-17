import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { createPaymentMockClient } from "./mockClient";
import { PAYMENT_STATUS_VALUES } from "../../shared/enums";

/**
 * Property 18: Payment status within set, and failures carry a reason.
 *
 * Validates: Requirements 11.2, 11.3.
 *
 * Every payment the payment Mock_Client returns from getPaymentForTrip must carry a
 * status drawn from the Payment_Status set (PENDING, PROCESSING, PAID, FAILED). The
 * failureReason field is tied to the status: a FAILED payment always carries a
 * non-empty reason, and every other status carries null (Req 11.3). Because the mock
 * derives status deterministically from a hash of tripId that spreads across all four
 * values, a large set of tripIds exercises both the FAILED and non-FAILED branches.
 *
 * Tag: Feature: ridenow-frontend, Property 18: Payment status within set, and failures carry a reason
 */

const PAYMENT_STATUSES = PAYMENT_STATUS_VALUES as readonly string[];

// Non-empty tripIds (the client keys everything off the id; empty is out of scope).
const tripId: fc.Arbitrary<string> = fc.string({ minLength: 1 });

describe("Feature: ridenow-frontend, Property 18: Payment status within set, and failures carry a reason", () => {
  it("every payment's status is within PAYMENT_STATUS_VALUES and failureReason tracks FAILED", async () => {
    await fc.assert(
      fc.asyncProperty(tripId, async (id) => {
        const client = createPaymentMockClient();
        const payment = await client.getPaymentForTrip(id);

        // Status is always one of the defined Payment_Status values.
        expect(PAYMENT_STATUSES.includes(payment.status)).toBe(true);

        // FAILED carries a non-empty reason; every other status carries null.
        if (payment.status === "FAILED") {
          expect(typeof payment.failureReason).toBe("string");
          expect((payment.failureReason as string).length).toBeGreaterThan(0);
        } else {
          expect(payment.failureReason).toBeNull();
        }
      }),
      { numRuns: 200 },
    );
  });

  it("both the FAILED and non-FAILED branches are actually exercised across many tripIds", async () => {
    const client = createPaymentMockClient();

    // A large fixed set of distinct ids to prove both branches occur, so the
    // failure branch above is not vacuously satisfied.
    const ids = Array.from({ length: 200 }, (_, i) => `trip-${i}`);
    const statuses = await Promise.all(
      ids.map(async (id) => (await client.getPaymentForTrip(id)).status),
    );

    expect(statuses.some((s) => s === "FAILED")).toBe(true);
    expect(statuses.some((s) => s !== "FAILED")).toBe(true);
  });
});
