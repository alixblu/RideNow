/**
 * UserDetail — renders every field of a `UserResponse` (Req 8.3).
 *
 * Shared by the create-user success view and the user-detail lookup so a user record is
 * presented the same way wherever it appears. It renders all contract fields — id,
 * cognitoSub, email, phone, fullName, avatarUrl, status, and both timestamps — showing
 * an explicit "—" for the nullable `phone`/`avatarUrl` fields. Restyled on the Tailwind kit.
 */
import type { ReactNode } from "react";
import type { UserResponse } from "../../domain/user";
import { StatusPill } from "../../shared/ui";

interface UserDetailProps {
  user: UserResponse;
}

/** Display a nullable string, falling back to an em dash when absent. */
function show(value: string | null): string {
  return value === null || value === "" ? "—" : value;
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b border-border/60 last:border-0">
      <dt className="text-sm text-content-subtle">{label}</dt>
      <dd className="text-sm text-content text-right break-all">{value}</dd>
    </div>
  );
}

export function UserDetail({ user }: UserDetailProps) {
  return (
    <div className="rounded-2xl border border-border bg-surface-raised p-5" aria-label="User detail">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold">{user.fullName}</h3>
        <StatusPill status={user.status} />
      </div>
      <dl className="mt-3">
        <Row label="ID" value={user.id} />
        <Row label="Cognito sub" value={user.cognitoSub} />
        <Row label="Email" value={user.email} />
        <Row label="Phone" value={show(user.phone)} />
        <Row label="Full name" value={user.fullName} />
        <Row label="Avatar URL" value={show(user.avatarUrl)} />
        <Row label="Created at" value={user.createdAt} />
        <Row label="Updated at" value={user.updatedAt} />
      </dl>
    </div>
  );
}
