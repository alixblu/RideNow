/**
 * Admin domain contract (Req 6.2, 6.3, 7.5, 7.8).
 *
 * The backend has no admin aggregation endpoint, so this is a new domain whose
 * Live_Client delegates to the Mock_Client (task 3.5).
 */
import type {
  AdminDriverRow,
  AdminPaymentRow,
  AdminRiderRow,
  AdminTripRow,
} from "../seed/adminRows";

export type { AdminDriverRow, AdminPaymentRow, AdminRiderRow, AdminTripRow };

/** Summary figures shown on the Admin_Dashboard Overview destination. */
export interface AdminOverview {
  activeTrips: number;
  onlineDrivers: number;
  completedToday: number;
  /** VND collected from trips completed today. */
  revenueToday: number;
}

export interface AdminServiceClient {
  getOverview(): Promise<AdminOverview>;
  listTripRows(): Promise<AdminTripRow[]>;
  listDriverRows(): Promise<AdminDriverRow[]>;
  listRiderRows(): Promise<AdminRiderRow[]>;
  listPaymentRows(): Promise<AdminPaymentRow[]>;
}
