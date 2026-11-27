/**
 * ErrorState — a friendly failure view with a Retry button (Req 3.8, 4.5).
 *
 * Layout order matches EmptyState: icon, title, message, then the Retry action.
 * Shows `friendlyError(error)` only: never a status code, stack trace, or JSON body.
 * Pass `message` to override the text with an already-friendly string.
 */
import { AlertCircle } from "lucide-react";
import { friendlyError } from "../errors";
import { Button } from "./Button";

interface ErrorStateProps {
  /** The thrown value; mapped to a friendly sentence. */
  error?: unknown;
  /** Overrides the friendly text when provided. */
  message?: string;
  /** Optional heading shown between the icon and the message. */
  title?: string;
  /** Called when the user presses Retry; the button is hidden when omitted. */
  onRetry?: () => void;
}

export function ErrorState({ error, message, title, onRetry }: ErrorStateProps) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-3 rounded-2xl bg-danger/10 px-6 py-10 text-center"
    >
      <AlertCircle className="h-10 w-10 text-danger" aria-hidden="true" />
      {title ? <h3 className="text-base font-bold text-content">{title}</h3> : null}
      <p className="text-sm text-content-muted">{message ?? friendlyError(error)}</p>
      {onRetry ? (
        <Button variant="secondary" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}
