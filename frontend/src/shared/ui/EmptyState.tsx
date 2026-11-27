/**
 * EmptyState — a "nothing here yet" view with an icon, an optional title, a message,
 * and an optional call-to-action (Req 3.9, 4.5).
 *
 * Layout order matches ErrorState: icon, title, message, then action/children.
 * `icon` defaults to an inbox; pass any lucide icon element to illustrate the list.
 */
import type { ReactNode } from "react";
import { Inbox } from "lucide-react";

interface EmptyStateProps {
  /** Short message describing the empty result. */
  message: string;
  /** Optional heading shown between the icon and the message. */
  title?: string;
  /** Optional illustration; defaults to an inbox icon. */
  icon?: ReactNode;
  /** Optional call-to-action, e.g. a Button. */
  action?: ReactNode;
  /** Optional supporting content (kept for existing callers). */
  children?: ReactNode;
}

export function EmptyState({ message, title, icon, action, children }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl bg-surface px-6 py-10 text-center shadow-card">
      <span className="text-content-subtle" aria-hidden="true">
        {icon ?? <Inbox className="h-10 w-10" />}
      </span>
      {title ? <h3 className="text-base font-bold text-content">{title}</h3> : null}
      <p className="text-sm text-content-muted">{message}</p>
      {action}
      {children}
    </div>
  );
}
