/**
 * ApiError — the single normalized, client-facing error type for the request layer.
 *
 * Every backend failure (4xx, 5xx, network error, or a null placeholder origin) is
 * funneled into an `ApiError` before it reaches a screen. By construction it carries
 * only three things: an HTTP-like `status`, a short machine `code`, and a curated,
 * human-readable `message`. Raw backend bodies — stack traces, SQL/persistence
 * internals, framework noise — are never stored here, so the view layer cannot leak
 * them (design: "Error normalization is sanitized by construction", Req 5.5, 6.6,
 * 13.2).
 *
 * The static factories name the four cases the UI distinguishes:
 *   - notFound    → 404 → not-found view (Req 5.4, 7.3, 8.4)
 *   - conflict    → 409 → conflict message (Req 5.5, 6.6)
 *   - validation  → 400 → field/validation message surfaced near the form
 *   - unavailable → 503 / network failure / null placeholder origin → retry (Req 13.3)
 */

/** Short machine-readable discriminator for the kind of error. */
export type ApiErrorCode = "NOT_FOUND" | "CONFLICT" | "VALIDATION" | "UNAVAILABLE";

export class ApiError extends Error {
  /** HTTP-like status associated with this error (e.g. 404, 409, 400, 503). */
  readonly status: number;
  /** Short, stable code the UI can switch on without parsing the message. */
  readonly code: ApiErrorCode;

  constructor(status: number, code: ApiErrorCode, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    // Restore the prototype chain so `instanceof ApiError` works after transpilation
    // to older targets (TS extends-built-ins caveat).
    Object.setPrototypeOf(this, ApiError.prototype);
  }

  /** 404 — the requested resource does not exist. */
  static notFound(message = "The requested item could not be found."): ApiError {
    return new ApiError(404, "NOT_FOUND", message);
  }

  /** 409 — the request conflicts with existing state (e.g. duplicate). */
  static conflict(message = "That request conflicts with existing data."): ApiError {
    return new ApiError(409, "CONFLICT", message);
  }

  /** 400 — the request failed validation. */
  static validation(message = "The submitted data is invalid."): ApiError {
    return new ApiError(400, "VALIDATION", message);
  }

  /** 503 — the target service is unreachable or not yet available. */
  static unavailable(
    message = "The service is currently unavailable. Please try again.",
  ): ApiError {
    return new ApiError(503, "UNAVAILABLE", message);
  }
}
