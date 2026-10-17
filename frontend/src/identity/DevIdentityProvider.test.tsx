import { describe, it, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import fc from "fast-check";
import { DevIdentityProvider } from "./DevIdentityProvider";
import { useCurrentIdentity } from "./useCurrentIdentity";
import type { Role } from "./types";

/**
 * Property 3: Identity set/get round-trip.
 *
 * Validates: Requirements 2.2, 2.5.
 *
 * Tag: Feature: ridenow-frontend, Property 3: Identity set/get round-trip
 *
 * For any role and any non-empty identifier string, setting the identity through the
 * identity module (DevIdentityProvider's IdentityApi, read via the stable
 * useCurrentIdentity() contract) and then reading current(role) returns the same
 * role and id.
 */

const wrapper = ({ children }: { children: ReactNode }) => (
  <DevIdentityProvider>{children}</DevIdentityProvider>
);

// Roles are restricted to the three defined values (Req 2.1).
const role = fc.constantFrom<Role>("rider", "driver", "admin");

// The provider trims identifiers and rejects blanks, so generate ids that remain
// non-empty after trimming. The map keeps the trimmed value, so assert against it.
const nonBlankId = fc
  .string({ minLength: 1 })
  .filter((s) => s.trim().length > 0);

describe("Feature: ridenow-frontend, Property 3: Identity set/get round-trip", () => {
  it("set(identity) then current(role) returns the same role and id", () => {
    fc.assert(
      fc.property(role, nonBlankId, (r, rawId) => {
        const id = rawId.trim();

        const { result } = renderHook(() => useCurrentIdentity(), { wrapper });

        act(() => {
          result.current.set({ role: r, id });
        });

        expect(result.current.current(r)).toEqual({ role: r, id });
      }),
      { numRuns: 100 },
    );
  });
});
