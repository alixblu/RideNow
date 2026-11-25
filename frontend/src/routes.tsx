/**
 * routes.tsx — the route table.
 *
 * - `/`          redirects to the Session's role home, or `/sign-in`
 * - `/sign-in`   SignInScreen; redirects to the role home when a Session exists
 * - `/rider/*`, `/driver/*`, `/admin/*`  lazy per-Role chunks behind `RequireRole`.
 *   Each app component owns its inner Routes and layout, so it is mounted directly.
 * - `*`          NotFoundScreen
 */
import { lazy, Suspense } from "react";
import type { ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { SignInScreen } from "./auth/SignInScreen";
import { SignUpScreen } from "./auth/SignUpScreen";
import { homeRouteFor, resolveTopLevelGuard } from "./identity/guard";
import { RequireRole } from "./identity/RequireRole";
import { useCurrentIdentity } from "./identity/useCurrentIdentity";
import { NotFoundScreen } from "./shared/NotFoundScreen";
import { Skeleton } from "./shared/ui";

const RiderApp = lazy(() => import("./apps/rider/RiderApp"));
const DriverApp = lazy(() =>
  import("./apps/driver/DriverApp").then((m) => ({ default: m.DriverApp })),
);
const AdminApp = lazy(() => import("./apps/admin/AdminApp"));

function RouteSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading"
      className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col gap-4 p-6"
    >
      <Skeleton className="h-8 w-1/2" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}

function Lazy({ children }: { children: ReactNode }) {
  return <Suspense fallback={<RouteSkeleton />}>{children}</Suspense>;
}

function RootRedirect() {
  const { identity } = useCurrentIdentity();
  return <Navigate to={homeRouteFor(identity)} replace />;
}

function SignInRoute() {
  const { identity } = useCurrentIdentity();
  if (identity) return <Navigate to={homeRouteFor(identity)} replace />;
  return <SignInScreen />;
}

function SignUpRoute() {
  const { identity } = useCurrentIdentity();
  if (identity) return <Navigate to={homeRouteFor(identity)} replace />;
  return <SignUpScreen />;
}

/** Redirects to `/sign-in` without a Session (Req 3.1); otherwise renders its children. */
function RequireSession({ children }: { children: ReactNode }) {
  const { identity } = useCurrentIdentity();
  const location = useLocation();
  const decision = resolveTopLevelGuard(identity, location.pathname);
  if (decision.kind === "redirect") return <Navigate to={decision.to} replace />;
  return <>{children}</>;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<RootRedirect />} />
      <Route path="/sign-in" element={<SignInRoute />} />
      <Route path="/sign-up" element={<SignUpRoute />} />
      <Route element={<RequireRole role="rider" />}>
        <Route
          path="/rider/*"
          element={
            <Lazy>
              <RiderApp />
            </Lazy>
          }
        />
      </Route>
      <Route element={<RequireRole role="driver" />}>
        <Route
          path="/driver/*"
          element={
            <Lazy>
              <DriverApp />
            </Lazy>
          }
        />
      </Route>
      <Route element={<RequireRole role="admin" />}>
        <Route
          path="/admin/*"
          element={
            <Lazy>
              <AdminApp />
            </Lazy>
          }
        />
      </Route>
      <Route
        path="*"
        element={
          <RequireSession>
            <NotFoundScreen />
          </RequireSession>
        }
      />
    </Routes>
  );
}
