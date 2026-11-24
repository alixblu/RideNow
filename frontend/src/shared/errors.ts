/**
 * friendlyError — maps any thrown value to a short, user-facing sentence.
 *
 * The result is chosen only by `ApiError.code`. It never includes HTTP status
 * numbers, response bodies, or `error.message` (which could carry body text).
 */
import { ApiError } from "../http/ApiError";

export const FRIENDLY_MESSAGES = {
  NOT_FOUND: "We couldn't find what you were looking for.",
  CONFLICT: "That action is no longer possible. Please refresh and try again.",
  VALIDATION: "Please check the details you entered and try again.",
  UNAVAILABLE: "The service is unavailable right now. Please try again shortly.",
  DEFAULT: "Something went wrong. Please try again.",
} as const;

export function friendlyError(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case "NOT_FOUND":
        return FRIENDLY_MESSAGES.NOT_FOUND;
      case "CONFLICT":
        return FRIENDLY_MESSAGES.CONFLICT;
      case "VALIDATION":
        return FRIENDLY_MESSAGES.VALIDATION;
      case "UNAVAILABLE":
        return FRIENDLY_MESSAGES.UNAVAILABLE;
      default:
        return FRIENDLY_MESSAGES.DEFAULT;
    }
  }
  return FRIENDLY_MESSAGES.DEFAULT;
}
