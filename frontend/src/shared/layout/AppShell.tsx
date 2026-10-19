/**
 * AppShell — the App_Shell chrome: an editorial masthead + area nav + <Outlet/>.
 *
 * Presents the three areas (Rider, Driver, Admin) as nav links (Req 1.1). Each is a
 * `NavLink`, so React Router sets `aria-current="page"` on the active entry; the active
 * treatment is an understated ink underline rather than a filled accent pill, matching
 * the warm editorial language (Req 1.2). The matched area renders in the `<Outlet/>`.
 *
 * The Identity_Switcher is provided by `DevIdentityProvider`, mounted ABOVE this shell
 * (in App.tsx) so it survives navigation and preserves the Current_Identity across
 * areas (Req 1.3); its chrome renders above this masthead.
 *
 * Warm, dark-first, hairline-led: a serif wordmark, a thin underrule, a left-aligned
 * nav, and the theme toggle at the end. Content sits in a centered reading column.
 */
import { NavLink, Outlet } from "react-router-dom";
import { ThemeToggle, cn } from "../ui";

const AREAS = [
  { to: "/rider", label: "Rider" },
  { to: "/driver", label: "Driver" },
  { to: "/admin", label: "Admin" },
] as const;

export function AppShell() {
  return (
    <div className="min-h-full bg-bg text-content">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-5xl items-center gap-8 px-5 py-4">
          <span className="font-serif text-xl font-semibold tracking-tight">
            RideNow
            <span className="text-accent">.</span>
          </span>

          <nav aria-label="Application areas" className="flex flex-1 items-center gap-6">
            {AREAS.map((area) => (
              <NavLink
                key={area.to}
                to={area.to}
                className={({ isActive }) =>
                  cn(
                    "relative whitespace-nowrap py-1 text-sm transition-colors",
                    isActive
                      ? "font-medium text-content after:absolute after:-bottom-[1.05rem] after:left-0 after:h-px after:w-full after:bg-accent"
                      : "text-content-subtle hover:text-content",
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

      <main className="mx-auto max-w-5xl px-5 py-8">
        <Outlet />
      </main>
    </div>
  );
}
