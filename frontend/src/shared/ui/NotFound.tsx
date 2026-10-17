/**
 * NotFound — the catch-all not-found view (Req 1.4).
 *
 * Rendered by the catch-all `*` route when a user requests a path that matches no
 * application route. It MUST include at least one visible navigation control that
 * returns the user to a valid application area (browser-back is not sufficient), so it
 * renders explicit links to each of the three areas. Restyled on Tailwind tokens; the
 * `role="alert"` and the three area links are preserved for tests.
 */
import { Link } from "react-router-dom";
import { Compass } from "lucide-react";

const AREAS = [
  { to: "/rider", label: "Go to Rider" },
  { to: "/driver", label: "Go to Driver" },
  { to: "/admin", label: "Go to Admin" },
] as const;

export function NotFound() {
  return (
    <div
      role="alert"
      className="mx-auto flex max-w-md flex-col items-center gap-4 rounded-2xl border border-border bg-surface px-6 py-12 text-center"
    >
      <Compass className="h-10 w-10 text-content-subtle" aria-hidden="true" />
      <div>
        <h2 className="text-xl font-semibold text-content">Page not found</h2>
        <p className="mt-1 text-sm text-content-muted">
          The page you requested does not exist.
        </p>
      </div>
      <nav
        aria-label="Return to a valid area"
        className="flex flex-wrap items-center justify-center gap-2"
      >
        {AREAS.map((area) => (
          <Link
            key={area.to}
            to={area.to}
            className="rounded-xl border border-border px-3.5 py-2 text-sm font-medium text-content hover:border-content-subtle"
          >
            {area.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
