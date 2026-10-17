/**
 * routes.tsx — the App_Shell route table.
 *
 * main.tsx mounts a `BrowserRouter`, so routing is expressed with `<Routes>` /
 * `<Route>` (not `createBrowserRouter`). The shape mirrors the design's "App-shell
 * composition and routing":
 *
 *  - `/`            → AppShell (nav + active indicator + <Outlet/>), with children:
 *  - index          → redirect to `/rider` (Req 1.2 default area)
 *  - `rider/*`      → Rider_App subtree
 *  - `driver/*`     → Driver_App subtree
 *  - `admin/*`      → Admin_Console subtree
 *  - `*`            → NotFound catch-all (Req 1.4)
 *
 * The `/*` suffix on each area gives each app its own nested subtree, so the full
 * screens added in tasks 11/12/18 can declare their own inner routes without
 * touching this table.
 */
import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./shared/layout";
import { NotFound } from "./shared/ui";
import { RiderApp } from "./apps/rider/RiderApp";
import { DriverApp } from "./apps/driver/DriverApp";
import { AdminConsole } from "./apps/admin/AdminConsole";

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<AppShell />}>
        <Route index element={<Navigate to="/rider" replace />} />
        <Route path="rider/*" element={<RiderApp />} />
        <Route path="driver/*" element={<DriverApp />} />
        <Route path="admin/*" element={<AdminConsole />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
