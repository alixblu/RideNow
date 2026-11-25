/**
 * Seeded trip history and driver ratings (Req 7.2, 7.3, 7.7).
 *
 * Everything is derived from a numeric seed and the fixed `SEED_NOW`, never from
 * `Date.now()` or `Math.random()`, so the same seed always yields deeply equal output.
 */
import type { PaymentMethod, PaymentStatus, TripStatus, VehicleType } from "../../shared/enums";
import type { TripResponse } from "../trip/contract";
import { estimateFare } from "../fare/estimateFare";
import { createRng, DEFAULT_SEED } from "./prng";
import { mockProfiles, SEED_NOW, type SeedProfile } from "./people";

/** Real Ho Chi Minh City landmarks used only to generate seeded trips. */
export interface SeedLandmark {
  id: string;
  label: string;
  address: string;
  lat: number;
  lng: number;
}

export const SEED_LANDMARKS: readonly SeedLandmark[] = [
  { id: "ben-thanh", label: "Ben Thanh Market", address: "Le Loi, Ben Thanh Ward, District 1", lat: 10.7725, lng: 106.698 },
  { id: "notre-dame", label: "Notre-Dame Cathedral", address: "01 Cong xa Paris, Ben Nghe Ward, District 1", lat: 10.7797, lng: 106.699 },
  { id: "bitexco", label: "Bitexco Financial Tower", address: "2 Hai Trieu, Ben Nghe Ward, District 1", lat: 10.7718, lng: 106.7043 },
  { id: "tan-son-nhat", label: "Tan Son Nhat Airport", address: "Truong Son, Ward 2, Tan Binh District", lat: 10.8188, lng: 106.6519 },
  { id: "landmark-81", label: "Landmark 81", address: "720A Dien Bien Phu, Ward 22, Binh Thanh District", lat: 10.7949, lng: 106.7218 },
  { id: "thao-dien", label: "Thao Dien", address: "Xuan Thuy, Thao Dien Ward, Thu Duc City", lat: 10.8036, lng: 106.7406 },
  { id: "independence-palace", label: "Independence Palace", address: "135 Nam Ky Khoi Nghia, Ben Thanh Ward, District 1", lat: 10.7770, lng: 106.6953 },
  { id: "saigon-zoo", label: "Saigon Zoo and Botanical Garden", address: "2 Nguyen Binh Khiem, Ben Nghe Ward, District 1", lat: 10.7875, lng: 106.7054 },
  { id: "cho-lon", label: "Binh Tay Market", address: "57A Thap Muoi, Ward 2, District 6", lat: 10.7506, lng: 106.6500 },
  { id: "pham-ngu-lao", label: "Pham Ngu Lao Street", address: "Pham Ngu Lao, District 1", lat: 10.7676, lng: 106.6935 },
];
/** Number of trips generated per seeded rider (drivers share them round-robin). */
export const TRIPS_PER_RIDER = 16;
/** Oldest trip is about this many days before `SEED_NOW`. */
export const HISTORY_SPAN_DAYS = 44;

const DAY_MS = 86_400_000;
const MIN_MS = 60_000;

/** One row of a rider's or driver's history (structurally the `HistoryEntry` contract). */
export interface SeedHistoryEntry {
  trip: TripResponse;
  counterpartName: string;
  counterpartRating: number | null;
  vehicleLabel: string | null;
  paymentStatus: PaymentStatus;
  /** The rider's 1 to 5 star rating of this trip, null when unrated or cancelled. */
  rating: number | null;
}

export interface SeedDriverRating {
  /** 1.0 to 5.0, one decimal. */
  average: number;
  ratedTrips: number;
}

/** A generated trip with everything the history, rating and admin views need. */
export interface SeedTrip {
  trip: TripResponse;
  riderId: string;
  driverId: string;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  rating: number | null;
}

export interface SeedHistory {
  /** Newest first, keyed by rider user id. */
  rider: Record<string, SeedHistoryEntry[]>;
  /** Newest first, keyed by driver user id. */
  driver: Record<string, SeedHistoryEntry[]>;
  ratings: Record<string, SeedDriverRating>;
  /** Every generated trip, newest first. */
  trips: SeedTrip[];
}

const METHODS: readonly PaymentMethod[] = ["CASH", "SIMULATED_CARD", "PAYPAL"];
const CANCEL_REASONS = [
  "Changed my plans",
  "Driver took too long",
  "Booked by mistake",
  "Found another ride",
] as const;

function hex(rng: () => number, length: number): string {
  let out = "";
  for (let i = 0; i < length; i += 1) out += Math.floor(rng() * 16).toString(16);
  return out;
}

function uuid(rng: () => number): string {
  return `${hex(rng, 8)}-${hex(rng, 4)}-4${hex(rng, 3)}-8${hex(rng, 3)}-${hex(rng, 12)}`;
}

function pickRating(rng: () => number): number {
  const r = rng();
  if (r < 0.55) return 5;
  if (r < 0.85) return 4;
  if (r < 0.95) return 3;
  return 2;
}

function vehicleLabel(driver: SeedProfile): string | null {
  return driver.vehicle ? `${driver.vehicle.model}, ${driver.vehicle.plate}` : null;
}

/** Generate all trips: `TRIPS_PER_RIDER` per rider, drivers assigned round-robin. */
export function generateSeedTrips(seed: number = DEFAULT_SEED): SeedTrip[] {
  const rng = createRng(seed);
  const riders = mockProfiles.rider;
  const drivers = mockProfiles.driver;
  const places = SEED_LANDMARKS;
  const trips: SeedTrip[] = [];

  riders.forEach((rider, r) => {
    for (let j = 0; j < TRIPS_PER_RIDER; j += 1) {
      const driver = drivers[(j + r) % drivers.length]!;
      const rideType: VehicleType = driver.vehicle?.type ?? "MOTORBIKE";
      // j=0 newest completed, j=1 cancelled, last is the oldest and completed.
      const cancelled = j === 1 || (j % 4 === 1 && j !== TRIPS_PER_RIDER - 1);
      const status: TripStatus = cancelled ? "CANCELLED" : "COMPLETED";

      const pickupIdx = Math.floor(rng() * places.length);
      const destIdx = (pickupIdx + 1 + Math.floor(rng() * (places.length - 1))) % places.length;
      const pickup = places[pickupIdx]!;
      const dest = places[destIdx]!;
      const estimate = estimateFare(
        {
          pickupLat: pickup.lat,
          pickupLng: pickup.lng,
          destinationLat: dest.lat,
          destinationLng: dest.lng,
        },
        rideType,
      );

      const dayOffset = Math.floor((j * HISTORY_SPAN_DAYS) / (TRIPS_PER_RIDER - 1));
      const requested = SEED_NOW.getTime() - dayOffset * DAY_MS - r * 37 * MIN_MS - Math.floor(rng() * 600) * MIN_MS;
      const accepted = requested + (1 + Math.floor(rng() * 3)) * MIN_MS;
      const arrived = accepted + (4 + Math.floor(rng() * 6)) * MIN_MS;
      const started = arrived + (1 + Math.floor(rng() * 3)) * MIN_MS;
      const completed = started + estimate.durationMin * MIN_MS;
      const cancelledAt = accepted + (1 + Math.floor(rng() * 4)) * MIN_MS;
      const iso = (ms: number) => new Date(ms).toISOString();

      const lastUpdate = cancelled ? cancelledAt : completed;
      const trip: TripResponse = {
        id: uuid(rng),
        passengerId: rider.userId,
        driverId: driver.userId,
        vehicleId: null,
        rideType,
        pickupLat: pickup.lat,
        pickupLng: pickup.lng,
        pickupAddress: pickup.label,
        destinationLat: dest.lat,
        destinationLng: dest.lng,
        destinationAddress: dest.label,
        status,
        estimatedFare: estimate.amount,
        finalFare: cancelled ? null : estimate.amount,
        cancellationReason: cancelled ? CANCEL_REASONS[Math.floor(rng() * CANCEL_REASONS.length)]! : null,
        version: cancelled ? 2 : 5,
        requestedAt: iso(requested),
        acceptedAt: iso(accepted),
        arrivedAt: cancelled ? null : iso(arrived),
        startedAt: cancelled ? null : iso(started),
        completedAt: cancelled ? null : iso(completed),
        cancelledAt: cancelled ? iso(cancelledAt) : null,
        createdAt: iso(requested),
        updatedAt: iso(lastUpdate),
      };

      const rated = !cancelled && rng() < 0.85;
      trips.push({
        trip,
        riderId: rider.userId,
        driverId: driver.userId,
        paymentMethod: METHODS[Math.floor(rng() * METHODS.length)]!,
        paymentStatus: cancelled ? "RELEASED" : "PAID",
        rating: rated ? pickRating(rng) : null,
      });
    }
  });

  return trips.sort((a, b) => b.trip.requestedAt.localeCompare(a.trip.requestedAt) || a.trip.id.localeCompare(b.trip.id));
}

/** Average of rated completed trips per driver, clamped to 1.0 to 5.0. */
export function computeDriverRatings(trips: readonly SeedTrip[]): Record<string, SeedDriverRating> {
  const ratings: Record<string, SeedDriverRating> = {};
  for (const driver of mockProfiles.driver) {
    const stars = trips
      .filter((t) => t.driverId === driver.userId && t.rating !== null)
      .map((t) => t.rating as number);
    const average = stars.length === 0 ? 5 : stars.reduce((sum, s) => sum + s, 0) / stars.length;
    ratings[driver.userId] = {
      average: Math.min(5, Math.max(1, Math.round(average * 10) / 10)),
      ratedTrips: stars.length,
    };
  }
  return ratings;
}

/** Build the full seeded history for every rider and driver. */
export function generateSeedHistory(seed: number = DEFAULT_SEED): SeedHistory {
  const trips = generateSeedTrips(seed);
  const ratings = computeDriverRatings(trips);
  const riderById = new Map(mockProfiles.rider.map((p) => [p.userId, p]));
  const driverById = new Map(mockProfiles.driver.map((p) => [p.userId, p]));

  const rider: Record<string, SeedHistoryEntry[]> = {};
  const driver: Record<string, SeedHistoryEntry[]> = {};
  for (const p of mockProfiles.rider) rider[p.userId] = [];
  for (const p of mockProfiles.driver) driver[p.userId] = [];

  for (const t of trips) {
    const d = driverById.get(t.driverId) as SeedProfile;
    const r = riderById.get(t.riderId) as SeedProfile;
    rider[t.riderId]!.push({
      trip: t.trip,
      counterpartName: d.name,
      counterpartRating: ratings[d.userId]!.average,
      vehicleLabel: vehicleLabel(d),
      paymentStatus: t.paymentStatus,
      rating: t.rating,
    });
    driver[t.driverId]!.push({
      trip: t.trip,
      counterpartName: r.name,
      counterpartRating: null,
      vehicleLabel: vehicleLabel(d),
      paymentStatus: t.paymentStatus,
      rating: t.rating,
    });
  }

  return { rider, driver, ratings, trips };
}
