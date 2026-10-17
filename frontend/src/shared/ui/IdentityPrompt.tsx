/**
 * IdentityPrompt — the "set your identity" guard (Req 2.4).
 *
 * Screens that require an acting principal wrap their content in this guard. While no
 * Current_Identity is set for the given role, it renders a prompt directing the user to
 * the Identity_Switcher in the shell chrome instead of the role-specific action. Once an
 * identity exists for the role, it renders `children` unchanged.
 *
 * It reads the identity only through the stable `useCurrentIdentity()` contract, so the
 * guard keeps working when the dev switcher is later replaced by real auth (Req 2.5).
 * Restyled on Tailwind tokens; the `role="status"` prompt text ("set your … identity")
 * is preserved for tests.
 */
import type { ReactNode } from "react";
import { UserCircle2 } from "lucide-react";
import { useCurrentIdentity } from "../../identity/useCurrentIdentity";
import type { Role } from "../../identity/types";

interface IdentityPromptProps {
  /** The role whose Current_Identity must be set before showing `children`. */
  role: Role;
  /** Content shown once an identity exists for `role`. */
  children: ReactNode;
}

export function IdentityPrompt({ role, children }: IdentityPromptProps) {
  const identity = useCurrentIdentity();

  if (identity.current(role) === null) {
    return (
      <div
        role="status"
        className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-surface/60 px-6 py-10 text-center"
      >
        <UserCircle2 className="h-9 w-9 text-content-subtle" aria-hidden="true" />
        <p className="max-w-xs text-sm text-content-muted">
          Set your <strong className="text-content">{role}</strong> identity using the
          switcher above before performing {role} actions.
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
