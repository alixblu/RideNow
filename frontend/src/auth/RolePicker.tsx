/**
 * RolePicker — three Roles, and for the selected Role a list of mock profiles.
 * Selecting a profile calls `signIn` then navigates to the Role's home route
 * (Req 2.5, 2.6). Without phone state it redirects to the sign-in screen (Req 2.1).
 */
import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { Avatar, Card } from "../shared/ui";
import { cn } from "../shared/ui/cn";
import { homeRouteFor, SIGN_IN_PATH } from "../identity/guard";
import { mockProfiles } from "../identity/mockProfiles";
import type { SeedProfile } from "../identity/mockProfiles";
import type { Role } from "../identity/types";
import { useCurrentIdentity } from "../identity/useCurrentIdentity";

const ROLES: readonly { role: Role; label: string }[] = [
  { role: "rider", label: "Rider" },
  { role: "driver", label: "Driver" },
  { role: "admin", label: "Admin" },
];

function describe(profile: SeedProfile): string {
  if (profile.role === "driver" && profile.vehicle) {
    return `${profile.vehicle.model} · ${profile.vehicle.plate}`;
  }
  if (profile.role === "admin") return "Operations admin";
  return "Rider";
}

export function RolePicker() {
  const location = useLocation();
  const navigate = useNavigate();
  const { signIn } = useCurrentIdentity();
  const [role, setRole] = useState<Role>("rider");

  const state = location.state as { phone?: unknown } | null;
  if (!state || typeof state.phone !== "string" || state.phone === "") {
    return <Navigate to={SIGN_IN_PATH} replace />;
  }

  function choose(profile: SeedProfile) {
    const identity = { role: profile.role, id: profile.userId };
    signIn(identity);
    navigate(homeRouteFor(identity), { replace: true });
  }

  return (
    <main
      data-touch
      className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col gap-6 px-6 py-10"
    >
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-extrabold text-content">Choose how to continue</h1>
        <p className="text-content-muted">Pick a role, then a profile to sign in as.</p>
      </header>
      <div role="group" aria-label="Role" className="grid grid-cols-3 gap-2">
        {ROLES.map(({ role: r, label }) => (
          <button
            key={r}
            type="button"
            aria-pressed={role === r}
            onClick={() => setRole(r)}
            className={cn(
              "min-h-11 rounded-xl px-3 text-sm font-semibold transition-colors",
              role === r
                ? "bg-accent text-accent-fg"
                : "bg-surface-raised text-content hover:bg-border",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <ul className="flex flex-col gap-3" aria-label={`${role} profiles`}>
        {mockProfiles[role].map((profile) => (
          <li key={profile.userId}>
            <Card className="p-0">
              <button
                type="button"
                onClick={() => choose(profile)}
                className="flex min-h-14 w-full items-center gap-4 rounded-2xl p-4 text-left hover:bg-surface-raised"
              >
                <Avatar name={profile.name} />
                <span className="flex flex-col">
                  <span className="font-semibold text-content">{profile.name}</span>
                  <span className="text-sm text-content-muted">{describe(profile)}</span>
                </span>
              </button>
            </Card>
          </li>
        ))}
      </ul>
    </main>
  );
}
