/**
 * Notification domain entry point — resolves the active
 * {@link NotificationServiceClient} from configuration via the generic client factory
 * (Req 4.2, 12.3).
 *
 * Notification is a STUBBED domain: only a Mock_Client exists today. The live thunk is
 * a documented placeholder that throws until a real notification-service client is
 * wired, so screens keep importing the same contract and the live/mock swap stays a
 * pure configuration change. The thunks are lazy, so the live placeholder never runs
 * while the domain is configured for mock.
 */
import type { AppConfig } from "../../config/appConfig";
import { resolveClient } from "../clientFactory";
import type { NotificationServiceClient } from "./contract";
import { createNotificationMockClient } from "./mockClient";

export type { NotificationResponse, NotificationServiceClient } from "./contract";
export { createNotificationMockClient } from "./mockClient";

/** Resolve the notification Service_Client for the current configuration. */
export function resolveNotificationClient(
  config: AppConfig,
): NotificationServiceClient {
  return resolveClient(
    config.clients.notification.mode,
    () => {
      throw new Error("notification live client not implemented");
    },
    () => createNotificationMockClient(),
  );
}
