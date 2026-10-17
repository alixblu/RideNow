/**
 * EmptyState — a neutral "nothing here yet" view (e.g. Req 12.2).
 *
 * Rendered when a successful request returns no items (such as a notifications list
 * with no entries). Deliberately plain so empty live and stubbed screens look
 * identical and carry no mock/live marker (Req 4.5). Restyled on Tailwind tokens.
 */
import type { ReactNode } from "react";
import { Inbox } from "lucide-react";

interface EmptyStateProps {
  /** Short message describing the empty result. */
  message: string;
  /** Optional supporting content (e.g. a call-to-action). */
  children?: ReactNode;
}

export function EmptyState({ message, children }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-surface/50 px-6 py-10 text-center">
      <Inbox className="h-8 w-8 text-content-subtle" aria-hidden="true" />
      <p className="text-sm text-content-muted">{message}</p>
      {children}
    </div>
  );
}
