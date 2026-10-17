import { describe, it, expect, afterEach, vi } from "vitest";
import fc from "fast-check";
import { httpRequest } from "./httpClient";
import type { AppConfig, DomainKey, DomainClientMode } from "../config/appConfig";

/**
 * Property 4: Acting principal equals Current_Identity.
 *
 * Validates: Requirements 2.3.
 *
 * Tag: Feature: ridenow-frontend, Property 4: Acting principal equals Current_Identity
 *
 * The request layer attaches the acting principal — derived from `Current_Identity`
 * (`role:id`) — verbatim as the `X-RideNow-Identity` header whenever the caller
 * supplies one, and omits the header entirely when no principal is supplied. This
 * exercises `httpClient.httpRequest` directly with `fetch` mocked; `httpClient` never
 * imports the identity module, so the principal is passed purely as a plain option.
 *
 * `fetch` is stubbed to capture the `RequestInit` headers; a gateway `apiBaseUrl` is
 * supplied via `options.config` so `resolveUrl` succeeds for the documented path.
 */

// A fixed, valid per-domain client-mode map. httpClient's principal attachment does
// not read client modes; any valid map satisfies the AppConfig shape.
const CLIENTS: Record<DomainKey, DomainClientMode> = {
  driver: { mode: "live" },
  vehicle: { mode: "live" },
  user: { mode: "live" },
  trip: { mode: "mock" },
  matching: { mode: "mock" },
  payment: { mode: "mock" },
  notification: { mode: "mock" },
};

// Gateway mode so resolveUrl always succeeds for the documented test path.
const CONFIG: AppConfig = { apiBaseUrl: "http://gw.test", clients: CLIENTS };

const HEADER = "X-RideNow-Identity";

/** The identity roles the frontend recognizes (identity/types Role). */
const role = fc.constantFrom<"rider" | "driver" | "admin">("rider", "driver", "admin");

/** A non-empty identity id (no colon, so `role:id` stays unambiguous for the test). */
const identityId = fc
  .string({ minLength: 1, maxLength: 24 })
  .filter((s) => s.trim().length > 0 && !s.includes(":"));

/**
 * Stub `fetch`, capturing the `RequestInit` passed on the single call, and return a
 * 200 JSON response so `httpRequest` resolves normally.
 */
function stubFetchCapturing(): { getInit: () => RequestInit | undefined } {
  let captured: RequestInit | undefined;
  const fetchMock = vi.fn((_url: unknown, init?: RequestInit) => {
    captured = init;
    return Promise.resolve(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  return { getInit: () => captured };
}

/**
 * Read a single header value from a captured `RequestInit`, tolerating both a plain
 * `Record<string, string>` (what httpClient builds) and a `Headers` instance.
 */
function headerValue(init: RequestInit | undefined, name: string): string | undefined {
  const headers = init?.headers;
  if (headers === undefined) {
    return undefined;
  }
  if (headers instanceof Headers) {
    return headers.get(name) ?? undefined;
  }
  // In this codebase httpClient builds a plain Record<string, string> headers object.
  return (headers as Record<string, string>)[name];
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Feature: ridenow-frontend, Property 4: Acting principal equals Current_Identity", () => {
  it("attaches X-RideNow-Identity verbatim as the principal derived from Current_Identity", async () => {
    await fc.assert(
      fc.asyncProperty(role, identityId, async (r, id) => {
        const principal = `${r}:${id}`;
        const path = `/api/drivers/${encodeURIComponent(id)}`;

        const { getInit } = stubFetchCapturing();

        await httpRequest(path, { principal, config: CONFIG });

        // The captured outbound request must carry the acting principal verbatim.
        expect(headerValue(getInit(), HEADER)).toBe(principal);
      }),
      { numRuns: 100 },
    );
  });

  it("omits X-RideNow-Identity entirely when no principal is supplied", async () => {
    await fc.assert(
      fc.asyncProperty(identityId, async (id) => {
        const path = `/api/drivers/${encodeURIComponent(id)}`;

        const { getInit } = stubFetchCapturing();

        await httpRequest(path, { config: CONFIG });

        // With no principal option, the identity header must be absent.
        expect(headerValue(getInit(), HEADER)).toBeUndefined();
      }),
      { numRuns: 100 },
    );
  });
});
