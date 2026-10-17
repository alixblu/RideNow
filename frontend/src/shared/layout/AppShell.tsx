/**
 * AppShell — the App_Shell chrome: top app bar + area nav + <Outlet/>.
 *
 * Presents the three selectable areas (Rider, Driver, Admin) as nav links (Req 1.1).
 * Each entry is a `NavLink`, so React Router sets `aria-current="page"` on the active
 * entry and we add a bold accent pill as the visible active-area indicator (Req 1.2).
 * The matched area's screen renders in the `<Outlet/>` below.
 *
 * The Identity_Switcher is provided by `DevIdentityProvider`, mounted ABOVE this shell
 * (in App.tsx) so it survives navigation and preserves the Current_Identity across
 * areas (Req 1.3). The switcher chrome therefore renders above this bar.
 *
 * Uber-style, dark-first, mobile-first: a compact app bar with the wordmark and the
 * theme toggle, a horizontally scrollable area nav on small screens, and a centered
 * max-width content column.
 */
import { NavLink, Outlet } from "react-router-dom";
import { Car } from "lucide-react";
import { ThemeToggle, cn } from "../ui";

const AREAS = [
  { to: "/rider", label: "Rider" },
  { to: "/driver", label: "Driver" },
  { to: "/admin", label: "Admin" },
] as const;

export function AppShell() {
  return (
    <div className="min-h-full bg-bg text-content">
      <header className="sticky top-0 z-30 border-b border-border bg-bg/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3 sm:gap-6">
          <span className="flex items-center gap-2 text-lg font-bold tracking-tight">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-accent text-accent-fg">
              <Car className="h-5 w-5" aria-hidden="true" />
            </span>
            RideNow
          </span>

          <nav
            aria-label="Application areas"
            className="flex flex-1 items-center gap-1 overflow-x-auto"
          >
            {AREAS.map((area) => (
              <NavLink
                key={area.to}
                to={area.to}
                className={({ isActive }) =>
                  cn(
                    "whitespace-nowrap rounded-xl px-3.5 py-2 text-sm font-semibold transition-colors",
                    isActive
                      ? "bg-accent text-accent-fg"
                      : "text-content-muted hover:bg-surface-raised hover:text-content",
                  )
                }
              >
                {area.label}
              </NavLink>
            ))}
          </nav>

          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
