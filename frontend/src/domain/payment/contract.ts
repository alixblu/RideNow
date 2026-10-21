/**
 * Payment domain contract — the single documented shape both the Live_Client and the
 * Mock_Client implement (Req 4.1, 4.3, 11.4). Screens depend only on this interface and
 * these types, never on which implementation is active, so swapping mock → live is a
 * configuration change.
 *
 * Request/response types mirror the real payment-service Java records exactly (design:
 * "Typed models and DTOs"):
 *   - CreatePaymentRequest ← `CreatePaymentRequest.java`
 *   - PaymentResponse      ← `PaymentResponse.java` (record)
 *   - PaymentMethod        ← `PaymentMethod.java` (CASH | SIMULATED_CARD | PAYPAL)
 *
 * All IDs are UUID strings; timestamps are ISO-8601 strings (Jackson serializes
 * `Instant` as ISO-8601); `amount` is a `BigDecimal` serialized as a JSON number.
 */
import type { PaymentStatus } from "../../shared/enums";

// ---------------------------------------------------------------------------
// Payment-owned method union — kept local to this domain (payment owns it).
// ---------------------------------------------------------------------------

/** How a payment is tendered (payment-owned, mirrors the `PaymentMethod` enum). */
export type PaymentMethod = "CASH" | "SIMULATED_CARD" | "PAYPAL";

// ---------------------------------------------------------------------------
// Request type — the facts a client supplies; the server owns id/status/timestamps.
// ---------------------------------------------------------------------------

/** Body for `POST /api/payments` (mirrors the Java `CreatePaymentRequest` record). */
export interface CreatePaymentRequest {
  tripId: string;
  /** BigDecimal → JSON number; must be greater than 0. */
  amount: number;
  /** 3-letter currency code. */
  currency: string;
  method: PaymentMethod;
  /** De-duplicates a retried charge so a trip is never charged twice. */
  idempotencyKey: string;
}

// ---------------------------------------------------------------------------
// Response type — field names and types match the Java `PaymentResponse` record.
// ---------------------------------------------------------------------------

/** A payment returned by the payment Service_Client (mirrors the `PaymentResponse` record). */
export interface PaymentResponse {
  id: string;
  /** Cross-service id: the trip this payment settles. */
  tripId: string;
  /** BigDecimal → JSON number. */
  amount: number;
  /** 3-letter currency code; DBML default 'VND'. */
  currency: string;
  method: PaymentMethod;
  status: PaymentStatus;
  /** De-duplication key the create request carried. */
  idempotencyKey: string;
  /**
   * varchar, nullable. Non-empty exactly when status is FAILED; null otherwise
   * (Req 11.3, backs Property 18).
   */
  failureReason: string | null;
  /** timestamp → ISO-8601 string. */
  createdAt: string;
  /** timestamp → ISO-8601 string. */
  updatedAt: string;
  /** timestamp → ISO-8601 string, null unless the payment is PAID. */
  paidAt: string | null;
  /** timestamp → ISO-8601 string, null unless the payment is FAILED. */
  failedAt: string | null;
}

// ---------------------------------------------------------------------------
// Service_Client contract — identical for the Mock_Client and the Live_Client.
// ---------------------------------------------------------------------------

export interface PaymentServiceClient {
  /** Read a payment by id → `PaymentResponse` (missing id → ApiError.notFound). */
  getPayment(id: string): Promise<PaymentResponse>;
  /**
   * Read the payment for a trip → `PaymentResponse`. The returned status is always
   * within the Payment_Status set, and a FAILED payment always carries a non-empty
   * failure reason (Req 11.1–11.3). No payment for the trip → ApiError.notFound.
   */
  getPaymentForTrip(tripId: string): Promise<PaymentResponse>;
  /** Create (charge) a payment for a trip → the created `PaymentResponse`. */
  createPayment(req: CreatePaymentRequest): Promise<PaymentResponse>;
}
