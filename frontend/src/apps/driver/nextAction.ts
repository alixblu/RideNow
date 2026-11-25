/**
 * Pure mapping from a trip status to the driver's single primary button (Req 10.7).
 */
import type { TripStatus } from "../../shared/enums";

export type DriverAction = "arrive" | "start" | "complete";

export interface NextAction {
  action: DriverAction;
  label: string;
}

/** DRIVER_ASSIGNED, DRIVER_ARRIVED and IN_PROGRESS map to one action; every other status maps to null. */
export function driverNextAction(status: TripStatus): NextAction | null {
  switch (status) {
    case "DRIVER_ASSIGNED":
      return { action: "arrive", label: "I have arrived" };
    case "DRIVER_ARRIVED":
      return { action: "start", label: "Start trip" };
    case "IN_PROGRESS":
      return { action: "complete", label: "Complete trip" };
    default:
      return null;
  }
}
