import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { resolveUrl } from "./resolveUrl";
import { ApiError } from "./ApiError";
import type { AppConfig, DomainKey, DomainClientMode } from "../config/appConfig";

/**
 * Property 10: URL resolution follows active configuration.
 *
 * Validates: Requirements 3.2, 3.3, 3.5.
 *
 * Tag: Feature: ridenow-frontend, Property 10: URL resolution follows active configuration
 */

// A fixed, valid per-domain client-mode map. resolveUrl ignores client modes
// entirely (it only reads apiBaseUrl + the Path_Prefix_Map), so any valid map works.
const CLIENTS: Record<DomainKey, DomainClientMode> = {
  driver: { mode: "live" },
  vehicle: { mode: "live" },
  user: { mode: "live" },
  trip: { mode: "mock" },
  matching: { mode: "mock" },
  payment: { mode: "mock" },
  notification: { mode: "mock" },
};

function configWith(apiBaseUrl: string | null): AppConfig {
  return { apiBaseUrl, clients: CLIENTS };
}

// Documented path prefixes that resolve to a real service origin in fallback mode.
// Each entry: the prefix and the origin the longest-matching rule must select.
const LIVE_PREFIXES: ReadonlyArray<{ prefix: string; origin: string }> = [
  { prefix: "/api/drivers", origin: "http://localhost:8080" },
  { prefix: "/api/vehicles", origin: "http://localhost:8080" },
  { prefix: "/api/users", origin: "http://localhost:8081" },
  { prefix: "/api/trips", origin: "http://localhost:8082" },
  { prefix: "/api/trip-offers", origin: "http://localhost:8082" },
  { prefix: "/api/payments", origin: "http://localhost:8083" },
];

// Documented null-placeholder prefixes: matched in fallback mode but with no origin.
const NULL_PREFIXES: ReadonlyArray<string> = [
  "/api/matching",
  "/api/notifications",
];

// A path-tail generator producing documented sub-paths like "", "/{id}", "/{id}/vehicles".
// Segments stay within unreserved URL characters so comparisons are exact.
const pathTail = fc
  .array(fc.stringMatching(/^[A-Za-z0-9_-]{1,12}$/), { minLength: 0, maxLength: 3 })
  .map((segments) => segments.map((s) => "/" + s).join(""));

// A valid gateway origin generator: scheme + host + optional port, no trailing slash.
const gatewayOrigin = fc
  .record({
    scheme: fc.constantFrom("http", "https"),
    host: fc.stringMatching(/^[a-z][a-z0-9-]{0,20}(\.[a-z][a-z0-9-]{0,20}){0,2}$/),
    port: fc.option(fc.integer({ min: 1, max: 65535 }), { nil: null }),
  })
  .map(({ scheme, host, port }) =>
    port === null ? `${scheme}://${host}` : `${scheme}://${host}:${port}`,
  );

describe("Feature: ridenow-frontend, Property 10: URL resolution follows active configuration", () => {
  it("gateway mode: resolves to apiBaseUrl (trailing slash trimmed) + the path unchanged", () => {
    fc.assert(
      fc.property(
        gatewayOrigin,
        fc.constantFrom(...LIVE_PREFIXES, ...NULL_PREFIXES.map((p) => ({ prefix: p, origin: "" }))),
        pathTail,
        fc.boolean(),
        (origin, entry, tail, withTrailingSlash) => {
          const path = entry.prefix + tail;
          // A trailing slash on the base must be trimmed, never producing "//".
          const base = withTrailingSlash ? origin + "/" : origin;
          const config = configWith(base);

          const resolved = resolveUrl(path, config);

          // Origin is exactly apiBaseUrl with any single trailing slash removed,
          // and the documented path is preserved verbatim.
          expect(resolved).toBe(origin + path);
          // Guard against the double-slash join bug regardless of trailing slash.
          expect(resolved.slice(origin.length)).toBe(path);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("fallback mode: resolves to the origin of the longest matching prefix (drivers/vehicles -> 8080, users -> 8081)", () => {
    fc.assert(
      fc.property(fc.constantFrom(...LIVE_PREFIXES), pathTail, (entry, tail) => {
        const path = entry.prefix + tail;
        const config = configWith(null);

        const resolved = resolveUrl(path, config);

        expect(resolved).toBe(entry.origin + path);
      }),
      { numRuns: 200 },
    );
  });

  it("fallback mode: a matched null-placeholder prefix throws ApiError.unavailable", () => {
    fc.assert(
      fc.property(fc.constantFrom(...NULL_PREFIXES), pathTail, (prefix, tail) => {
        const path = prefix + tail;
        const config = configWith(null);

        let thrown: unknown;
        try {
          resolveUrl(path, config);
        } catch (err) {
          thrown = err;
        }

        expect(thrown).toBeInstanceOf(ApiError);
        expect((thrown as ApiError).code).toBe("UNAVAILABLE");
        expect((thrown as ApiError).status).toBe(503);
      }),
      { numRuns: 200 },
    );
  });
});
