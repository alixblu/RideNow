import { describe, it, expect, afterEach, vi } from "vitest";
import fc from "fast-check";
import { httpRequest } from "./httpClient";
import { ApiError, type ApiErrorCode } from "./ApiError";
import type { AppConfig, DomainKey, DomainClientMode } from "../config/appConfig";

/**
 * Property 12: Client errors are sanitized.
 *
 * Validates: Requirements 5.5, 6.6, 13.2.
 *
 * Tag: Feature: ridenow-frontend, Property 12: Client errors are sanitized
 *
 * For any backend error payload — including bodies containing stack-trace-like or
 * persistence-internal text — the ApiError the request layer produces must:
 *   - preserve ONLY a curated, human-readable message (the backend's `message`
 *     field) or a safe default, and
 *   - never contain stack traces or persistence internals, and
 *   - map the HTTP status to the correct short code (404/409/400/503).
 *
 * `fetch` is mocked so no backend is required; a gateway `apiBaseUrl` is supplied via
 * `options.config` so `resolveUrl` succeeds for a documented path.
 */

// A fixed, valid per-domain client-mode map. httpClient's error handling does not
// read client modes; any valid map satisfies the AppConfig shape.
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
const PATH = "/api/drivers/123";

// Status -> expected ApiError code mapping the client guarantees.
const STATUS_TO_CODE: ReadonlyArray<{ status: number; code: ApiErrorCode }> = [
  { status: 404, code: "NOT_FOUND" },
  { status: 409, code: "CONFLICT" },
  { status: 400, code: "VALIDATION" },
  { status: 503, code: "UNAVAILABLE" },
];

// The safe-default messages the ApiError factories fall back to when no curated
// message is available. These are allowed outputs; raw bodies are not.
const SAFE_DEFAULTS: ReadonlyArray<string> = [
  "The requested item could not be found.",
  "That request conflicts with existing data.",
  "The submitted data is invalid.",
  "The service is currently unavailable. Please try again.",
  "The request could not be completed.",
];

// ---- Generators for toxic text that must NEVER leak into a user-facing message ----

// Java-style stack trace frames, e.g. "at com.foo.Bar.baz(Bar.java:42)".
const stackFrame = fc
  .record({
    pkg: fc.stringMatching(/^[a-z]{2,6}(\.[a-z]{2,6}){1,3}$/),
    cls: fc.stringMatching(/^[A-Z][A-Za-z]{2,10}$/),
    method: fc.stringMatching(/^[a-z][A-Za-z]{2,10}$/),
    line: fc.integer({ min: 1, max: 9999 }),
  })
  .map(({ pkg, cls, method, line }) => `\tat ${pkg}.${cls}.${method}(${cls}.java:${line})`);

const stackTrace = fc
  .record({
    exception: fc.constantFrom(
      "java.lang.NullPointerException",
      "java.lang.IllegalStateException",
      "java.lang.RuntimeException",
    ),
    detail: fc.stringMatching(/^[A-Za-z0-9 ]{0,20}$/),
    frames: fc.array(stackFrame, { minLength: 1, maxLength: 5 }),
  })
  .map(({ exception, detail, frames }) =>
    [`${exception}: ${detail}`, ...frames].join("\n"),
  );

// Persistence / ORM internals, e.g. Hibernate SQL, constraint names.
const persistenceInternal = fc.constantFrom(
  "org.hibernate.exception.ConstraintViolationException: could not execute statement",
  "org.postgresql.util.PSQLException: ERROR: duplicate key value violates unique constraint \"drivers_license_number_key\"",
  "could not execute statement [ERROR: duplicate key]; SQL [n/a]; constraint [uk_driver_license]",
  "org.springframework.dao.DataIntegrityViolationException: could not execute statement",
  "Hibernate: insert into drivers (license_number, user_id) values (?, ?)",
);

const toxicText = fc.oneof(stackTrace, persistenceInternal);

// A clean, curated message a backend's GlobalExceptionHandler would surface.
const curatedMessage = fc.stringMatching(/^[A-Za-z][A-Za-z0-9 .,'-]{3,60}$/);

// Mock a single fetch call returning a Response with the given status/body.
function stubFetchOnce(status: number, body: string): void {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(body, { status, headers: { "Content-Type": "application/json" } }),
  );
  vi.stubGlobal("fetch", fetchMock);
}

// Assert a thrown value is an ApiError whose message leaks none of the toxic text.
function expectSanitized(thrown: unknown, toxic: string): ApiError {
  expect(thrown).toBeInstanceOf(ApiError);
  const err = thrown as ApiError;

  // No stack-frame / persistence markers in the surfaced message.
  expect(err.message).not.toContain(toxic);
  expect(err.message).not.toContain("\tat ");
  expect(err.message).not.toMatch(/\n\s*at /);
  expect(err.message.toLowerCase()).not.toContain("hibernate");
  expect(err.message.toLowerCase()).not.toContain("exception");
  expect(err.message.toLowerCase()).not.toContain("sql");
  expect(err.message.toLowerCase()).not.toContain("constraint");
  expect(err.message).not.toContain("org.");
  expect(err.message).not.toContain(".java:");

  return err;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Feature: ridenow-frontend, Property 12: Client errors are sanitized", () => {
  it("valid ApiErrorResponse with a curated message plus noisy trace/exception fields: surfaces only the curated message", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...STATUS_TO_CODE),
        curatedMessage,
        toxicText,
        async ({ status, code }, clean, toxic) => {
          // A well-formed backend body whose curated `message` is clean, but which
          // also carries noisy fields a careless handler might have leaked.
          const body = JSON.stringify({
            timestamp: "2024-01-01T00:00:00Z",
            status,
            error: "Error",
            message: clean,
            path: PATH,
            trace: toxic,
            exception: toxic,
          });
          stubFetchOnce(status, body);

          let thrown: unknown;
          try {
            await httpRequest(PATH, { config: CONFIG });
          } catch (err) {
            thrown = err;
          }

          const apiError = expectSanitized(thrown, toxic);
          // The curated message is preserved exactly (trimmed), and the status maps
          // to the documented short code.
          expect(apiError.message).toBe(clean.trim());
          expect(apiError.code).toBe(code);
          expect(apiError.status).toBe(status);
        },
      ),
      { numRuns: 150 },
    );
  });

  it("non-JSON body containing a raw stack trace: surfaces a safe default, never the raw text", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...STATUS_TO_CODE),
        toxicText,
        async ({ status, code }, toxic) => {
          // A raw, non-JSON error body (e.g. an unhandled 500-style dump or HTML page)
          // that is pure stack trace / persistence internals.
          stubFetchOnce(status, toxic);

          let thrown: unknown;
          try {
            await httpRequest(PATH, { config: CONFIG });
          } catch (err) {
            thrown = err;
          }

          const apiError = expectSanitized(thrown, toxic);
          // With no parseable curated message, the message must be a safe default.
          expect(SAFE_DEFAULTS).toContain(apiError.message);
          expect(apiError.code).toBe(code);
          expect(apiError.status).toBe(status);
        },
      ),
      { numRuns: 150 },
    );
  });

  it("valid JSON ApiErrorResponse with NO message field but noisy fields: surfaces a safe default", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...STATUS_TO_CODE),
        toxicText,
        async ({ status, code }, toxic) => {
          // Well-formed JSON but the curated `message` is absent; the only text is
          // toxic. The client must not fall back to any of that.
          const body = JSON.stringify({
            timestamp: "2024-01-01T00:00:00Z",
            status,
            error: "Error",
            path: PATH,
            trace: toxic,
          });
          stubFetchOnce(status, body);

          let thrown: unknown;
          try {
            await httpRequest(PATH, { config: CONFIG });
          } catch (err) {
            thrown = err;
          }

          const apiError = expectSanitized(thrown, toxic);
          expect(SAFE_DEFAULTS).toContain(apiError.message);
          expect(apiError.code).toBe(code);
        },
      ),
      { numRuns: 150 },
    );
  });

  it("status -> code mapping holds for 404/409/400/503", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...STATUS_TO_CODE),
        fc.option(curatedMessage, { nil: undefined }),
        async ({ status, code }, maybeMessage) => {
          const body = JSON.stringify({
            timestamp: "2024-01-01T00:00:00Z",
            status,
            error: "Error",
            message: maybeMessage,
            path: PATH,
          });
          stubFetchOnce(status, body);

          let thrown: unknown;
          try {
            await httpRequest(PATH, { config: CONFIG });
          } catch (err) {
            thrown = err;
          }

          expect(thrown).toBeInstanceOf(ApiError);
          expect((thrown as ApiError).code).toBe(code);
          expect((thrown as ApiError).status).toBe(status);
        },
      ),
      { numRuns: 120 },
    );
  });
});
