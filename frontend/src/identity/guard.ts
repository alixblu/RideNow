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

export const SIGN_UP_PATH = "/sign-up";

const PUBLIC_PATHS: readonly string[] = [SIGN_IN_PATH, SIGN_UP_PATH];

function normalizePath(path: string): string {
  const cut = path.search(/[?#]/);
  const bare = cut === -1 ? path : path.slice(0, cut);
  return bare.length > 1 ? bare.replace(/\/+$/, "") : bare;
}

/** True only for `/sign-in` and `/sign-up` (query, hash and trailing slash ignored). */
export function isPublicPath(path: string): boolean {
  return PUBLIC_PATHS.includes(normalizePath(path));
}

/** The role whose area owns `path` (`/rider`, `/driver`, `/admin` and sub-paths), or null. */
function requiredRoleFor(path: string): Role | null {
  const p = normalizePath(path);
  for (const role of ["rider", "driver", "admin"] as const) {
    const base = `/${role}`;
    if (p === base || p.startsWith(`${base}/`)) return role;
  }
  return null;
}

/**
 * Top-level guard for every route.
 * - No Session: only public paths are allowed, everything else goes to sign-in.
 * - Session: role areas require the matching role, otherwise redirect to the Session's home.
 */
export function resolveTopLevelGuard(identity: Identity | null, path: string): GuardDecision {
  if (identity === null) {
    return isPublicPath(path) ? { kind: "allow" } : { kind: "redirect", to: SIGN_IN_PATH };
  }
  const required = requiredRoleFor(path);
  if (required === null) return { kind: "allow" };
  return resolveGuard(identity, required);
}

/** Allow only when a Session exists and its role equals `requiredRole`. */
export function resolveGuard(identity: Identity | null, requiredRole: Role): GuardDecision {
  if (identity === null) return { kind: "redirect", to: SIGN_IN_PATH };
  if (identity.role === requiredRole) return { kind: "allow" };
  return { kind: "redirect", to: homeRouteFor(identity) };
}
