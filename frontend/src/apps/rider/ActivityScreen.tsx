/**
 * ActivityScreen — the rider's trips from `GET /api/trips?passengerId=`, newest first,
 * 20 per page with the next page loaded on scroll to the end (Req 8.1, 8.2, 8.5).
 * Selecting a card opens the trip detail (Req 8.4).
 */
import { useEffect, useMemo, useRef } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Clock } from "lucide-react";
import { appConfig } from "../../config/appConfig";
import { resolveTripClient } from "../../domain/trip";
import type { Page, TripResponse } from "../../domain/trip/contract";
import { useCurrentIdentity } from "../../identity/useCurrentIdentity";
import { formatVnd } from "../../shared/format";
import { Badge, Button, EmptyState, ErrorState, Skeleton } from "../../shared/ui";
import { HISTORY_PAGE_SIZE, sortHistory, tripRouteText } from "./history";

const tripClient = resolveTripClient(appConfig);

export const RIDER_TRIPS_KEY = "rider-trips";

export function useRiderTrips(riderId: string) {
  return useInfiniteQuery<Page<TripResponse>, Error>({
    queryKey: [RIDER_TRIPS_KEY, riderId],
    queryFn: ({ pageParam }) =>
      tripClient.listTrips({
        passengerId: riderId,
        limit: HISTORY_PAGE_SIZE,
        offset: pageParam as number,
      }),
    initialPageParam: 0,
    getNextPageParam: (last, all) => {
      const loaded = all.reduce((n, p) => n + p.items.length, 0);
      return last.items.length > 0 && loaded < last.total ? loaded : undefined;
    },
    enabled: riderId.length > 0,
  });
}

export function tripDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function ActivityScreen() {
  const riderId = useCurrentIdentity().current("rider")?.id ?? "";
  const query = useRiderTrips(riderId);
  const entries = useMemo(
    () => sortHistory((query.data?.pages ?? []).flatMap((p) => p.items).map((trip) => ({ trip }))),
    [query.data],
  );

  const sentinel = useRef<HTMLDivElement | null>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;
  const canObserve = typeof IntersectionObserver !== "undefined";
  useEffect(() => {
    const node = sentinel.current;
    if (!canObserve || !node || !hasNextPage) return;
    const observer = new IntersectionObserver((hits) => {
      if (hits.some((h) => h.isIntersecting) && !isFetchingNextPage) void fetchNextPage();
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [canObserve, hasNextPage, isFetchingNextPage, fetchNextPage, entries.length]);

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <h1 className="text-2xl font-bold">Activity</h1>
      {query.isPending ? (
        <div role="status" aria-label="Loading activity" className="flex flex-col gap-3">
          <Skeleton className="h-20 w-full rounded-2xl" />
          <Skeleton className="h-20 w-full rounded-2xl" />
          <Skeleton className="h-20 w-full rounded-2xl" />
        </div>
      ) : query.isError && entries.length === 0 ? (
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
        <>
          <ul aria-label="Trip history" className="flex flex-col gap-3">
            {entries.map(({ trip }) => (
              <li key={trip.id}>
                <Link
                  to={`/rider/activity/${trip.id}`}
                  className="flex min-h-11 flex-col gap-2 rounded-2xl bg-surface-raised p-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <time dateTime={trip.requestedAt} className="text-xs text-content-muted">
                      {tripDate(trip.requestedAt)}
                    </time>
                    <Badge status={trip.status} />
                  </div>
                  <p className="text-sm font-semibold">{tripRouteText(trip)}</p>
                  <div className="flex items-center justify-end text-sm">
                    <span className="font-bold text-content">
                      {formatVnd(trip.finalFare ?? trip.estimatedFare ?? 0)}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          {query.isError ? (
            <ErrorState error={query.error} onRetry={() => void fetchNextPage()} />
          ) : null}
          {hasNextPage ? (
            canObserve ? (
              <div ref={sentinel} aria-hidden="true" className="h-4" />
            ) : (
              <Button variant="secondary" onClick={() => void fetchNextPage()} disabled={isFetchingNextPage}>
                Load more
              </Button>
            )
          ) : null}
        </>
      )}
    </div>
  );
}
