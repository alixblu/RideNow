/**
 * TripDetailScreen — one past trip: route, fare, driver, payment status (Req 4.9).
 */
import { ArrowLeft, Star } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { useCurrentIdentity } from "../../identity/useCurrentIdentity";
import { formatVnd } from "../../shared/format";
import { Avatar, Badge, Card, CardBody, EmptyState, ErrorState, Skeleton } from "../../shared/ui";
import { routeText, tripDate, useRiderHistory } from "./ActivityScreen";

export function TripDetailScreen() {
  const { tripId } = useParams<{ tripId: string }>();
  const riderId = useCurrentIdentity().current("rider")?.id ?? "";
  const query = useRiderHistory(riderId);
  const entry = query.data?.find((e) => e.trip.id === tripId) ?? null;

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <Link to="/rider/activity" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Activity
      </Link>
      <h1 className="text-2xl font-bold">Trip details</h1>
      {query.isPending ? (
        <div role="status" aria-label="Loading trip" className="flex flex-col gap-3">
          <Skeleton className="h-28 w-full rounded-2xl" />
          <Skeleton className="h-28 w-full rounded-2xl" />
        </div>
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : entry === null ? (
        <EmptyState message="We couldn't find that trip." />
      ) : (
        <>
          <Card>
            <CardBody className="flex flex-col gap-2 pt-5">
              <div className="flex items-center justify-between">
                <time dateTime={entry.trip.requestedAt} className="text-xs text-content-muted">
                  {tripDate(entry.trip.requestedAt)}
                </time>
                <Badge status={entry.trip.status} />
              </div>
              <h2 className="text-xs font-semibold uppercase text-content-muted">Route</h2>
              <p className="text-sm font-semibold">{routeText(entry)}</p>
            </CardBody>
          </Card>

          <Card>
            <CardBody className="flex flex-col gap-2 pt-5">
              <h2 className="text-xs font-semibold uppercase text-content-muted">Fare</h2>
              <p className="text-2xl font-bold">
                {formatVnd(entry.trip.finalFare ?? entry.trip.estimatedFare ?? 0)}
              </p>
              <div className="flex items-center justify-between text-sm">
                <span className="text-content-muted">Payment</span>
                <Badge status={entry.paymentStatus} />
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardBody className="flex items-center gap-3 pt-5">
              <Avatar name={entry.counterpartName} size="lg" />
              <div className="min-w-0 flex-1">
                <h2 className="text-xs font-semibold uppercase text-content-muted">Driver</h2>
                <p className="truncate text-base font-bold">{entry.counterpartName}</p>
                {entry.vehicleLabel ? (
                  <p className="truncate text-sm text-content-muted">{entry.vehicleLabel}</p>
                ) : null}
                {entry.counterpartRating !== null ? (
                  <p className="flex items-center gap-1 text-sm">
                    <Star className="h-4 w-4 fill-warning text-warning" aria-hidden="true" />
                    {entry.counterpartRating.toFixed(1)}
                  </p>
                ) : null}
              </div>
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
}
