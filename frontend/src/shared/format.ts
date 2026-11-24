/** Display formatting helpers (Vietnamese locale, VND). */

const vnd = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 });

/** `45000` -> `45.000 ₫`. */
export function formatVnd(amount: number): string {
  return `${vnd.format(Math.round(amount))} ₫`;
}

/** `3.46` -> `3.5 km`; under 1 km shows metres (`0.4` -> `400 m`). */
export function formatDistance(km: number): string {
  if (km < 1) {
    return `${Math.round(km * 1000)} m`;
  }
  return `${(Math.round(km * 10) / 10).toString()} km`;
}

/** `75` -> `1 h 15 min`, `45` -> `45 min`. */
export function formatDuration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) {
    return `${m} min`;
  }
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}
