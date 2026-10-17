/**
 * Notification Mock_Client — in-memory stub that conforms to
 * {@link NotificationServiceClient} (Req 12.1, 12.3).
 *
 * `listForIdentity(identityId)` is deterministic per identity: the same id always
 * yields the same notifications. Each returned {@link NotificationResponse} has a
 * stable `id`, its `recipientId` equal to the requested `identityId`, a non-empty
 * `message`, and an ISO-8601 `createdAt` timestamp.
 *
 * The empty-state is exercised on purpose (Req 12.2, verified by task 18.3): identities
 * whose hash falls into the empty bucket return `[]`, while all others return a short
 * deterministic list. This lets the notifications view show both the populated and the
 * empty case without any backend.
 */
import type {
  NotificationResponse,
  NotificationServiceClient,
} from "./contract";

/** A fixed epoch base so generated timestamps are deterministic, not clock-dependent. */
const BASE_EPOCH_MS = Date.UTC(2024, 0, 1, 0, 0, 0);

/** Small stable string hash (FNV-1a style) used to bucket identities deterministically. */
function hashIdentity(identityId: string): number {
  let hash = 2166136261;
  for (let i = 0; i < identityId.length; i += 1) {
    hash ^= identityId.charCodeAt(i);
    // 32-bit FNV prime multiply, kept in unsigned range.
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Create a fresh notification Mock_Client.
 *
 * Deterministic per identity: identities hashing to the empty bucket (hash % 4 === 0)
 * return an empty array; every other identity returns a short, stable list whose
 * entries all carry the requested id as their `recipientId`.
 */
export function createNotificationMockClient(): NotificationServiceClient {
  return {
    async listForIdentity(
      identityId: string,
    ): Promise<NotificationResponse[]> {
      const hash = hashIdentity(identityId);

      // Empty-state bucket: some identities legitimately have no notifications.
      if (hash % 4 === 0) {
        return [];
      }

      // Otherwise 1–3 deterministic notifications for this identity.
      const count = (hash % 3) + 1;
      const notifications: NotificationResponse[] = [];
      for (let i = 0; i < count; i += 1) {
        notifications.push({
          id: `notif-${identityId}-${i}`,
          recipientId: identityId,
          message: `Notification ${i + 1} for ${identityId}`,
          createdAt: new Date(BASE_EPOCH_MS + hash + i * 60_000).toISOString(),
        });
      }
      return notifications;
    },
  };
}
