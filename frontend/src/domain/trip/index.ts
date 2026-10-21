/**
 * Trip domain entry — resolves the trip `Service_Client` from configuration and
 * re-exports the public contract so screens import a single stable module (Req 4.2).
 *
 * `resolveTripClient` delegates to the generic `resolveClient` factory, passing the
 * per-domain mode (`config.clients.trip.mode`) and lazy thunks for the live and mock
 * implementations. Only the selected implementation is constructed, so switching the
 * trip domain between live and mock is purely a configuration change — no screen
 * touches this decision (Req 9.5).
 */
import type { AppConfig } from "../../config/appConfig";
import { resolveClient } from "../clientFactory";
import type { TripServiceClient } from "./contract";
import { createTripLiveClient } from "./liveClient";
import { createTripMockClient } from "./mockClient";

export type {
  CreateTripRequest,
  ListTripsParams,
  Page,
  TripResponse,
  TripServiceClient,
} from "./contract";

/**
 * Resolve the trip `Service_Client` for the given config.
 *
 * @param config the resolved app configuration
 * @returns a `TripServiceClient` — live or mock per `config.clients.trip.mode`
 */
export function resolveTripClient(config: AppConfig): TripServiceClient {
  return resolveClient(
    config.clients.trip.mode,
    createTripLiveClient,
    createTripMockClient,
  );
}
