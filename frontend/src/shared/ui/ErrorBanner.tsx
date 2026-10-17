/**
 * ErrorBanner — shows a sanitized, user-facing error message (Req 13.2).
 *
 * The request layer normalizes every backend failure into an `ApiError` whose
 * `message` is curated by construction (no stack traces, no persistence internals).
 * This banner renders only that message string, so it cannot leak raw backend bodies.
 * Restyled on Tailwind tokens; the `role="alert"` contract is preserved for tests.
 */
import { AlertCircle } from "lucide-react";

interface ErrorBannerProps {
  /** A sanitized, human-readable message (typically `ApiError.message`). */
  message: string;
}

export function ErrorBanner({ message }: ErrorBannerProps) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2.5 rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-content"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}
