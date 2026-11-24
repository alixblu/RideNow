/** Pure earnings aggregation for the driver app. */
import type { EarningsSummary, TripResponse } from "../../domain/trip/contract";

const DAY_MS = 86_400_000;

function sameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Aggregate completed trips. Only trips with a `completedAt` and fare (`finalFare`, else
 * `estimatedFare`) count, and trips completed after `now` are ignored.
 * `todayTotal` sums trips on the same local day as `now`; `weekTotal` sums trips completed
 * in the 7 days ending at `now`. `trips` is newest first.
 */
export function summarizeEarnings(trips: readonly TripResponse[], now: Date): EarningsSummary {
  const nowMs = now.getTime();
  const rows: EarningsSummary["trips"] = [];
  let todayTotal = 0;
  let weekTotal = 0;

  for (const trip of trips) {
    const fare = trip.finalFare ?? trip.estimatedFare;
    if (trip.completedAt === null || fare === null) continue;
    const completedMs = Date.parse(trip.completedAt);
    if (Number.isNaN(completedMs) || completedMs > nowMs) continue;

    if (sameLocalDay(new Date(completedMs), now)) todayTotal += fare;
    if (completedMs >= nowMs - 7 * DAY_MS) weekTotal += fare;
    rows.push({
      tripId: trip.id,
      completedAt: trip.completedAt,
      fare,
      route: `${trip.pickupAddress ?? "Pickup"} → ${trip.destinationAddress ?? "Destination"}`,
    });
  }

  rows.sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt));
  return { todayTotal, weekTotal, trips: rows };
}
