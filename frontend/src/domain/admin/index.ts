/**
 * Admin domain entry: resolves the admin `Service_Client` from configuration and
 * re-exports the public contract. The Live_Client (task 3.5) delegates to the mock
 * because no backend endpoint exists.
 */
import type { AppConfig } from "../../config/appConfig";
import { resolveClient } from "../clientFactory";
import type { AdminServiceClient } from "./contract";
import { createAdminLiveClient } from "./liveClient";
import { createAdminMockClient } from "./mockClient";

export type {
  AdminDriverRow,
  AdminOverview,
  AdminPaymentRow,
  AdminRiderRow,
  AdminServiceClient,
  AdminTripRow,
} from "./contract";

export function resolveAdminClient(config: AppConfig): AdminServiceClient {
  return resolveClient(config.clients.admin.mode, createAdminLiveClient, createAdminMockClient);
}
