/**
 * Page — the shared pagination envelope returned by backend list endpoints.
 *
 * Every list endpoint (trips, payments, drivers, users) returns exactly this shape:
 * `{ items, total, limit, offset }`, mirroring the services' `PageResponse<T>` record
 * (design: "Typed models and DTOs"). Keeping one shared generic here means every
 * domain's list operation speaks the same window contract without redefining it.
 */
export interface Page<T> {
  /** The items in this window. */
  items: T[];
  /** Total number of matching items across all windows. */
  total: number;
  /** The window size that was applied. */
  limit: number;
  /** The zero-based offset of this window. */
  offset: number;
}
