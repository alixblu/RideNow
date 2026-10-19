/**
 * DevIdentityProvider — the dev-only implementation of the IdentityApi boundary.
 *
 * Holds the Current_Identity for each role in in-memory React state (a per-role map)
 * and renders a small switcher UI: a role selector plus an identifier input (Req 2.1,
 * 2.2). Setting an identifier establishes the Current_Identity for the selected role
 * (Req 2.2). It stores NO tokens, credentials, or sessions and offers no login/signup
 * flow — set/get only (Req 2.6).
 *
 * It must be mounted ABOVE the router (in App) so navigating between the Rider, Driver,
 * and Admin areas never unmounts this provider and the selection survives navigation
 * (Req 1.3).
 *
 * Later, a real auth provider implements the same `IdentityApi` and is mounted here
 * instead, with no change to any screen that consumes `useCurrentIdentity()` (Req 2.5).
 *
 * Restyled as an Uber-like dev account bar on the Tailwind kit. The accessible contract
 * is preserved: the region is labeled "Development identity switcher" with controls
 * labeled "Role" and "Identifier" and a "Set identity" button.
 */
import { useCallback, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { UserCog } from "lucide-react";
import { IdentityContext } from "./IdentityContext";
import type { Identity, IdentityApi, Role } from "./types";
import { Button, Input, Select } from "../shared/ui";

const ROLES: readonly Role[] = ["rider", "driver", "admin"];

/** Per-role map of the Current_Identity; absent key => no identity set yet. */
type IdentityMap = Partial<Record<Role, Identity>>;

interface DevIdentityProviderProps {
  children: ReactNode;
}

export function DevIdentityProvider({ children }: DevIdentityProviderProps) {
  // In-memory only (Req 2.6): never persisted to storage, cookies, or tokens.
  const [identities, setIdentities] = useState<IdentityMap>({});

  const current = useCallback(
    (role: Role): Identity | null => identities[role] ?? null,
    [identities],
  );

  const set = useCallback((identity: Identity): void => {
    setIdentities((prev) => ({ ...prev, [identity.role]: identity }));
  }, []);

  // Recreate the api only when its backing operations change, so consumers of the
  // stable `useCurrentIdentity()` contract are not needlessly re-rendered.
  const api = useMemo<IdentityApi>(() => ({ current, set }), [current, set]);

  return (
    <IdentityContext.Provider value={api}>
      <IdentitySwitcher identities={identities} onSet={set} />
      {children}
    </IdentityContext.Provider>
  );
}

interface IdentitySwitcherProps {
  identities: IdentityMap;
  onSet: (identity: Identity) => void;
}

/**
 * The dev-only switcher UI: pick a role, type an identifier, apply.
 *
 * The draft lives in local component state; only "Set identity" commits it to the
 * provider's in-memory map. Submission is blocked for a blank identifier so an empty
 * Current_Identity can never be established.
 */
function IdentitySwitcher({ identities, onSet }: IdentitySwitcherProps) {
  const [role, setRole] = useState<Role>("rider");
  const [identifier, setIdentifier] = useState("");

  const trimmed = identifier.trim();
  const active = identities[role] ?? null;

  const apply = useCallback(() => {
    if (trimmed.length === 0) {
      return;
    }
    onSet({ role, id: trimmed });
    setIdentifier("");
  }, [onSet, role, trimmed]);

  return (
    <section
      aria-label="Development identity switcher"
      className="bg-surface/60"
    >
      <div className="mx-auto flex max-w-5xl flex-wrap items-end gap-3 px-5 py-2">
        <span className="mr-1 flex items-center gap-1.5 text-xs uppercase tracking-wide text-content-subtle">
          <UserCog className="h-3.5 w-3.5" aria-hidden="true" />
          Acting as
        </span>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-content-subtle">Role</span>
          <Select
            aria-label="Role"
            value={role}
            onChange={(event) => setRole(event.target.value as Role)}
            className="h-9 w-32"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-content-subtle">Identifier</span>
          <Input
            aria-label="Identifier"
            type="text"
            value={identifier}
            placeholder={`${role} id`}
            onChange={(event) => setIdentifier(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                apply();
              }
            }}
            className="h-9 w-48"
          />
        </label>

        <Button size="sm" onClick={apply} disabled={trimmed.length === 0}>
          Set identity
        </Button>

        <span className="text-xs text-content-muted">
          {active ? `Current ${role}: ${active.id}` : `No ${role} identity set`}
        </span>
      </div>
    </section>
  );
}
