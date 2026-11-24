/**
 * ActivityScreen — the rider's Trip_History as cards, newest first (Req 4.8).
 * Selecting a card opens the trip detail (Req 4.9).
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Clock } from "lucide-react";
import { appConfig } from "../../config/appConfig";
import { resolveTripClient } from "../../domain/trip";
import type { HistoryEntry } from "../../domain/trip/contract";
import { useCurrentIdentity } from "../../identity/useCurrentIdentity";
import { formatVnd } from "../../shared/format";
import { Badge, EmptyState, ErrorState, Skeleton } from "../../shared/ui";
import { sortHistory } from "./history";

const tripClient = resolveTripClient(appConfig);

export const RIDER_HISTORY_KEY = "rider-history";

export function useRiderHistory(riderId: string) {
  return useQuery<HistoryEntry[], Error>({
    queryKey: [RIDER_HISTORY_KEY, riderId],
    queryFn: () => tripClient.listTripHistory({ role: "rider", userId: riderId }),
    enabled: riderId.length > 0,
  });
}

export function routeText(entry: HistoryEntry): string {
  const { trip } = entry;
  const from = trip.pickupAddress ?? `${trip.pickupLat}, ${trip.pickupLng}`;
  const to = trip.destinationAddress ?? `${trip.destinationLat}, ${trip.destinationLng}`;
  return `${from} → ${to}`;
}

export function tripDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function ActivityScreen() {
  const riderId = useCurrentIdentity().current("rider")?.id ?? "";
  const query = useRiderHistory(riderId);
  const entries = useMemo(() => sortHistory(query.data ?? []), [query.data]);

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <h1 className="text-2xl font-bold">Activity</h1>
      {query.isPending ? (
        <div role="status" aria-label="Loading activity" className="flex flex-col gap-3">
          <Skeleton className="h-20 w-full rounded-2xl" />
          <Skeleton className="h-20 w-full rounded-2xl" />
          <Skeleton className="h-20 w-full rounded-2xl" />
        </div>
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : entries.length === 0 ? (
        <EmptyState
          message="No rides yet. Your trips will show up here."
          icon={<Clock className="h-10 w-10" />}
          action={
            <Link
              to="/rider"
              className="inline-flex h-11 items-center rounded-xl bg-accent px-4 text-sm font-semibold text-accent-fg"
            >
              Book a ride
            </Link>
          }
        />
      ) : (
        <ul aria-label="Trip history" className="flex flex-col gap-3">
          {entries.map((entry) => (
            <li key={entry.trip.id}>
              <Link
                to={`/rider/activity/${entry.trip.id}`}
                className="flex min-h-11 flex-col gap-2 rounded-2xl bg-surface-raised p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <time dateTime={entry.trip.requestedAt} className="text-xs text-content-muted">
                    {tripDate(entry.trip.requestedAt)}
                  </time>
                  <Badge status={entry.trip.status} />
                </div>
                <p className="text-sm font-semibold">{routeText(entry)}</p>
                <div className="flex items-center justify-between text-sm text-content-muted">
                  <span>{entry.counterpartName}</span>
                  <span className="font-bold text-content">
                    {formatVnd(entry.trip.finalFare ?? entry.trip.estimatedFare ?? 0)}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
