/**
 * Notification domain contract — STUBBED (mock only today).
 *
 * This is the single documented shape the Mock_Client implements now and a future
 * Live_Client will implement unchanged (Req 12.3), so screens depend only on this
 * interface and never on which implementation is active. A notification is a simple
 * message addressed to a recipient with a creation timestamp — enough for the
 * notifications view to render each entry's message and when it arrived (Req 12.1).
 *
 * Types are exactly as specified in the design ("Typed models and DTOs"):
 *   - NotificationResponse { id, recipientId, message, createdAt }
 * `createdAt` is an ISO-8601 timestamp string.
 */

// ---------------------------------------------------------------------------
// Response types — field names and types match the design exactly.
// ---------------------------------------------------------------------------

/** A single notification delivered to a recipient. */
export interface NotificationResponse {
  id: string;
  recipientId: string;
  message: string;
  /** ISO-8601 timestamp of when the notification was created. */
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Service_Client contract — identical for the Mock_Client and a future Live_Client.
// ---------------------------------------------------------------------------

export interface NotificationServiceClient {
  /** List the notifications addressed to a given identity (may be empty). */
  listForIdentity(identityId: string): Promise<NotificationResponse[]>;
}
