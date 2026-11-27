/**
 * AdminLayout — the Admin_Dashboard frame (Req 6.1, 6.6).
 *
 * At a Desktop_Viewport (>= 1024 px) a persistent sidebar sits left of the content.
 * Below that the sidebar collapses into a drawer opened from a menu button in the
 * top bar. The top bar always shows the admin's name and a sign-out control.
 */
import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { LayoutDashboard, Menu, Route as RouteIcon, X } from "lucide-react";
import { Car, CreditCard, Users } from "lucide-react";
import { SIGN_IN_PATH } from "../../identity/guard";
import { mockProfiles } from "../../domain/seed/people";
import { useCurrentIdentity } from "../../identity/useCurrentIdentity";
import { Avatar, Button, cn } from "../../shared/ui";

const DESKTOP_QUERY = "(min-width: 1024px)";

export const ADMIN_NAV = [
  { to: "/admin", label: "Overview", end: true, icon: <LayoutDashboard className="h-5 w-5" /> },
  { to: "/admin/trips", label: "Trips", end: false, icon: <RouteIcon className="h-5 w-5" /> },
  { to: "/admin/drivers", label: "Drivers", end: false, icon: <Car className="h-5 w-5" /> },
  { to: "/admin/riders", label: "Riders", end: false, icon: <Users className="h-5 w-5" /> },
  { to: "/admin/payments", label: "Payments", end: false, icon: <CreditCard className="h-5 w-5" /> },
] as const;

/** Tracks whether the viewport is a Desktop_Viewport; assumes desktop without matchMedia. */
function useIsDesktop(): boolean {
  const supported = typeof window !== "undefined" && typeof window.matchMedia === "function";
  const [desktop, setDesktop] = useState<boolean>(() =>
    supported ? window.matchMedia(DESKTOP_QUERY).matches : true,
  );
  useEffect(() => {
    if (!supported) return;
    const mql = window.matchMedia(DESKTOP_QUERY);
    const onChange = () => setDesktop(mql.matches);
    onChange();
    mql.addEventListener?.("change", onChange);
    return () => mql.removeEventListener?.("change", onChange);
  }, [supported]);
  return desktop;
}

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="Admin">
      <ul className="flex flex-col gap-1">
        {ADMIN_NAV.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              end={item.end}
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  "flex h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold transition-colors",
                  isActive
                    ? "bg-accent/10 text-accent"
                    : "text-content-muted hover:bg-surface-raised hover:text-content",
                )
              }
            >
              <span aria-hidden="true" className="shrink-0">
                {item.icon}
              </span>
              {item.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function AdminLayout() {
  const { identity, signOut } = useCurrentIdentity();
  const navigate = useNavigate();
  const location = useLocation();
  const isDesktop = useIsDesktop();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Close the drawer on navigation and when the viewport becomes desktop.
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname, isDesktop]);

  const profile = mockProfiles.admin.find((p) => p.userId === identity?.id);
  const name = profile?.name ?? "Admin";

  const handleSignOut = () => {
    signOut();
    navigate(SIGN_IN_PATH, { replace: true });
  };

  return (
    <div className="flex h-dvh bg-surface-raised/40 text-content">
      {isDesktop ? (
        <aside
          data-testid="admin-sidebar"
          className="flex w-60 shrink-0 flex-col gap-6 bg-surface p-4 shadow-card"
        >
          <div className="px-3 pt-2 text-lg font-extrabold text-accent">RideNow Admin</div>
          <SidebarNav />
        </aside>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center gap-3 bg-surface px-4 shadow-card">
          {!isDesktop ? (
            <Button
              variant="ghost"
              aria-label="Open menu"
              aria-expanded={drawerOpen}
              onClick={() => setDrawerOpen(true)}
              leftIcon={<Menu className="h-5 w-5" />}
            />
          ) : null}
          <div className="flex-1" />
          <Avatar name={name} size="sm" />
          <span className="text-sm font-semibold" data-testid="admin-name">
            {name}
          </span>
          <Button variant="secondary" size="sm" onClick={handleSignOut}>
            Sign out
          </Button>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>

      {!isDesktop && drawerOpen ? (
        <div className="fixed inset-0 z-40 flex">
          <div
            data-testid="admin-drawer-backdrop"
            className="absolute inset-0 bg-scrim/40"
            onClick={() => setDrawerOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Navigation menu"
            data-testid="admin-drawer"
            className="relative flex w-64 max-w-[80vw] flex-col gap-6 bg-surface p-4 shadow-card"
          >
            <div className="flex items-center justify-between px-3 pt-2">
              <span className="text-lg font-extrabold text-accent">RideNow Admin</span>
              <Button
                variant="ghost"
                size="sm"
                aria-label="Close menu"
                onClick={() => setDrawerOpen(false)}
                leftIcon={<X className="h-5 w-5" />}
              />
            </div>
            <SidebarNav onNavigate={() => setDrawerOpen(false)} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
