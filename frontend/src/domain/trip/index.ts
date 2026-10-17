/**
 * Trip domain entry — resolves the trip `Service_Client` from configuration and
 * re-exports the public contract so screens import a single stable module (Req 4.2).
 *
 * The trip domain is STUBBED: no trip-service exists, so the live thunk cannot build a
 * real client. It throws a clear "not implemented" error, which the generic
 * `resolveClient` only ever invokes if the trip domain were explicitly configured
 * `live` — the default is `mock`, so the mock thunk runs and returns the in-memory
 * client. When a trip-service lands, this live thunk is the one place that becomes a
 * `createTripLiveClient()` call; no screen changes (Req 9.5).
 */
import type { AppConfig } from "../../config/appConfig";
import { resolveClient } from "../clientFactory";
import type { TripServiceClient } from "./contract";
import { createTripMockClient } from "./mockClient";

export type {
  CreateTripRequest,
  TripResponse,
  TripServiceClient,
} from "./contract";

/**
 * Resolve the trip `Service_Client` for the given config.
 *
 * @param config the resolved app configuration
 * @returns the trip Mock_Client (default), or throws if forced to `live` while the
 *          trip-service does not yet exist.
 */
export function resolveTripClient(config: AppConfig): TripServiceClient {
  return resolveClient(
    config.clients.trip.mode,
    () => {
      throw new Error("trip live client not implemented");
    },
    () => createTripMockClient(),
  );
}
