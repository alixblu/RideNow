/**
 * Notification domain contract — the shape both the Live_Client and the Mock_Client
 * implement, so screens never depend on which one is active.
 *
 * Mirrors notification-worker's inbox API (`NotificationResponse.java`):
 *   - `GET /api/notifications?userId=&since=&limit=` -> items after `since`, oldest first
 *   - `POST /api/notifications/{id}/read`           -> the item, with `readAt` set
 *
 * Ids are UUID strings; timestamps are ISO-8601 strings.
 */

/** One inbox item for one user. */
export interface NotificationResponse {
  id: string;
  userId: string;
  /** The event type, e.g. `driver.accepted`, `match.offered`, `payment.succeeded`. */
  type: string;
  message: string;
  /** The trip this is about, when known. */
  tripId: string | null;
  /** When the underlying change happened, when known. */
  occurredAt: string | null;
  createdAt: string;
  /** Null until the user marks it read. */
  readAt: string | null;
}

export interface NotificationServiceClient {
  /**
   * The user's items after `sinceId` (the id of the last item the client has), oldest
   * first. Without `sinceId`, the newest items (still oldest first).
   */
  listSince(userId: string, sinceId?: string): Promise<NotificationResponse[]>;
  /** Mark one item read; returns it with `readAt` set. */
  markRead(id: string): Promise<NotificationResponse>;
}
