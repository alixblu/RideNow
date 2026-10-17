/**
 * Payment domain contract — the single documented shape the Mock_Client implements
 * today and a future Live_Client must match without any screen change (Req 11.4).
 * Screens depend only on this interface and these types, never on which implementation
 * is active, so swapping mock → live is a configuration change (Req 4.1, 4.3).
 *
 * The payment domain is STUBBED: no payment-service exists yet, so there is only a
 * `Mock_Client` behind this documented future contract. The response type is drawn
 * from the DBML `payments` table (design: "Typed models and DTOs"); the JPA/internal
 * `idempotency_key` column is intentionally excluded from the client-facing contract.
 *
 * Field mapping from the DBML `payments` table:
 *   - id            ← id (uuid)
 *   - tripId        ← trip_id (uuid, logical reference to the trip)
 *   - amount        ← amount (decimal → JSON number)
 *   - currency      ← currency (varchar(3), default 'VND')
 *   - method        ← method (CASH | SIMULATED_CARD)
 *   - status        ← status (Payment_Status set, default PENDING)
 *   - failureReason ← failure_reason (varchar, nullable)
 *   - createdAt     ← created_at (timestamp → ISO-8601 string)
 *   - updatedAt     ← updated_at (timestamp → ISO-8601 string)
 */
import type { PaymentStatus } from "../../shared/enums";

// ---------------------------------------------------------------------------
// Payment-owned method union — kept local to this domain (payment owns it), not
// hoisted into shared enums, since no other domain depends on it.
// ---------------------------------------------------------------------------

/** How a payment is tendered (payment-owned, per DBML `payments.method`). */
export type PaymentMethod = "CASH" | "SIMULATED_CARD";

// ---------------------------------------------------------------------------
// Response type — field names and types match the DBML payments table (sans the
// internal idempotency_key column).
// ---------------------------------------------------------------------------

/** A payment returned by the payment Service_Client (drawn from the DBML `payments` table). */
export interface PaymentResponse {
  id: string;
  /** Cross-service id: the trip this payment settles. */
  tripId: string;
  /** decimal → JSON number. */
  amount: number;
  /** varchar(3); DBML default 'VND'. */
  currency: string;
  method: PaymentMethod;
  status: PaymentStatus;
  /**
   * varchar, nullable. Non-empty exactly when status is FAILED; null otherwise
   * (Req 11.3, backs Property 18).
   */
  failureReason: string | null;
  /** timestamp → ISO-8601 string. */
  createdAt: string;
  /** timestamp → ISO-8601 string. */
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Service_Client contract — identical for the Mock_Client and a future Live_Client.
// ---------------------------------------------------------------------------

export interface PaymentServiceClient {
  /**
   * Read the payment for a trip → `PaymentResponse`. The returned status is always
   * within the Payment_Status set, and a FAILED payment always carries a non-empty
   * failure reason (Req 11.1–11.3).
   */
  getPaymentForTrip(tripId: string): Promise<PaymentResponse>;
}
