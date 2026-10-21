/**
 * Payment Mock_Client — the in-memory implementation of `PaymentServiceClient`
 * (Req 11.1–11.3).
 *
 * It implements the exact same contract as the Live_Client, returning objects that
 * satisfy `PaymentResponse`, so payment views render identically regardless of mode
 * (Req 4.4, 11.4).
 *
 * State lives in a per-client `Map<string, PaymentResponse>` keyed by `tripId`.
 * `createPayment` stores a payment whose status/method/amount are derived
 * deterministically from a small FNV-1a hash of the tripId, so the same trip always
 * yields the same payment and tests are stable. The hash deliberately spreads across
 * all four Payment_Status values — including FAILED — so Property 18's failure branch
 * is exercisable. The contract invariant is enforced here: a FAILED payment always
 * carries a non-empty `failureReason` (and a `failedAt`), a PAID payment carries a
 * `paidAt`, and any other status carries `null` for both (backs Property 18).
 * `getPaymentForTrip`/`getPayment` read the store, throwing `ApiError.notFound` when
 * there is no match.
 */
import { ApiError } from "../../http/ApiError";
import type {
  CreatePaymentRequest,
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
 * Build a payment `Mock_Client` backed by a fresh, empty in-memory store.
 *
 * Returned as a factory (not a singleton) to match the client-factory pattern.
 */
export function createPaymentMockClient(): PaymentServiceClient {
  // Keyed by tripId; also searchable by payment id for getPayment.
  const byTripId = new Map<string, PaymentResponse>();

  function materialize(req: CreatePaymentRequest): PaymentResponse {
    const hash = hashTripId(req.tripId);

    // Deterministic status; the index is always in range (`?? "FAILED"` only
    // satisfies strict noUncheckedIndexedAccess).
    const status: PaymentStatus =
      STATUS_BY_INDEX[hash % STATUS_BY_INDEX.length] ?? "FAILED";

    const now = new Date().toISOString();

    // Contract invariant (Property 18): FAILED carries a non-empty reason + failedAt;
    // PAID carries paidAt; every other status carries null for both.
    const failureReason =
      status === "FAILED" ? "Payment declined by the card issuer." : null;
    const paidAt = status === "PAID" ? now : null;
    const failedAt = status === "FAILED" ? now : null;

    return {
      id: crypto.randomUUID(),
      tripId: req.tripId,
      amount: req.amount,
      currency: req.currency,
      method: req.method,
      status,
      idempotencyKey: req.idempotencyKey,
      failureReason,
      createdAt: now,
      updatedAt: now,
      paidAt,
      failedAt,
    };
  }

  return {
    getPayment(id: string): Promise<PaymentResponse> {
      for (const payment of byTripId.values()) {
        if (payment.id === id) {
          return Promise.resolve(payment);
        }
      }
      return Promise.reject(
        ApiError.notFound("The requested payment could not be found."),
      );
    },

    getPaymentForTrip(tripId: string): Promise<PaymentResponse> {
      const payment = byTripId.get(tripId);
      if (!payment) {
        return Promise.reject(
          ApiError.notFound("No payment was found for the requested trip."),
        );
      }
      return Promise.resolve(payment);
    },

    createPayment(req: CreatePaymentRequest): Promise<PaymentResponse> {
      // Idempotent per tripId: a repeat charge returns the existing payment.
      const existing = byTripId.get(req.tripId);
      if (existing) {
        return Promise.resolve(existing);
      }
      const payment = materialize(req);
      byTripId.set(payment.tripId, payment);
      return Promise.resolve(payment);
    },
  };
}
