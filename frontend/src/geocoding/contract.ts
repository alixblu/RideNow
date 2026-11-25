/** A geocoded location the rider selected or resolved. */
export interface Place {
  address: string;
  lat: number;
  lng: number;
}

export interface Geocoder {
  /** Resolves to [] when nothing matches; rejects when the request fails. */
  search(query: string, signal: AbortSignal): Promise<Place[]>;
  /** Resolves to null when nothing matches; rejects when the request fails. */
  reverse(lat: number, lng: number, signal: AbortSignal): Promise<Place | null>;
}
