/**
 * Driver domain entry point.
 *
 * Re-exports the contract and exposes `resolveDriverClient(config)`, the single place
 * screens obtain a `DriverServiceClient`. It delegates to the generic `resolveClient`
 * factory, passing the driver domain's configured mode plus lazy thunks for the Live
 * and Mock implementations, so swapping the driver domain between live and mock is a
 * configuration change with no screen edits (Req 4.2).
 */
import type { AppConfig } from "../../config/appConfig";
import { resolveClient } from "../clientFactory";
import { createDriverLiveClient } from "./liveClient";
import { createDriverMockClient } from "./mockClient";
import type { DriverServiceClient } from "./contract";

export type {
  CreateDriverRequest,
  DriverResponse,
  DriverServiceClient,
} from "./contract";

/**
 * Resolve the driver Service_Client for the given config. The chosen implementation is
 * selected purely from `config.clients.driver.mode`; the thunks are lazy, so only the
 * selected client is ever constructed.
 */
export function resolveDriverClient(config: AppConfig): DriverServiceClient {
  return resolveClient(
    config.clients.driver.mode,
    createDriverLiveClient,
    createDriverMockClient,
  );
}
