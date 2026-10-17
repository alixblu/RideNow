/**
 * Loading — the shared loading indicator for a screen area (Req 13.1).
 *
 * TanStack Query exposes `isPending` per query; screens render this while a request is
 * in flight so the affected area shows a consistent, accessible indicator. Restyled on
 * Tailwind tokens; the `role="status"` + label contract is preserved for tests.
 */
import { Loader2 } from "lucide-react";

interface LoadingProps {
  /** Optional label announced to assistive tech and shown beside the spinner. */
  label?: string;
}

export function Loading({ label = "Loading…" }: LoadingProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-3 py-6 text-content-muted"
    >
      <Loader2 className="h-5 w-5 animate-spin text-accent" aria-hidden="true" />
      <span className="text-sm">{label}</span>
    </div>
  );
}
