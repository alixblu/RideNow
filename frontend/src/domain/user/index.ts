/**
 * User domain entry point — resolves the active `UserServiceClient` from config.
 *
 * `resolveUserClient` delegates to the generic `resolveClient` factory, passing the
 * per-domain mode (`config.clients.user.mode`) and lazy thunks for the live and mock
 * implementations. Only the selected implementation is constructed, so switching the
 * user domain between live and mock is purely a configuration change — no screen
 * touches this decision (Req 4.2).
 *
 * Re-exports the contract types so screens can import everything user-related from this
 * single module.
 */
import type { AppConfig } from "../../config/appConfig";
import { resolveClient } from "../clientFactory";
import type { UserServiceClient } from "./contract";
import { createUserLiveClient } from "./liveClient";
import { createUserMockClient } from "./mockClient";

export type {
  CreateUserRequest,
  UserResponse,
  UserServiceClient,
  UserStatus,
} from "./contract";

/**
 * Resolve the user Service_Client for the given configuration.
 *
 * @param config the resolved app configuration (defaults to the app singleton)
 * @returns a `UserServiceClient` — live or mock per `config.clients.user.mode`
 */
export function resolveUserClient(config: AppConfig): UserServiceClient {
  return resolveClient(
    config.clients.user.mode,
    createUserLiveClient,
    createUserMockClient,
  );
}
