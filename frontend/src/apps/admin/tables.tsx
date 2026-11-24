/** The four Admin_Dashboard table destinations (Req 6.3): Trips, Drivers, Riders, Payments. */
import { useMemo } from "react";
import { appConfig } from "../../config/appConfig";
import { resolveAdminClient } from "../../domain/admin";
import type {
  AdminDriverRow,
  AdminPaymentRow,
  AdminRiderRow,
  AdminTripRow,
} from "../../domain/admin";
import { formatVnd } from "../../shared/format";
import { Badge } from "../../shared/ui";
import { DataTablePage } from "./DataTablePage";
import type { Column } from "./table";

const humanize = (s: string): string => {
  const lower = s.replace(/_/g, " ").toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
};

/** `2026-11-22T08:30:00Z` -> `2026-11-22 08:30` (deterministic, timezone-free). */
const formatDate = (iso: string | null): string =>
  iso === null ? "—" : iso.slice(0, 16).replace("T", " ");

const money = (n: number | null): string => (n === null ? "—" : formatVnd(n));

const tripColumns: Column<AdminTripRow>[] = [
  { key: "id", header: "Trip", cell: (r) => r.id, text: (r) => r.id },
  { key: "rider", header: "Rider", cell: (r) => r.rider, text: (r) => r.rider },
  { key: "driver", header: "Driver", cell: (r) => r.driver ?? "—", text: (r) => r.driver ?? "—" },
  { key: "route", header: "Route", cell: (r) => r.route, text: (r) => r.route },
  { key: "fare", header: "Fare", cell: (r) => money(r.fare), text: (r) => money(r.fare) },
  {
    key: "status",
    header: "Status",
    cell: (r) => <Badge status={r.status} />,
    text: (r) => humanize(r.status),
  },
  {
    key: "requestedAt",
    header: "Requested",
    cell: (r) => formatDate(r.requestedAt),
    text: (r) => formatDate(r.requestedAt),
  },
];

const driverColumns: Column<AdminDriverRow>[] = [
  { key: "id", header: "ID", cell: (r) => r.id, text: (r) => r.id },
  { key: "name", header: "Name", cell: (r) => r.name, text: (r) => r.name },
  { key: "vehicle", header: "Vehicle", cell: (r) => r.vehicle, text: (r) => r.vehicle },
  {
    key: "rating",
    header: "Rating",
    cell: (r) => r.rating.toFixed(1),
    text: (r) => r.rating.toFixed(1),
  },
  { key: "trips", header: "Trips", cell: (r) => r.trips, text: (r) => String(r.trips) },
  {
    key: "status",
    header: "Status",
    cell: (r) => <Badge status={r.status} />,
    text: (r) => humanize(r.status),
  },
  {
    key: "online",
    header: "Availability",
    cell: (r) => <Badge status={r.online ? "ONLINE" : "OFFLINE"} />,
    text: (r) => (r.online ? "Online" : "Offline"),
  },
];

const riderColumns: Column<AdminRiderRow>[] = [
  { key: "id", header: "ID", cell: (r) => r.id, text: (r) => r.id },
  { key: "name", header: "Name", cell: (r) => r.name, text: (r) => r.name },
  { key: "phone", header: "Phone", cell: (r) => r.phone, text: (r) => r.phone },
  { key: "trips", header: "Trips", cell: (r) => r.trips, text: (r) => String(r.trips) },
  {
    key: "joinedAt",
    header: "Joined",
    cell: (r) => formatDate(r.joinedAt),
    text: (r) => formatDate(r.joinedAt),
  },
  {
    key: "status",
    header: "Status",
    cell: (r) => <Badge status={r.status} />,
    text: (r) => humanize(r.status),
  },
];

const paymentColumns: Column<AdminPaymentRow>[] = [
  { key: "id", header: "Payment", cell: (r) => r.id, text: (r) => r.id },
  { key: "tripId", header: "Trip", cell: (r) => r.tripId, text: (r) => r.tripId },
  { key: "amount", header: "Amount", cell: (r) => money(r.amount), text: (r) => money(r.amount) },
  {
    key: "method",
    header: "Method",
    cell: (r) => humanize(r.method),
    text: (r) => humanize(r.method),
  },
  {
    key: "status",
    header: "Status",
    cell: (r) => <Badge status={r.status} />,
    text: (r) => humanize(r.status),
  },
  {
    key: "paidAt",
    header: "Paid",
    cell: (r) => formatDate(r.paidAt),
    text: (r) => formatDate(r.paidAt),
  },
];

const byId = (r: { id: string }): string => r.id;

function useAdminClient() {
  return useMemo(() => resolveAdminClient(appConfig), []);
}

export function TripsScreen() {
  const client = useAdminClient();
  const load = useMemo(() => () => client.listTripRows(), [client]);
  return <DataTablePage title="Trips" columns={tripColumns} load={load} rowKey={byId} />;
}

export function DriversScreen() {
  const client = useAdminClient();
  const load = useMemo(() => () => client.listDriverRows(), [client]);
  return (
    <DataTablePage
      title="Drivers"
      columns={driverColumns}
      load={load}
      rowKey={byId}
      detailTitle={(r) => r.name}
    />
  );
}

export function RidersScreen() {
  const client = useAdminClient();
  const load = useMemo(() => () => client.listRiderRows(), [client]);
  return (
    <DataTablePage
      title="Riders"
      columns={riderColumns}
      load={load}
      rowKey={byId}
      detailTitle={(r) => r.name}
    />
  );
}

export function PaymentsScreen() {
  const client = useAdminClient();
  const load = useMemo(() => () => client.listPaymentRows(), [client]);
  return <DataTablePage title="Payments" columns={paymentColumns} load={load} rowKey={byId} />;
}
