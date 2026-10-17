/**
 * Payment Mock_Client — the in-memory implementation of `PaymentServiceClient`
 * (Req 11.1–11.3).
 *
 * The payment domain is STUBBED: there is no payment-service yet, so this mock stands
 * in behind the documented future contract and returns data that conforms to it
 * exactly, letting payment views render as they will against a real Live_Client
 * (Req 4.4, 11.4).
 *
 * Results are deterministic per `tripId`: a small FNV-1a hash of the id drives the
 * status, amount, and method, so the same trip always yields the same payment and
 * tests are stable. The hash deliberately spreads across all four Payment_Status
 * values — including FAILED — so Property 18's failure branch is exercisable from real
 * tripIds. The contract invariant is enforced here: a FAILED payment always carries a
 * non-empty `failureReason`, and any other status carries `null` (backs Property 18).
 */
import type {
  PaymentMethod,
  PaymentResponse,
  PaymentServiceClient,
} from "./contract";
import type { PaymentStatus } from "../../shared/enums";

/** Payment_Status values in a fixed order, indexed by the per-tripId hash. */
const STATUS_BY_INDEX: readonly PaymentStatus[] = [
  "PENDING",
  "PROCESSING",
  "PAID",
  "FAILED",
];

/** DBML default currency for payments. */
const DEFAULT_CURRENCY = "VND";

/**
 * FNV-1a 32-bit hash of a string → unsigned 32-bit integer. Deterministic and
 * dependency-free, used only to derive stable mock values from a tripId.
 */
function hashTripId(tripId: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < tripId.length; i += 1) {
    hash ^= tripId.charCodeAt(i);
    // 32-bit FNV prime multiply, kept within 32 bits via >>> 0.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Build a payment `Mock_Client`.
 *
 * Returned as a factory (not a singleton) to match the client-factory pattern.
 */
export function createPaymentMockClient(): PaymentServiceClient {
  return {
    getPaymentForTrip(tripId: string): Promise<PaymentResponse> {
      const hash = hashTripId(tripId);

      // Deterministic selections derived from the hash. The index is always in
      // range; `?? "FAILED"` only satisfies strict noUncheckedIndexedAccess.
      const status: PaymentStatus =
        STATUS_BY_INDEX[hash % STATUS_BY_INDEX.length] ?? "FAILED";
      const method: PaymentMethod =
        (hash >>> 2) % 2 === 0 ? "CASH" : "SIMULATED_CARD";
      // A stable, plausible fare: 10,000–510,000 VND.
      const amount = 10_000 + ((hash >>> 4) % 500_000);

      // Contract invariant (Property 18): FAILED carries a non-empty reason;
      // every other status carries null.
      const failureReason =
        status === "FAILED" ? "Payment declined by the card issuer." : null;

      const now = new Date().toISOString();
      const payment: PaymentResponse = {
        id: crypto.randomUUID(),
        tripId,
        amount,
        currency: DEFAULT_CURRENCY,
        method,
        status,
        failureReason,
        createdAt: now,
        updatedAt: now,
      };
      return Promise.resolve(payment);
    },
  };
}
