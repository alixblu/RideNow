/**
 * Shared presentational helpers for the Rider_App screens.
 *
 * - `errorView` maps a failed request to the right cross-cutting UI: a service that is
 *   unreachable (ApiError.UNAVAILABLE) shows `Unavailable` + Retry (Req 13.3), while any
 *   other sanitized error shows `ErrorBanner` (Req 13.2).
 * - `toMessage` extracts the curated `ApiError.message` (or a generic fallback) so views
 *   never render raw error objects.
 * - `TripDetail` renders every TripResponse field, with the Trip_Status shown as a pill
 *   drawn from the defined Trip_Status set (Req 9.2).
 *
 * Plain presentational pieces with no mock/live marker, so stubbed rider screens look
 * identical to live ones (Req 4.5). Restyled on the Tailwind kit.
 */
import type { ReactElement } from "react";
import { ApiError } from "../../http/ApiError";
import { ErrorBanner, Unavailable, StatusPill } from "../../shared/ui";
import type { TripResponse } from "../../domain/trip";

/** Pull the sanitized message from an ApiError, falling back to a generic string. */
export function toMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  return "Something went wrong. Please try again.";
}

/**
 * Render the correct failure view for a query error: unreachable services get a retry
 * affordance; every other sanitized error gets a banner.
 */
export function errorView(error: unknown, onRetry: () => void): ReactElement {
  if (error instanceof ApiError && error.code === "UNAVAILABLE") {
    return <Unavailable onRetry={onRetry} message={error.message} />;
  }
  return <ErrorBanner message={toMessage(error)} />;
}

/** A labelled key/value row used in detail lists. */
function Row({ label, value }: { label: string; value: ReactElement | string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b border-border/60 last:border-0">
      <dt className="text-sm text-content-subtle">{label}</dt>
      <dd className="text-sm text-content text-right break-all">{value}</dd>
    </div>
  );
}

/** Format a nullable number for display. */
function num(value: number | null): string {
  return value === null ? "—" : String(value);
}

/** Format a nullable string for display. */
function str(value: string | null): string {
  return value === null || value.length === 0 ? "—" : value;
}

/** Render all fields of a TripResponse, with its Trip_Status as a pill (Req 9.2). */
export function TripDetail({ trip }: { trip: TripResponse }): ReactElement {
  return (
    <dl className="mt-1">
      <Row label="Status" value={<StatusPill status={trip.status} />} />
      <Row label="Passenger" value={trip.passengerId} />
      <Row label="Driver" value={str(trip.driverId)} />
      <Row label="Vehicle" value={str(trip.vehicleId)} />
      <Row label="Ride type" value={trip.rideType} />
      <Row label="Pickup" value={`${trip.pickupLat}, ${trip.pickupLng}`} />
      <Row label="Destination" value={`${trip.destinationLat}, ${trip.destinationLng}`} />
      <Row label="Estimated fare" value={num(trip.estimatedFare)} />
      <Row label="Final fare" value={num(trip.finalFare)} />
      <Row label="Cancellation reason" value={str(trip.cancellationReason)} />
      <Row label="Requested at" value={trip.requestedAt} />
      <Row label="Created at" value={trip.createdAt} />
      <Row label="Updated at" value={trip.updatedAt} />
    </dl>
  );
}
