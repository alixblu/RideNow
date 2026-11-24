/**
 * Pure fare estimation (no I/O). Distance is the great-circle distance times a road
 * factor; duration comes from an urban average speed; the amount is
 * base + perKm * distance + perMin * duration, rounded to 1000 VND with a minimum floor.
 */
import type { VehicleType } from "../../shared/enums";
import type { LatLng } from "../../map/roadSnapper";
import type { EstimateFareRequest, FareEstimate } from "../trip/contract";

const EARTH_RADIUS_KM = 6371;
const ROAD_FACTOR = 1.3;

interface Rate {
  base: number;
  perKm: number;
  perMin: number;
  speedKmh: number;
  minimum: number;
}

const RATES: Record<VehicleType, Rate> = {
  MOTORBIKE: { base: 12_000, perKm: 4_500, perMin: 300, speedKmh: 24, minimum: 15_000 },
  CAR: { base: 25_000, perKm: 9_500, perMin: 600, speedKmh: 22, minimum: 30_000 },
};

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Great-circle distance in kilometres. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function estimateFare(req: EstimateFareRequest, vehicleType: VehicleType): FareEstimate {
  const rate = RATES[vehicleType];
  const straight = haversineKm(
    { lat: req.pickupLat, lng: req.pickupLng },
    { lat: req.destinationLat, lng: req.destinationLng },
  );
  const distanceKm = Math.round(straight * ROAD_FACTOR * 10) / 10;
  const durationMin = Math.ceil((distanceKm / rate.speedKmh) * 60);
  const raw = rate.base + rate.perKm * distanceKm + rate.perMin * durationMin;
  const amount = Math.max(rate.minimum, Math.round(raw / 1000) * 1000);
  return { vehicleType, amount, currency: "VND", distanceKm, durationMin };
}
