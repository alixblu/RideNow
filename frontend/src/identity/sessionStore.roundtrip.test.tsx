import { afterEach, describe, expect, it } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import fc from "fast-check";
import { SessionIdentityProvider } from "./SessionIdentityProvider";
import { loadSession, saveSession } from "./sessionStore";
import { useCurrentIdentity } from "./useCurrentIdentity";
import type { Identity, Role } from "./types";

/**
 * Feature: production-grade-frontend, Property 1: Session round trip
 *
 * **Validates: Requirements 2.6, 2.8**
 *
 * For any valid Identity, saveSession then loadSession returns an equal Identity, and a
 * provider constructed over that storage exposes it as the current identity without any
 * sign-in step.
 */

const wrapper = ({ children }: { children: ReactNode }) => (
  <SessionIdentityProvider>{children}</SessionIdentityProvider>
);

const role = fc.constantFrom<Role>("rider", "driver", "admin");
const identityArb: fc.Arbitrary<Identity> = fc.record({
  role,
  id: fc.string({ minLength: 1 }),
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("Feature: production-grade-frontend, Property 1: Session round trip", () => {
  it("saveSession then loadSession returns an equal Identity", () => {
    fc.assert(
      fc.property(identityArb, (identity) => {
        localStorage.clear();
        saveSession(localStorage, identity);
        expect(loadSession(localStorage)).toEqual(identity);
      }),
      { numRuns: 100 },
    );
  });

  it("a provider over that storage exposes the saved identity without sign-in", () => {
    fc.assert(
      fc.property(identityArb, (identity) => {
        localStorage.clear();
        saveSession(localStorage, identity);

        const { result, unmount } = renderHook(() => useCurrentIdentity(), { wrapper });
        try {
          expect(result.current.identity).toEqual(identity);
          expect(result.current.current(identity.role)).toEqual(identity);
        } finally {
          unmount();
        }
      }),
      { numRuns: 100 },
    );
  });
});
