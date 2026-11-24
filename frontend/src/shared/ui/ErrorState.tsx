/**
 * ErrorState — a friendly failure view with a Retry button (Req 3.8).
 *
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
  /** Called when the user presses Retry; the button is hidden when omitted. */
  onRetry?: () => void;
}

export function ErrorState({ error, message, onRetry }: ErrorStateProps) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-3 rounded-2xl bg-danger/10 px-6 py-8 text-center"
    >
      <AlertCircle className="h-8 w-8 text-danger" aria-hidden="true" />
      <p className="text-sm text-content">{message ?? friendlyError(error)}</p>
      {onRetry ? (
        <Button variant="secondary" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}
