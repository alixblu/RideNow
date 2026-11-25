import type { Geocoder, Place } from "./contract";

const SEARCH_LIMIT = 5;

interface NominatimItem {
  display_name?: unknown;
  lat?: unknown;
  lon?: unknown;
}

function toPlace(item: unknown): Place | null {
  if (typeof item !== "object" || item === null) return null;
  const { display_name, lat, lon } = item as NominatimItem;
  const latN = typeof lat === "string" || typeof lat === "number" ? Number(lat) : NaN;
  const lngN = typeof lon === "string" || typeof lon === "number" ? Number(lon) : NaN;
  if (typeof display_name !== "string" || !Number.isFinite(latN) || !Number.isFinite(lngN)) {
    return null;
  }
  return { address: display_name, lat: latN, lng: lngN };
}

async function getJson(url: string, signal: AbortSignal, fetchImpl: typeof fetch): Promise<unknown> {
  const response = await fetchImpl(url, { signal, headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`Geocoder request failed (${response.status})`);
  }
  return response.json();
}

/** Nominatim-compatible geocoder. Empty array / null for no result; throws on failure. */
export function createNominatimGeocoder(
  baseUrl: string,
  fetchImpl: typeof fetch = (...args) => fetch(...args),
): Geocoder {
  const base = baseUrl.replace(/\/+$/, "");
  return {
    async search(query, signal) {
      const url = `${base}/search?q=${encodeURIComponent(query)}&format=json&limit=${SEARCH_LIMIT}`;
      const body = await getJson(url, signal, fetchImpl);
      if (!Array.isArray(body)) return [];
      return body
        .map(toPlace)
        .filter((p): p is Place => p !== null)
        .slice(0, SEARCH_LIMIT);
    },
    async reverse(lat, lng, signal) {
      const url = `${base}/reverse?lat=${encodeURIComponent(String(lat))}&lon=${encodeURIComponent(String(lng))}&format=json`;
      const body = await getJson(url, signal, fetchImpl);
      return toPlace(body);
    },
  };
}
