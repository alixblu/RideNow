/**
 * EarningsScreen — the Driver_App's Earnings destination (Req 5.7).
 *
 * Shows today's total, this week's total, and the completed trips with the fare per trip,
 * from `getEarnings(driverId)`.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { appConfig } from "../../config/appConfig";
import { resolveTripClient } from "../../domain/trip";
import type { EarningsSummary, TripServiceClientExt } from "../../domain/trip/contract";
import { useCurrentIdentity } from "../../identity/useCurrentIdentity";
import { formatVnd } from "../../shared/format";
import { Card, EmptyState, ErrorState, Skeleton } from "../../shared/ui";

interface EarningsScreenProps {
  tripClient?: TripServiceClientExt;
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function EarningsScreen({ tripClient }: EarningsScreenProps) {
  const trips = useMemo(() => tripClient ?? resolveTripClient(appConfig), [tripClient]);
  const driverId = useCurrentIdentity().current("driver")?.id ?? "";

  const query = useQuery<EarningsSummary, Error>({
    queryKey: ["driver-earnings", driverId],
    queryFn: () => trips.getEarnings(driverId),
    enabled: driverId !== "",
  });

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <h1 className="text-2xl font-bold">Earnings</h1>
      {query.isPending ? (
        <div className="flex flex-col gap-3" aria-label="Loading earnings">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-3">
            <Card className="p-4">
              <dt className="text-xs text-content-muted">Today</dt>
              <dd className="text-2xl font-bold" data-testid="earnings-today">
                {formatVnd(query.data.todayTotal)}
              </dd>
            </Card>
            <Card className="p-4">
              <dt className="text-xs text-content-muted">This week</dt>
              <dd className="text-2xl font-bold" data-testid="earnings-week">
                {formatVnd(query.data.weekTotal)}
              </dd>
            </Card>
          </dl>

          <section aria-label="Completed trips" className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold">Completed trips</h2>
            {query.data.trips.length === 0 ? (
              <EmptyState message="No completed trips yet." />
            ) : (
              <ul className="flex flex-col gap-2">
                {query.data.trips.map((trip) => (
                  <li key={trip.tripId}>
                    <Card className="flex items-center justify-between gap-3 p-4">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{trip.route}</p>
                        <time dateTime={trip.completedAt} className="text-xs text-content-muted">
                          {formatWhen(trip.completedAt)}
                        </time>
                      </div>
                      <span className="shrink-0 font-semibold">{formatVnd(trip.fare)}</span>
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
