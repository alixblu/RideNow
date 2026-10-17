/**
 * Matching Mock_Client — in-memory stub that conforms to {@link MatchingServiceClient}
 * (Req 10.2, 10.3). It models matching as a deterministic resolution: the first time a
 * trip's match state is read it is still SEARCHING with no assigned driver, and every
 * subsequent read resolves to DRIVER_ASSIGNED with a stable assigned-driver summary.
 *
 * This backs Property 17: whenever the result's status is DRIVER_ASSIGNED, its
 * `assignedDriver` is guaranteed non-null. The per-trip call count is tracked in an
 * in-memory map so the transition is deterministic per `tripId` and stable across
 * reads (the same trip always yields the same assigned driver once resolved).
 */
import type {
  AssignedDriver,
  MatchResult,
  MatchingServiceClient,
} from "./contract";

/** Build a stable assigned driver for a given trip id. */
function assignedDriverFor(tripId: string): AssignedDriver {
  const driverId = `driver-${tripId}`;
  const vehicleId = `vehicle-${tripId}`;
  return {
    driverId,
    vehicleId,
    summary: `Driver ${driverId} in vehicle ${vehicleId} assigned to trip ${tripId}`,
  };
}

/**
 * Create a fresh matching Mock_Client with its own in-memory call-count store.
 *
 * First `getMatchState(tripId)` for a trip returns SEARCHING / null; subsequent
 * calls return DRIVER_ASSIGNED with a non-null assigned driver.
 */
export function createMatchingMockClient(): MatchingServiceClient {
  // tripId → number of times getMatchState has been called for it.
  const calls = new Map<string, number>();

  return {
    async getMatchState(tripId: string): Promise<MatchResult> {
      const seen = calls.get(tripId) ?? 0;
      calls.set(tripId, seen + 1);

      if (seen === 0) {
        // First observation: matching still in progress.
        return { tripId, status: "SEARCHING", assignedDriver: null };
      }

      // Resolved: a driver is assigned. assignedDriver is always non-null here,
      // so status DRIVER_ASSIGNED implies a populated assignedDriver (Property 17).
      return {
        tripId,
        status: "DRIVER_ASSIGNED",
        assignedDriver: assignedDriverFor(tripId),
      };
    },
  };
}
