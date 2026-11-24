/**
 * Property 6: Not-found destination.
 *
 * For any unknown path and any session state, the not-found screen's navigation
 * target equals homeRouteFor(identity): the Role's home when a Session exists,
 * `/sign-in` otherwise.
 *
 * **Validates: Requirements 1.6**
 */
import { render, screen, within, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import fc from "fast-check";
import { SessionIdentityProvider } from "./identity/SessionIdentityProvider";
import { saveSession } from "./identity/sessionStore";
import { homeRouteFor } from "./identity/guard";
import type { Identity } from "./identity/types";
import { AppRoutes } from "./routes";

const KNOWN_FIRST_SEGMENTS = new Set(["rider", "driver", "admin", "sign-in", "role"]);

const segment = fc.stringMatching(/^[a-zA-Z0-9_-]{1,24}$/);

const unknownPath = fc
  .tuple(
    segment.filter((s) => !KNOWN_FIRST_SEGMENTS.has(s)),
    fc.array(segment, { maxLength: 3 }),
  )
  .map(([first, rest]) => "/" + [first, ...rest].join("/"));

const sessionState = fc.option(
  fc.record({
    role: fc.constantFrom("rider" as const, "driver" as const, "admin" as const),
    id: fc.stringMatching(/^[a-zA-Z0-9-]{1,16}$/),
  }),
  { nil: null },
);

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("Feature: production-grade-frontend, Property 6: Not-found destination", () => {
  it("links to homeRouteFor(identity) for any unknown path and session state", () => {
    fc.assert(
      fc.property(unknownPath, sessionState, (path, session: Identity | null) => {
        cleanup();
        localStorage.clear();
        if (session) saveSession(localStorage, session);

        render(
          <MemoryRouter initialEntries={[path]}>
            <SessionIdentityProvider>
              <AppRoutes />
            </SessionIdentityProvider>
          </MemoryRouter>,
        );

        const notFound = screen.getByRole("alert");
        expect(within(notFound).getByText(/page not found/i)).toBeInTheDocument();
        const links = within(notFound).getAllByRole("link");
        expect(links).toHaveLength(1);
        expect(links[0]!.getAttribute("href")).toBe(homeRouteFor(session));
      }),
      { numRuns: 100 },
    );
  });
});
