import type { Place } from "./contract";

export interface PlaceRequestFields {
  lat: number;
  lng: number;
  address: string;
}

export function toRequestFields(place: Place): PlaceRequestFields {
  return { lat: place.lat, lng: place.lng, address: place.address };
}

export function fromRequestFields(fields: PlaceRequestFields): Place {
  return { address: fields.address, lat: fields.lat, lng: fields.lng };
}

/** Exchanges pickup and destination; applying it twice restores the original pair. */
export function swapPlaces(
  pickup: Place | null,
  destination: Place | null,
): { pickup: Place | null; destination: Place | null } {
  return { pickup: destination, destination: pickup };
}
