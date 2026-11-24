/**
 * Seeded Admin_Dashboard rows: 30 each for trips, drivers, riders and payments
 * (Req 7.5, 7.7). Built from the same profiles and history as the rider and driver
 * apps so figures agree across roles.
 */
import type { DriverStatus, PaymentMethod, PaymentStatus, TripStatus } from "../../shared/enums";
import type { UserStatus } from "../user/contract";
import { createRng, DEFAULT_SEED } from "./prng";
import { mockProfiles, SEED_NOW } from "./people";
import { generateSeedHistory, type SeedTrip } from "./history";

export const ADMIN_ROW_COUNT = 30;

export interface AdminTripRow {
  id: string;
  rider: string;
  driver: string | null;
  route: string;
  fare: number | null;
  status: TripStatus;
  requestedAt: string;
}

export interface AdminDriverRow {
  id: string;
  name: string;
  vehicle: string;
  rating: number;
  trips: number;
  status: DriverStatus;
  online: boolean;
}

export interface AdminRiderRow {
  id: string;
  name: string;
  phone: string;
  trips: number;
  joinedAt: string;
  status: UserStatus;
}

export interface AdminPaymentRow {
  id: string;
  tripId: string;
  amount: number;
  method: PaymentMethod;
  status: PaymentStatus;
  paidAt: string | null;
}

export interface AdminRows {
  trips: AdminTripRow[];
  drivers: AdminDriverRow[];
  riders: AdminRiderRow[];
  payments: AdminPaymentRow[];
}

const DAY_MS = 86_400_000;
const FAMILY = ["Nguyen", "Tran", "Le", "Pham", "Hoang", "Vu", "Dang", "Bui", "Do", "Ngo"] as const;
const MIDDLE = ["Van", "Thi", "Minh", "Quoc", "Thanh", "Hoang", "Ngoc", "Duc"] as const;
const GIVEN = ["An", "Binh", "Chi", "Dung", "Giang", "Hieu", "Khanh", "Linh", "Mai", "Nam", "Phuc", "Quyen", "Son", "Trang", "Vy"] as const;
const MOTO_MODELS = ["Honda Vision", "Honda Air Blade", "Yamaha Exciter", "Yamaha Janus"] as const;
const CAR_MODELS = ["Toyota Vios", "Hyundai Accent", "Kia Morning", "Mazda 3"] as const;

function pick<T>(rng: () => number, list: readonly T[]): T {
  return list[Math.floor(rng() * list.length)]!;
}

function personName(rng: () => number): string {
  return `${pick(rng, FAMILY)} ${pick(rng, MIDDLE)} ${pick(rng, GIVEN)}`;
}

function digits(rng: () => number, n: number): string {
  let out = "";
  for (let i = 0; i < n; i += 1) out += Math.floor(rng() * 10);
  return out;
}

function fixedId(prefix: string, n: number): string {
  return `${prefix}-4444-4444-8444-${String(n).padStart(12, "0")}`;
}

function tripRow(t: SeedTrip): AdminTripRow {
  const rider = mockProfiles.rider.find((p) => p.userId === t.riderId);
  const driver = mockProfiles.driver.find((p) => p.userId === t.driverId);
  return {
    id: t.trip.id,
    rider: rider?.name ?? "Unknown rider",
    driver: driver?.name ?? null,
    route: `${t.trip.pickupAddress} to ${t.trip.destinationAddress}`,
    fare: t.trip.finalFare ?? t.trip.estimatedFare,
    status: t.trip.status,
    requestedAt: t.trip.requestedAt,
  };
}

export function generateAdminRows(seed: number = DEFAULT_SEED): AdminRows {
  const rng = createRng(seed ^ 0x5eed);
  const history = generateSeedHistory(seed);
  const newest = history.trips.slice(0, ADMIN_ROW_COUNT);

  const trips = newest.map(tripRow);

  const payments: AdminPaymentRow[] = newest.map((t, i) => ({
    id: fixedId("55555555", i + 1),
    tripId: t.trip.id,
    amount: t.trip.finalFare ?? t.trip.estimatedFare ?? 0,
    method: t.paymentMethod,
    status: t.paymentStatus,
    paidAt: t.paymentStatus === "PAID" ? t.trip.completedAt : null,
  }));

  const tripCount = (id: string, key: "driver" | "rider") =>
    history.trips.filter((t) => (key === "driver" ? t.driverId : t.riderId) === id).length;

  const drivers: AdminDriverRow[] = [];
  for (const p of mockProfiles.driver) {
    drivers.push({
      id: p.userId,
      name: p.name,
      vehicle: p.vehicle ? `${p.vehicle.model}, ${p.vehicle.plate}` : "No vehicle",
      rating: history.ratings[p.userId]!.average,
      trips: tripCount(p.userId, "driver"),
      status: "ACTIVE",
      online: rng() < 0.6,
    });
  }
  while (drivers.length < ADMIN_ROW_COUNT) {
    const car = rng() < 0.35;
    const model = car ? pick(rng, CAR_MODELS) : pick(rng, MOTO_MODELS);
    const plate = car ? `51H-${digits(rng, 3)}.${digits(rng, 2)}` : `59X${1 + Math.floor(rng() * 3)}-${digits(rng, 3)}.${digits(rng, 2)}`;
    drivers.push({
      id: fixedId("66666666", drivers.length + 1),
      name: personName(rng),
      vehicle: `${model}, ${plate}`,
      rating: Math.round((3.5 + rng() * 1.5) * 10) / 10,
      trips: 5 + Math.floor(rng() * 400),
      status: rng() < 0.9 ? "ACTIVE" : "SUSPENDED",
      online: rng() < 0.5,
    });
  }

  const riders: AdminRiderRow[] = [];
  for (const p of mockProfiles.rider) {
    riders.push({
      id: p.userId,
      name: p.name,
      phone: `09${digits(rng, 8)}`,
      trips: tripCount(p.userId, "rider"),
      joinedAt: new Date(SEED_NOW.getTime() - (200 + Math.floor(rng() * 300)) * DAY_MS).toISOString(),
      status: "ACTIVE",
    });
  }
  while (riders.length < ADMIN_ROW_COUNT) {
    riders.push({
      id: fixedId("77777777", riders.length + 1),
      name: personName(rng),
      phone: `09${digits(rng, 8)}`,
      trips: Math.floor(rng() * 120),
      joinedAt: new Date(SEED_NOW.getTime() - (10 + Math.floor(rng() * 600)) * DAY_MS).toISOString(),
      status: rng() < 0.92 ? "ACTIVE" : "SUSPENDED",
    });
  }

  return { trips, drivers, riders, payments };
}
