/**
 * Notification domain entry point — resolves the active
 * {@link NotificationServiceClient} from configuration via the generic client factory.
 * Live talks to notification-worker's inbox; mock is an in-memory inbox.
 */
import type { AppConfig } from "../../config/appConfig";
import { resolveClient } from "../clientFactory";
import type { NotificationServiceClient } from "./contract";
import { createNotificationLiveClient } from "./liveClient";
import { createNotificationMockClient } from "./mockClient";

export type { NotificationResponse, NotificationServiceClient } from "./contract";
export { createNotificationLiveClient } from "./liveClient";
export { createNotificationMockClient } from "./mockClient";
export type { NotificationMockClient } from "./mockClient";

/** Resolve the notification Service_Client for the current configuration. */
export function resolveNotificationClient(config: AppConfig): NotificationServiceClient {
  return resolveClient(
    config.clients.notification.mode,
    () => createNotificationLiveClient(),
    () => createNotificationMockClient(),
  );
}
