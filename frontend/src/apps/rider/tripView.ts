/**
 * Pure mapping from a trip status to what the Rider and Driver apps show.
 * Used by the booking sheet, the driver lifecycle button, and tests.
 */
import type { PaymentMethod, TripStatus, VehicleType } from "../../shared/enums";
import type { CreateTripRequest, TripResponse } from "../../domain/trip/contract";
import type { Place } from "../../geocoding/contract";
import { distanceMeters } from "../../map/smoothMarker";

export type RiderPhase =
  | "requested"
  | "searching"
  | "assigned"
  | "arrived"
  | "in-progress"
  | "completed"
  | "cancelled";

export type DriverNextAction = "arrive" | "start" | "complete" | null;

export interface TripView {
  /** DRIVER_ASSIGNED, DRIVER_ARRIVED, IN_PROGRESS. */
  showDriverCard: boolean;
  /** Same set as the driver card. */
  showDriverMarker: boolean;
  /** SEARCHING, DRIVER_ASSIGNED, DRIVER_ARRIVED. */
  showCancel: boolean;
  /** COMPLETED. */
  showSummary: boolean;
  riderPhase: RiderPhase;
  driverNextAction: DriverNextAction;
}

export function tripView(status: TripStatus): TripView {
  const driverVisible =
    status === "DRIVER_ASSIGNED" || status === "DRIVER_ARRIVED" || status === "IN_PROGRESS";
  const cancellable =
    status === "SEARCHING" || status === "DRIVER_ASSIGNED" || status === "DRIVER_ARRIVED";

  let riderPhase: RiderPhase;
  let driverNextAction: DriverNextAction = null;
  switch (status) {
    case "REQUESTED":
      riderPhase = "requested";
      break;
    case "SEARCHING":
      riderPhase = "searching";
      break;
    case "DRIVER_ASSIGNED":
      riderPhase = "assigned";
      driverNextAction = "arrive";
      break;
    case "DRIVER_ARRIVED":
      riderPhase = "arrived";
      driverNextAction = "start";
      break;
    case "IN_PROGRESS":
      riderPhase = "in-progress";
      driverNextAction = "complete";
      break;
    case "COMPLETED":
      riderPhase = "completed";
      break;
    case "CANCELLED":
      riderPhase = "cancelled";
      break;
  }

  return {
    showDriverCard: driverVisible,
    showDriverMarker: driverVisible,
    showCancel: cancellable,
    showSummary: status === "COMPLETED",
    riderPhase,
    driverNextAction,
  };
}

/** Minimum pickup-to-destination distance, in metres, for a bookable trip. */
export const MIN_TRIP_DISTANCE_M = 100;

/** Returns the one non-terminal trip, or null when every trip is COMPLETED or CANCELLED. */
export function findResumableTrip(trips: readonly TripResponse[]): TripResponse | null {
  return trips.find((t) => t.status !== "COMPLETED" && t.status !== "CANCELLED") ?? null;
}

/** True for exactly SEARCHING, DRIVER_ASSIGNED and DRIVER_ARRIVED. */
export function isCancelVisible(status: TripStatus): boolean {
  return tripView(status).showCancel;
}

/** True when pickup and destination are under 100 m apart. */
export function isTooClose(pickup: Place, destination: Place): boolean {
  return distanceMeters(pickup, destination) < MIN_TRIP_DISTANCE_M;
}

export interface BookingState {
  passengerId: string;
  pickup: Place;
  destination: Place;
  rideType: VehicleType;
  paymentMethod: PaymentMethod;
}

/** Builds the `POST /api/trips` body from the booking state. */
export function buildCreateTripRequest(state: BookingState): CreateTripRequest {
  return {
    passengerId: state.passengerId,
    rideType: state.rideType,
    pickupLat: state.pickup.lat,
    pickupLng: state.pickup.lng,
    pickupAddress: state.pickup.address,
    destinationLat: state.destination.lat,
    destinationLng: state.destination.lng,
    destinationAddress: state.destination.address,
    paymentMethod: state.paymentMethod,
  };
}

/** How long a trip may search before the rider is told no driver was found. */
export const NO_DRIVER_TIMEOUT_MS = 5 * 60 * 1000;

/** True when the trip is still unassigned 5 minutes after it was requested. */
export function isNoDriverTimeout(trip: Pick<TripResponse, "status" | "requestedAt">, nowMs: number): boolean {
  if (trip.status !== "SEARCHING" && trip.status !== "REQUESTED") return false;
  const requested = Date.parse(trip.requestedAt);
  return !Number.isNaN(requested) && nowMs - requested >= NO_DRIVER_TIMEOUT_MS;
}

/** Text announced through the `aria-live` region when the trip status changes. */
export function statusAnnouncement(status: TripStatus): string {
  switch (status) {
    case "REQUESTED":
    case "SEARCHING":
      return "Searching for a nearby driver";
    case "DRIVER_ASSIGNED":
      return "A driver has been assigned and is on the way";
    case "DRIVER_ARRIVED":
      return "Your driver has arrived";
    case "IN_PROGRESS":
      return "Your trip has started";
    case "COMPLETED":
      return "Your trip is complete";
    case "CANCELLED":
      return "Your trip was cancelled";
  }
}
