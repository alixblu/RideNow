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

const MAX_SAFE_LENGTH = 200;

const UNSAFE_PATTERNS: RegExp[] = [
  /^\s*[[{]/, // JSON body
  /"\s*:\s*/, // JSON key/value fragment
  /\n/, // multi-line (stack traces)
  /\bat\s+[\w$.]+\(/, // stack frame
  /\b(?:java|javax|org|com|jakarta)\.[a-z]+\.[\w.]+/, // class names
  /\b(?:Exception|Traceback|NullPointer|SQLState)\b/i,
  /\bHTTP\s*\/?\s*\d/i,
  /\bstatus(?:\s+code)?\s*[:=]?\s*[1-5]\d{2}\b/i,
  /^\s*[1-5]\d{2}\b/, // leading status code
  /\b[1-5]\d{2}\s+(?:Bad Request|Unauthorized|Forbidden|Not Found|Conflict|Internal Server Error|Service Unavailable)\b/i,
];

/** True when a backend message is a short plain sentence with no status code, trace, or JSON. */
export function isSafeMessage(message: string): boolean {
  const text = message.trim();
  if (text === "" || text.length > MAX_SAFE_LENGTH) return false;
  return !UNSAFE_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * safeMessage — like `friendlyError`, but keeps the backend's curated message when it
 * passes `isSafeMessage` (Req 3.7, 6.6, 9.4 ask for the backend message). Anything
 * else, including non-ApiError values, falls back to a friendly sentence.
 */
export function safeMessage(error: unknown): string {
  if (error instanceof ApiError && error.code !== "UNAVAILABLE" && isSafeMessage(error.message)) {
    return error.message.trim();
  }
  return friendlyError(error);
}

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
