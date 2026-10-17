/**
 * Vehicle domain entry point.
 *
 * Re-exports the contract and exposes `resolveVehicleClient(config)`, the single place
 * screens obtain a `VehicleServiceClient`. It delegates to the generic `resolveClient`
 * factory, passing the vehicle domain's configured mode plus lazy thunks for the Live
 * and Mock implementations, so swapping the vehicle domain between live and mock is a
 * configuration change with no screen edits (Req 4.2).
 */
import type { AppConfig } from "../../config/appConfig";
import { resolveClient } from "../clientFactory";
import { createVehicleLiveClient } from "./liveClient";
import { createVehicleMockClient } from "./mockClient";
import type { VehicleServiceClient } from "./contract";

export type {
  CreateVehicleRequest,
  VehicleResponse,
  VehicleServiceClient,
} from "./contract";

/**
 * Resolve the vehicle Service_Client for the given config. The chosen implementation is
 * selected purely from `config.clients.vehicle.mode`; the thunks are lazy, so only the
 * selected client is ever constructed.
 */
export function resolveVehicleClient(config: AppConfig): VehicleServiceClient {
  return resolveClient(
    config.clients.vehicle.mode,
    createVehicleLiveClient,
    createVehicleMockClient,
  );
}
