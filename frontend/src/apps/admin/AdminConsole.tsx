/**
 * AdminConsole — the Admin_Console area (Req 8.1–8.3, 8.5).
 *
 * Presents the two user-service surfaces the backend provides — create-user and
 * get-user — and nothing else (Req 8.5). All admin actions stay wrapped in the admin
 * identity guard for continuity with the former placeholder (Req 2.4): until an admin
 * Current_Identity is set, the "set your identity" prompt shows instead of the screens.
 *
 * In-area navigation uses nested routes under `admin/*` (this area is mounted at
 * `admin/*` in `routes.tsx`). A sub-nav switches between the create form and the detail
 * lookup; the index redirects to the create screen. No mock/live marker (Req 4.5).
 * Restyled Uber-style on the Tailwind kit.
 */
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { UserPlus, Search } from "lucide-react";
import { IdentityPrompt, cn } from "../../shared/ui";
import { CreateUserScreen } from "./CreateUserScreen";
import { UserDetailScreen } from "./UserDetailScreen";

const SUBNAV = [
  { to: "users/new", label: "Create user", icon: UserPlus },
  { to: "users/lookup", label: "Find user", icon: Search },
] as const;

export function AdminConsole() {
  return (
    <section aria-label="Admin area" className="flex flex-col gap-5">
      <header>
        <h2 className="text-2xl font-bold tracking-tight">Admin</h2>
        <p className="text-sm text-content-muted">Register and inspect user accounts.</p>
      </header>

      <IdentityPrompt role="admin">
        <nav
          aria-label="Admin screens"
          className="flex gap-1 overflow-x-auto rounded-2xl border border-border bg-surface p-1"
        >
          {SUBNAV.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    "flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-semibold transition-colors",
                    isActive
                      ? "bg-accent text-accent-fg"
                      : "text-content-muted hover:bg-surface-raised hover:text-content",
                  )
                }
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {item.label}
              </NavLink>
            );
          })}
        </nav>

        <div className="mt-5">
          <Routes>
            <Route index element={<Navigate to="users/new" replace />} />
            <Route path="users/new" element={<CreateUserScreen />} />
            <Route path="users/lookup" element={<UserDetailScreen />} />
          </Routes>
        </div>
      </IdentityPrompt>
    </section>
  );
}
