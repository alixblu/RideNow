/**
 * useCurrentIdentity — the ONLY surface screens use to read or set the identity.
 *
 * This hook is the stable contract (design: "Identity module boundary"). It returns
 * the `IdentityApi` supplied by whatever provider is mounted above the router, so a
 * screen that calls `current(role)` / `set(identity)` keeps working unchanged when
 * the dev switcher is later replaced by real authentication (Req 2.5).
 *
 * It throws when no provider is mounted so a misconfiguration surfaces immediately
 * during development instead of a confusing null-identity screen.
 */
import { useContext } from "react";
import { IdentityContext } from "./IdentityContext";
import type { IdentityApi } from "./types";

export function useCurrentIdentity(): IdentityApi {
  const api = useContext(IdentityContext);
  if (api === null) {
    throw new Error(
      "useCurrentIdentity must be used within an identity provider " +
        "(e.g. DevIdentityProvider) mounted above the router.",
    );
  }
  return api;
}
