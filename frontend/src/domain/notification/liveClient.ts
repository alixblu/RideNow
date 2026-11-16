/**
 * Notification Live_Client — talks to notification-worker's inbox API through
 * `httpRequest`, so URL resolution and error normalization stay in the http layer.
 */
import { httpRequest } from "../../http/httpClient";
import type { NotificationResponse, NotificationServiceClient } from "./contract";

const NOTIFICATIONS_PATH = "/api/notifications";

export function createNotificationLiveClient(): NotificationServiceClient {
  return {
    listSince(userId: string, sinceId?: string): Promise<NotificationResponse[]> {
      const query = new URLSearchParams({ userId });
      if (sinceId !== undefined) {
        query.set("since", sinceId);
      }
      return httpRequest<NotificationResponse[]>(`${NOTIFICATIONS_PATH}?${query.toString()}`);
    },
    markRead(id: string): Promise<NotificationResponse> {
      return httpRequest<NotificationResponse>(
        `${NOTIFICATIONS_PATH}/${encodeURIComponent(id)}/read`,
        { method: "POST" },
      );
    },
  };
}
