// Feature: production-grade-frontend, Property 2: Sign-out clears the Session
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { SESSION_KEY, ROLES, clearSession, loadSession, saveSession } from "./sessionStore";
import type { Identity } from "./types";

function createFakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => (map.has(k) ? (map.get(k) as string) : null),
    key: (i) => Array.from(map.keys())[i] ?? null,
    removeItem: (k) => {
      map.delete(k);
    },
    setItem: (k, v) => {
      map.set(k, String(v));
    },
  };
}

const identityArb: fc.Arbitrary<Identity> = fc.record({
  role: fc.constantFrom(...ROLES),
  id: fc.string({ minLength: 1 }),
});

describe("Property 2: Sign-out clears the Session", () => {
  /** **Validates: Requirements 2.7** */
  it("after saveSession then clearSession, storage has no session and loadSession returns null", () => {
    fc.assert(
      fc.property(identityArb, (identity) => {
        const storage = createFakeStorage();
        saveSession(storage, identity);
        clearSession(storage);
        expect(storage.getItem(SESSION_KEY)).toBeNull();
        expect(loadSession(storage)).toBeNull();
      }),
      { numRuns: 100 },
    );
  });

  it("clearSession on empty storage is a no-op", () => {
    const storage = createFakeStorage();
    clearSession(storage);
    expect(loadSession(storage)).toBeNull();
  });
});
