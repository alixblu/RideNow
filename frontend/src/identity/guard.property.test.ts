/**
 * Feature: production-grade-frontend, Property 5: Route guard decision
 *
 * **Validates: Requirements 1.5, 2.1**
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { SIGN_IN_PATH, homeRouteFor, resolveGuard } from "./guard";
import type { Identity, Role } from "./types";

const roleArb = fc.constantFrom<Role>("rider", "driver", "admin");
const identityArb: fc.Arbitrary<Identity> = fc.record({
  role: roleArb,
  id: fc.string({ minLength: 1 }),
});
const sessionArb = fc.option(identityArb, { nil: null });

describe("Property 5: Route guard decision", () => {
  it("allows iff a Session exists and its Role equals the required Role; otherwise redirects correctly", () => {
    fc.assert(
      fc.property(sessionArb, roleArb, (session, required) => {
        const decision = resolveGuard(session, required);
        if (session === null) {
          expect(decision).toEqual({ kind: "redirect", to: SIGN_IN_PATH });
        } else if (session.role === required) {
          expect(decision).toEqual({ kind: "allow" });
        } else {
          expect(decision).toEqual({ kind: "redirect", to: homeRouteFor(session) });
        }
        expect(decision.kind === "allow").toBe(session !== null && session.role === required);
      }),
      { numRuns: 100 },
    );
  });
});
