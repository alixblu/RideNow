/**
 * Unavailable — the service-unavailable view with a Retry action (Req 13.3).
 *
 * Shown when a request fails because the target service is unreachable (network
 * failure, timeout, 503, or a null placeholder origin). The Retry button invokes the
 * supplied `onRetry` callback — screens wire this to a TanStack Query `refetch`.
 * Restyled on Tailwind tokens; the `role="alert"` + Retry button contract is preserved.
 */
import { CloudOff } from "lucide-react";
import { Button } from "./Button";

interface UnavailableProps {
  /** Invoked when the user presses Retry (e.g. a query `refetch`). */
  onRetry: () => void;
  /** Optional override for the default service-unavailable message. */
  message?: string;
}

export function Unavailable({
  onRetry,
  message = "This service is currently unavailable. Please try again.",
}: UnavailableProps) {
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded-2xl border border-border bg-surface px-5 py-5"
    >
      <div className="flex items-center gap-2.5 text-content">
        <CloudOff className="h-5 w-5 text-content-muted" aria-hidden="true" />
        <p className="text-sm">{message}</p>
      </div>
      <Button variant="secondary" size="sm" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}
