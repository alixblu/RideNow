/**
 * Pure route-guard logic. `RequireRole` applies the decision in the router.
 */
import type { Identity, Role } from "./types";

export const SIGN_IN_PATH = "/sign-in";

export type GuardDecision = { kind: "allow" } | { kind: "redirect"; to: string };

/** Home route for a Session's role, or the sign-in path when signed out. */
export function homeRouteFor(identity: Identity | null): string {
  if (identity === null) return SIGN_IN_PATH;
  switch (identity.role) {
    case "rider":
      return "/rider";
    case "driver":
      return "/driver";
    case "admin":
      return "/admin";
    default:
      return SIGN_IN_PATH;
  }
}

/** Allow only when a Session exists and its role equals `requiredRole`. */
export function resolveGuard(identity: Identity | null, requiredRole: Role): GuardDecision {
  if (identity === null) return { kind: "redirect", to: SIGN_IN_PATH };
  if (identity.role === requiredRole) return { kind: "allow" };
  return { kind: "redirect", to: homeRouteFor(identity) };
}
