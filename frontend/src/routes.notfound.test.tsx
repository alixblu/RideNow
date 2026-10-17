/**
 * Property test for Property 2: Unknown routes resolve to not-found (Req 1.4).
 *
 * For any requested path that does NOT match a defined application route, the
 * App_Shell must render the not-found view AND provide at least one visible
 * navigation control that returns the user to a valid application area.
 *
 * The app is rendered under MemoryRouter with a generated initial entry, wrapping
 * <DevIdentityProvider><AppRoutes/></DevIdentityProvider> — mirroring App.tsx's
 * composition (which App.test.tsx exercises indirectly). We generate first segments
 * that cannot collide with the known valid top-level routes ("/", "/rider",
 * "/driver", "/admin" and their subpaths), optionally appending extra random
 * segments, so every generated path is guaranteed to fall through to the catch-all
 * "*" route.
 */
import { render, screen, within, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, afterEach } from "vitest";
import fc from "fast-check";
import { DevIdentityProvider } from "./identity/DevIdentityProvider";
import { AppRoutes } from "./routes";

// Top-level segments that DO map to a real area; generated paths must avoid these
// as their first segment so they resolve to the catch-all not-found route.
const VALID_FIRST_SEGMENTS = new Set(["rider", "driver", "admin"]);

// A URL path segment: word-ish characters only, kept simple so it is a clean,
// unambiguous single path segment (no slashes, no router-special characters).
const segment = fc
  .stringMatching(/^[a-zA-Z0-9_-]+$/)
  .filter((s) => s.length > 0 && s.length <= 24);

// A requested path guaranteed NOT to match any defined route: a first segment that
// is non-empty and not one of the valid areas, plus zero or more extra segments.
const unknownPath = fc
  .tuple(
    segment.filter((s) => !VALID_FIRST_SEGMENTS.has(s)),
    fc.array(segment, { maxLength: 3 }),
  )
  .map(([first, rest]) => "/" + [first, ...rest].join("/"));

const VALID_AREA_HREFS = ["/rider", "/driver", "/admin"];

afterEach(() => {
  cleanup();
});

describe("Feature: ridenow-frontend, Property 2: Unknown routes resolve to not-found", () => {
  it("renders the not-found view with at least one visible control back to a valid area", () => {
    fc.assert(
      fc.property(unknownPath, (path) => {
        cleanup();
        render(
          <MemoryRouter initialEntries={[path]}>
            <DevIdentityProvider>
              <AppRoutes />
            </DevIdentityProvider>
          </MemoryRouter>,
        );

        // The not-found view is shown: it is an alert region naming the failure.
        const notFound = screen.getByRole("alert");
        expect(notFound).toBeInTheDocument();
        expect(within(notFound).getByText(/page not found/i)).toBeInTheDocument();

        // It provides at least one visible navigation control back to a valid area:
        // the not-found view itself renders explicit links to /rider, /driver, /admin.
        const links = within(notFound).getAllByRole("link");
        expect(links.length).toBeGreaterThan(0);

        const targets = links.map((link) => link.getAttribute("href"));
        const backToValidArea = targets.filter((href) =>
          VALID_AREA_HREFS.includes(href ?? ""),
        );
        expect(backToValidArea.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );
  });
});
