/** Route guard component: renders the nested route or redirects per `resolveGuard`. */
import { Navigate, Outlet } from "react-router-dom";
import { resolveGuard } from "./guard";
import type { Role } from "./types";
import { useCurrentIdentity } from "./useCurrentIdentity";

export function RequireRole({ role }: { role: Role }) {
  const { identity } = useCurrentIdentity();
  const decision = resolveGuard(identity, role);
  if (decision.kind === "redirect") {
    return <Navigate to={decision.to} replace />;
  }
  return <Outlet />;
}
