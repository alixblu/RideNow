/**
 * Shared enums — the string-literal union types that mirror the backend's enum
 * contracts, plus the allowed-value lists and type-guard helpers that forms and
 * selectors use to restrict input (Req 6.3, 7.1).
 *
 * The union types match the inspected driver-service records and the documented
 * trip/payment contracts exactly (design: "Typed models and DTOs"). The companion
 * `*_VALUES` arrays are the single source of truth for "what values are allowed",
 * so selectors can render options from them and the `is*` guards can validate a
 * candidate string against the same list. These guards back Property 6: a string
 * validates as a `VehicleType` only if it is MOTORBIKE or CAR, and as a
 * `DriverStatus` only if it is ACTIVE or SUSPENDED.
 */

// ---------------------------------------------------------------------------
// Union types (exact, per design).
// ---------------------------------------------------------------------------

export type DriverStatus = "ACTIVE" | "SUSPENDED";

export type VehicleType = "MOTORBIKE" | "CAR";

export type TripStatus =
  | "REQUESTED"
  | "SEARCHING"
  | "DRIVER_ASSIGNED"
  | "DRIVER_ARRIVED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "CANCELLED";

export type PaymentStatus = "PENDING" | "PROCESSING" | "PAID" | "FAILED";

// ---------------------------------------------------------------------------
// Allowed-value lists — the single source of truth selectors render from.
// `as const` keeps each entry a literal so the arrays stay assignable to their
// union type and selectors get precise option types.
// ---------------------------------------------------------------------------

export const DRIVER_STATUS_VALUES = ["ACTIVE", "SUSPENDED"] as const;

export const VEHICLE_TYPE_VALUES = ["MOTORBIKE", "CAR"] as const;

export const TRIP_STATUS_VALUES = [
  "REQUESTED",
  "SEARCHING",
  "DRIVER_ASSIGNED",
  "DRIVER_ARRIVED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
] as const;

export const PAYMENT_STATUS_VALUES = [
  "PENDING",
  "PROCESSING",
  "PAID",
  "FAILED",
] as const;

// ---------------------------------------------------------------------------
// Type-guard / validation helpers (back Property 6).
// Each accepts an unknown candidate and narrows to the union type only when the
// value is one of the allowed literals.
// ---------------------------------------------------------------------------

export function isDriverStatus(value: unknown): value is DriverStatus {
  return (
    typeof value === "string" &&
    (DRIVER_STATUS_VALUES as readonly string[]).includes(value)
  );
}

export function isVehicleType(value: unknown): value is VehicleType {
  return (
    typeof value === "string" &&
    (VEHICLE_TYPE_VALUES as readonly string[]).includes(value)
  );
}

export function isTripStatus(value: unknown): value is TripStatus {
  return (
    typeof value === "string" &&
    (TRIP_STATUS_VALUES as readonly string[]).includes(value)
  );
}

export function isPaymentStatus(value: unknown): value is PaymentStatus {
  return (
    typeof value === "string" &&
    (PAYMENT_STATUS_VALUES as readonly string[]).includes(value)
  );
}
