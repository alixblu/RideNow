/**
 * Matching domain entry point — resolves the active {@link MatchingServiceClient}
 * from configuration via the generic client factory (Req 4.2, 10.3).
 *
 * Matching is a STUBBED domain: only a Mock_Client exists today. The live thunk is a
 * documented placeholder that throws until a real matching-service client is wired,
 * so screens keep importing the same contract and the live/mock swap stays a pure
 * configuration change. The thunks are lazy, so the live placeholder never runs while
 * the domain is configured for mock.
 */
import type { AppConfig } from "../../config/appConfig";
import { resolveClient } from "../clientFactory";
import type { MatchingServiceClient } from "./contract";
import { createMatchingMockClient } from "./mockClient";

export type {
  AssignedDriver,
  MatchResult,
  MatchingServiceClient,
} from "./contract";
export { createMatchingMockClient } from "./mockClient";

/** Resolve the matching Service_Client for the current configuration. */
export function resolveMatchingClient(config: AppConfig): MatchingServiceClient {
  return resolveClient(
    config.clients.matching.mode,
    () => {
      throw new Error("matching live client not implemented");
    },
    () => createMatchingMockClient(),
  );
}
