/**
 * Matching domain contract — STUBBED (mock only today).
 *
 * This is the single documented shape the Mock_Client implements now and a future
 * Live_Client will implement unchanged (Req 10.3), so screens depend only on this
 * interface and never on which implementation is active. The matching flow reports
 * how a trip progresses from searching for a driver to having one assigned.
 *
 * Types are exactly as specified in the design ("Typed models and DTOs"):
 *   - AssignedDriver { driverId, vehicleId, summary }
 *   - MatchResult    { tripId, status, assignedDriver }
 * `TripStatus` is imported from the shared enums so matching speaks the same trip
 * lifecycle vocabulary as the trip domain. While matching is in progress the status
 * is SEARCHING and `assignedDriver` is null; once matching resolves the status is
 * DRIVER_ASSIGNED and `assignedDriver` is populated (Req 10.2).
 */
import type { TripStatus } from "../../shared/enums";

// ---------------------------------------------------------------------------
// Response types — field names and types match the design exactly.
// ---------------------------------------------------------------------------

/** The driver chosen for a trip, with a short human-readable summary. */
export interface AssignedDriver {
  driverId: string;
  vehicleId: string;
  summary: string;
}

/**
 * The current matching state for a trip. `assignedDriver` is null while the match
 * is still SEARCHING and non-null once the status reaches DRIVER_ASSIGNED.
 */
export interface MatchResult {
  tripId: string;
  status: TripStatus;
  assignedDriver: AssignedDriver | null;
}

// ---------------------------------------------------------------------------
// Service_Client contract — identical for the Mock_Client and a future Live_Client.
// ---------------------------------------------------------------------------

export interface MatchingServiceClient {
  /** Current matching state for a trip; transitions SEARCHING → DRIVER_ASSIGNED. */
  getMatchState(tripId: string): Promise<MatchResult>;
}
