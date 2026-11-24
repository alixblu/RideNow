/**
 * SessionIdentityProvider — IdentityApi implementation backed by a persisted Session.
 *
 * State is initialized lazily from localStorage so a valid Session is restored on the
 * first render. If storage is unavailable or throws (private mode), it falls back to
 * in-memory state.
 */
import { useCallback, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { IdentityContext } from "./IdentityContext";
import { clearSession, loadSession, saveSession } from "./sessionStore";
import type { Identity, IdentityApi, Role } from "./types";

function getStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

interface SessionIdentityProviderProps {
  children: ReactNode;
}

export function SessionIdentityProvider({ children }: SessionIdentityProviderProps) {
  const [identity, setIdentity] = useState<Identity | null>(() => {
    const storage = getStorage();
    if (storage === null) {
      return null;
    }
    try {
      return loadSession(storage);
    } catch {
      return null;
    }
  });

  const signIn = useCallback((next: Identity): void => {
    const storage = getStorage();
    if (storage !== null) {
      try {
        saveSession(storage, next);
      } catch {
        // in-memory fallback
      }
    }
    setIdentity(next);
  }, []);

  const signOut = useCallback((): void => {
    const storage = getStorage();
    if (storage !== null) {
      try {
        clearSession(storage);
      } catch {
        // in-memory fallback
      }
    }
    setIdentity(null);
  }, []);

  const current = useCallback(
    (role: Role): Identity | null => (identity !== null && identity.role === role ? identity : null),
    [identity],
  );

  const api = useMemo<IdentityApi>(
    () => ({ identity, signIn, signOut, current }),
    [identity, signIn, signOut, current],
  );

  return <IdentityContext.Provider value={api}>{children}</IdentityContext.Provider>;
}
