/** Pure helpers for the rider's trip history. */
import type { HistoryEntry } from "../../domain/trip/contract";

/** Newest first by `trip.requestedAt`. Returns a new array; the input is not mutated. */
export function sortHistory(entries: readonly HistoryEntry[]): HistoryEntry[] {
  return [...entries].sort((a, b) => Date.parse(b.trip.requestedAt) - Date.parse(a.trip.requestedAt));
}
