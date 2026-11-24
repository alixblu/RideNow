/**
 * sessionStore — pure Session persistence over an injected `Storage`.
 *
 * Tests inject a fake Storage; the provider passes `localStorage`.
 */
import type { Identity, Role } from "./types";

export const SESSION_KEY = "ridenow.session.v1";

export const ROLES: readonly Role[] = ["rider", "driver", "admin"];

export function isIdentity(value: unknown): value is Identity {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    typeof v.role === "string" &&
    (ROLES as readonly string[]).includes(v.role) &&
    typeof v.id === "string" &&
    v.id.length > 0
  );
}

/** Returns the stored Session, or null. A malformed stored value is deleted. */
export function loadSession(storage: Storage): Identity | null {
  const raw = storage.getItem(SESSION_KEY);
  if (raw === null) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isIdentity(parsed)) {
      return { role: parsed.role, id: parsed.id };
    }
  } catch {
    // fall through to deletion
  }
  storage.removeItem(SESSION_KEY);
  return null;
}

export function saveSession(storage: Storage, identity: Identity): void {
  storage.setItem(SESSION_KEY, JSON.stringify({ role: identity.role, id: identity.id }));
}

export function clearSession(storage: Storage): void {
  storage.removeItem(SESSION_KEY);
}
