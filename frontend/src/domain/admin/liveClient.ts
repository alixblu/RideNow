/**
 * Admin Live_Client. The backend has no admin aggregation endpoint, so every
 * method delegates to the Mock_Client and issues no HTTP requests (Req 7.8, 7.9, 7.10).
 */
import type { AdminServiceClient } from "./contract";
import { createAdminMockClient } from "./mockClient";

export function createAdminLiveClient(): AdminServiceClient {
  const mock = createAdminMockClient();
  return {
    getOverview: () => mock.getOverview(),
    listTripRows: () => mock.listTripRows(),
    listDriverRows: () => mock.listDriverRows(),
    listRiderRows: () => mock.listRiderRows(),
    listPaymentRows: () => mock.listPaymentRows(),
  };
}
