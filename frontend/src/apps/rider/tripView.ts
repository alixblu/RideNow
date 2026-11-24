/**
 * Pure mapping from a trip status to what the Rider and Driver apps show.
 * Used by the booking sheet, the driver lifecycle button, and tests.
 */
import type { TripStatus } from "../../shared/enums";

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
