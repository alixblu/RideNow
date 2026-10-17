/**
 * clientFactory — the single generic Live/Mock selection point (Req 4.2).
 *
 * Each domain's `resolve<Domain>Client(config)` entry delegates here, passing its
 * per-domain mode plus two thunks: one that builds the `Live_Client` and one that
 * builds the `Mock_Client`. `resolveClient` picks the implementation purely from the
 * configured mode and returns it, so switching a domain between live and mock is a
 * configuration change — no screen touches this decision (design: "Service_Client
 * contract pattern").
 *
 * The thunks are lazy on purpose: only the chosen implementation is constructed, so a
 * mock-only (stubbed) domain never instantiates a `Live_Client` that would need an
 * origin it does not have yet.
 */
import type { ClientMode } from "../config/appConfig";

/**
 * Select a Service_Client implementation by per-domain config.
 *
 * @param mode  the resolved mode for this domain ("live" or "mock")
 * @param live  thunk constructing the Live_Client (invoked only when mode === "live")
 * @param mock  thunk constructing the Mock_Client (invoked otherwise)
 * @returns the chosen implementation; both thunks produce the same contract type `T`
 */
export function resolveClient<T>(mode: ClientMode, live: () => T, mock: () => T): T {
  return mode === "live" ? live() : mock();
}
