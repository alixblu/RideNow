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
import { IdentityPrompt, cn } from "../../shared/ui";
import { CreateUserScreen } from "./CreateUserScreen";
import { UserDetailScreen } from "./UserDetailScreen";

const SUBNAV = [
  { to: "users/new", label: "New account" },
  { to: "users/lookup", label: "Look up" },
] as const;

export function AdminConsole() {
  return (
    <section aria-label="Admin area" className="flex flex-col gap-6">
      <header>
        <h2 className="font-serif text-3xl font-semibold tracking-tight">Accounts</h2>
        <p className="mt-1 text-sm text-content-muted">
          Create rider and user accounts, and pull up a record when you need it.
        </p>
      </header>

      <IdentityPrompt role="admin">
        <nav
          aria-label="Admin screens"
          className="flex gap-6 overflow-x-auto border-b border-border"
        >
          {SUBNAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  "-mb-px whitespace-nowrap border-b-2 pb-2.5 text-sm transition-colors",
                  isActive
                    ? "border-accent font-medium text-content"
                    : "border-transparent text-content-subtle hover:text-content",
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="mt-6">
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
