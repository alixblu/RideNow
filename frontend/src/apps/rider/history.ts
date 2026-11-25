/** Pure helpers for the rider's trip history. */

/** Page size for the Activity list (Req 8.5). */
export const HISTORY_PAGE_SIZE = 20;

/** Anything carrying a trip with a request time. */
interface HasRequestedAt {
  trip: { requestedAt: string };
}

/** Newest first by `trip.requestedAt`. Returns a new array; the input is not mutated. */
export function sortHistory<T extends HasRequestedAt>(entries: readonly T[]): T[] {
  return [...entries].sort((a, b) => Date.parse(b.trip.requestedAt) - Date.parse(a.trip.requestedAt));
}

/**
 * The text shown for one end of a trip: the stored address, or the coordinates rounded to
 * 4 decimal places when there is no address (Req 8.3).
 */
export function formatTripAddress(address: string | null | undefined, lat: number, lng: number): string {
  if (address !== null && address !== undefined && address.trim().length > 0) return address;
  return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
}

/** "from → to" text for a trip. */
export function tripRouteText(trip: {
  pickupAddress: string | null;
  pickupLat: number;
  pickupLng: number;
  destinationAddress: string | null;
  destinationLat: number;
  destinationLng: number;
}): string {
  const from = formatTripAddress(trip.pickupAddress, trip.pickupLat, trip.pickupLng);
  const to = formatTripAddress(trip.destinationAddress, trip.destinationLat, trip.destinationLng);
  return `${from} → ${to}`;
}
