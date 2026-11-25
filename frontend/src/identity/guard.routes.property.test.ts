/**
 * Feature: frontend-booking-and-password-login, Property 7: The route guard
 * redirects exactly the paths that require a Session
 *
 * **Validates: Requirements 3.1, 3.14**
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { resolveTopLevelGuard } from "./guard";
import type { Identity } from "./types";

// Independent oracle: the bare path (no query/hash/trailing slash) is a public path.
function isPublicByOracle(path: string): boolean {
  const bare = (path.split(/[?#]/)[0] ?? "").replace(/\/+$/, "");
  return bare === "/sign-in" || bare === "/sign-up";
}

const pathArb = fc.oneof(
  fc.string(),
  fc.webPath(),
  fc.constantFrom("/", "/rider", "/driver", "/admin", "/sign-in", "/sign-up", "/sign-in/", "/sign-up?x=1"),
);

const nonPublicPathArb = pathArb.filter((p) => !isPublicByOracle(p));
const publicPathArb = fc.constantFrom("/sign-in", "/sign-up", "/sign-in/", "/sign-up/", "/sign-in?next=/rider", "/sign-up#top");

const adminPathArb = fc.oneof(
  fc.constant("/admin"),
  fc.webPath().map((p) => `/admin${p === "/" ? "" : p}`),
);

const nonAdminIdentityArb: fc.Arbitrary<Identity> = fc.record({
  role: fc.constantFrom("rider" as const, "driver" as const),
  id: fc.string({ minLength: 1 }),
});

describe("Property 7: route guard redirects exactly the paths that require a Session", () => {
  it("with no Session, redirects every non-public path to /sign-in", () => {
    fc.assert(
      fc.property(nonPublicPathArb, (path) => {
        expect(resolveTopLevelGuard(null, path)).toEqual({ kind: "redirect", to: "/sign-in" });
      }),
      { numRuns: 100 },
    );
  });

  it("with no Session, allows /sign-in and /sign-up", () => {
    fc.assert(
      fc.property(publicPathArb, (path) => {
        expect(resolveTopLevelGuard(null, path)).toEqual({ kind: "allow" });
      }),
      { numRuns: 100 },
    );
  });

  it("redirects a rider or driver Session on any /admin path to that role's home", () => {
    fc.assert(
      fc.property(nonAdminIdentityArb, adminPathArb, (identity, path) => {
        expect(resolveTopLevelGuard(identity, path)).toEqual({
          kind: "redirect",
          to: identity.role === "rider" ? "/rider" : "/driver",
        });
      }),
      { numRuns: 100 },
    );
  });
});
