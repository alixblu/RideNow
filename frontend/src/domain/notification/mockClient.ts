/**
 * Notification Mock_Client — an in-memory inbox that behaves like notification-worker's
 * API: items per user, ordered oldest first, `listSince` returns only items after the
 * given id, and `markRead` keeps the first read time.
 *
 * `push` is mock-only (not on the contract): screens never call it, but other mocks
 * and tests use it to simulate the worker writing a notification.
 */
import { ApiError } from "../../http/ApiError";
import type { NotificationResponse, NotificationServiceClient } from "./contract";

/** Matches the server's cap on one page. */
const MAX_PAGE = 100;

export interface NotificationMockClient extends NotificationServiceClient {
  /** Simulate notification-worker writing an item; returns the stored item. */
  push(item: Omit<NotificationResponse, "id" | "createdAt" | "readAt">): NotificationResponse;
}

export function createNotificationMockClient(): NotificationMockClient {
  const items: NotificationResponse[] = [];

  return {
    push(item) {
      const stored: NotificationResponse = {
        ...item,
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        readAt: null,
      };
      items.push(stored);
      return stored;
    },
    listSince(userId: string, sinceId?: string): Promise<NotificationResponse[]> {
      const mine = items.filter((n) => n.userId === userId);
      if (sinceId === undefined) {
        return Promise.resolve(mine.slice(-MAX_PAGE).map((n) => ({ ...n })));
      }
      const index = mine.findIndex((n) => n.id === sinceId);
      if (index < 0) {
        return Promise.reject(ApiError.validation("Unknown 'since' cursor"));
      }
      return Promise.resolve(mine.slice(index + 1, index + 1 + MAX_PAGE).map((n) => ({ ...n })));
    },
    markRead(id: string): Promise<NotificationResponse> {
      const item = items.find((n) => n.id === id);
      if (!item) {
        return Promise.reject(ApiError.notFound("Notification not found"));
      }
      if (item.readAt === null) {
        item.readAt = new Date().toISOString();
      }
      return Promise.resolve({ ...item });
    },
  };
}
