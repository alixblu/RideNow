/**
 * Admin Mock_Client: serves the deterministic seeded rows (Req 7.5, 7.7) and derives
 * the Overview aggregates from those same rows so the figures always agree.
 */
import type { AdminOverview, AdminServiceClient } from "./contract";
import { generateAdminRows, type AdminRows } from "../seed/adminRows";
import { SEED_NOW } from "../seed/people";

/** Vietnam is UTC+7 with no daylight saving; "today" is the local calendar day. */
const VN_OFFSET_MS = 7 * 3_600_000;

function vnDay(iso: string | number | Date): string {
  return new Date(new Date(iso).getTime() + VN_OFFSET_MS).toISOString().slice(0, 10);
}

/** Pure aggregation over rows, relative to `now`. */
export function computeOverview(rows: AdminRows, now: Date = SEED_NOW): AdminOverview {
  const today = vnDay(now);
  const completedToday = rows.trips.filter(
    (t) => t.status === "COMPLETED" && vnDay(t.requestedAt) === today,
  );
  return {
    activeTrips: rows.trips.filter((t) => t.status !== "COMPLETED" && t.status !== "CANCELLED").length,
    onlineDrivers: rows.drivers.filter((d) => d.online && d.status === "ACTIVE").length,
    completedToday: completedToday.length,
    revenueToday: completedToday.reduce((sum, t) => sum + (t.fare ?? 0), 0),
  };
}

export function createAdminMockClient(): AdminServiceClient {
  const rows = generateAdminRows();
  return {
    getOverview: async () => computeOverview(rows),
    listTripRows: async () => rows.trips.map((r) => ({ ...r })),
    listDriverRows: async () => rows.drivers.map((r) => ({ ...r })),
    listRiderRows: async () => rows.riders.map((r) => ({ ...r })),
    listPaymentRows: async () => rows.payments.map((r) => ({ ...r })),
  };
}
