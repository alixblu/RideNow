/**
 * EmptyState — a "nothing here yet" view with an icon, a message, and an optional
 * call-to-action (Req 3.9).
 *
 * `icon` defaults to an inbox; pass any lucide icon element to illustrate the list.
 * `action` (or children) renders below the message, e.g. a Button.
 */
import type { ReactNode } from "react";
import { Inbox } from "lucide-react";

interface EmptyStateProps {
  /** Short message describing the empty result. */
  message: string;
  /** Optional illustration; defaults to an inbox icon. */
  icon?: ReactNode;
  /** Optional call-to-action, e.g. a Button. */
  action?: ReactNode;
  /** Optional supporting content (kept for existing callers). */
  children?: ReactNode;
}

export function EmptyState({ message, icon, action, children }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl bg-surface-raised/60 px-6 py-10 text-center">
      <span className="text-content-subtle" aria-hidden="true">
        {icon ?? <Inbox className="h-10 w-10" />}
      </span>
      <p className="text-sm text-content-muted">{message}</p>
      {action}
      {children}
    </div>
  );
}
