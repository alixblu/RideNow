/**
 * Shared presentational helpers for the Rider_App ride journey.
 *
 * - `errorView` maps a failed request to the right cross-cutting UI: a service that is
 *   unreachable (ApiError.UNAVAILABLE) shows `Unavailable` + Retry, while any other
 *   sanitized error shows `ErrorBanner`.
 * - `toMessage` extracts the curated `ApiError.message` (or a generic fallback) so views
 *   never render raw error objects.
 * - `PRESET_LOCATIONS` is a small named-places list (Ho Chi Minh City spots) so riders
 *   pick a pickup/destination by name rather than typing raw coordinates.
 * - formatting + status helpers shared by the journey view.
 *
 * Plain presentational pieces with no mock/live marker.
 */
import type { ReactElement } from "react";
import { ApiError } from "../../http/ApiError";
import { ErrorBanner, Unavailable } from "../../shared/ui";
import type { TripStatus } from "../../shared/enums";

/** A named place a rider can pick instead of typing coordinates. */
export interface PresetLocation {
  /** Stable key used as the <option> value. */
  id: string;
  label: string;
  lat: number;
  lng: number;
}

/**
 * A handful of real Ho Chi Minh City landmarks. These back the named pickup/destination
 * selects; their coordinates are submitted to the trip service.
 */
export const PRESET_LOCATIONS: readonly PresetLocation[] = [
  { id: "ben-thanh", label: "Ben Thanh Market", lat: 10.7725, lng: 106.698 },
  { id: "notre-dame", label: "Notre-Dame Cathedral", lat: 10.7797, lng: 106.699 },
  { id: "bitexco", label: "Bitexco Financial Tower", lat: 10.7718, lng: 106.7043 },
  { id: "tan-son-nhat", label: "Tan Son Nhat Airport", lat: 10.8188, lng: 106.6519 },
  { id: "landmark-81", label: "Landmark 81", lat: 10.7949, lng: 106.7218 },
  { id: "thao-dien", label: "Thao Dien", lat: 10.8036, lng: 106.7406 },
];

/** Trip statuses that are terminal — no further lifecycle changes, no cancel. */
export const TERMINAL_STATUSES: readonly TripStatus[] = ["COMPLETED", "CANCELLED"];

/** Whether a trip status is terminal (polling stops, cancel is hidden). */
export function isTerminal(status: TripStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** Pull the sanitized message from an ApiError, falling back to a generic string. */
export function toMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  return "Something went wrong. Please try again.";
}

/** True when an error is specifically a NOT_FOUND ApiError (used for "no fare yet"). */
export function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.code === "NOT_FOUND";
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

/** Render an ISO-8601 timestamp readably, falling back to the raw string. */
export function formatTimestamp(iso: string | null): string {
  if (iso === null) {
    return "—";
  }
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

/** Short route label for a trip, preferring named addresses, falling back to coords. */
export function routeLabel(
  pickup: string | null,
  pickupCoords: string,
  destination: string | null,
  destinationCoords: string,
): string {
  const from = pickup && pickup.length > 0 ? pickup : pickupCoords;
  const to = destination && destination.length > 0 ? destination : destinationCoords;
  return `${from} → ${to}`;
}
