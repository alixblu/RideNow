/**
 * httpClient — the single fetch wrapper for the request layer.
 *
 * Every live Service_Client call goes through here, so URL resolution, principal
 * attachment, and error normalization live in exactly one place (design: "Request
 * layer" and "Error, loading, and unavailable handling").
 *
 * Responsibilities:
 *   1. Resolve the documented API path to a concrete URL via `resolveUrl` (gateway
 *      vs Path_Prefix_Map fallback, Req 3.2/3.3). A matched-but-null placeholder
 *      origin makes `resolveUrl` throw `ApiError.unavailable` — we let that surface.
 *   2. Attach the acting principal when a request requires one. The caller passes a
 *      principal derived from `Current_Identity` (Req 2.3); we attach it as the
 *      `X-RideNow-Identity` header. This module intentionally does NOT import the
 *      identity module — the principal is a plain option — so there is no circular
 *      dependency (identity is task 4.1).
 *   3. Normalize every failure into a sanitized `ApiError`. The backend error body
 *      shape is `ApiErrorResponse {timestamp, status, error, message, path}` (verified
 *      in driver-service GlobalExceptionHandler). Only the backend's curated `message`
 *      is ever surfaced; raw bodies (stack traces, persistence internals) are never
 *      passed into an `ApiError` (Req 13.2). Status mapping:
 *        404 -> ApiError.notFound, 409 -> ApiError.conflict,
 *        400 -> ApiError.validation, 503 / network failure -> ApiError.unavailable,
 *        any other non-2xx -> a sanitized generic ApiError.
 */
import { appConfig, type AppConfig } from "../config/appConfig";
import { ApiError } from "./ApiError";
import { resolveUrl } from "./resolveUrl";

/** Shape of the backend error body produced by the services' GlobalExceptionHandler. */
interface ApiErrorResponse {
  timestamp?: string;
  status?: number;
  error?: string;
  message?: string;
  path?: string;
}

export interface HttpRequestOptions {
  /** HTTP method; defaults to GET. */
  method?: string;
  /** Request body; objects are JSON-serialized and sent as application/json. */
  body?: unknown;
  /** Extra headers merged over the defaults. */
  headers?: Record<string, string>;
  /**
   * Acting principal derived from `Current_Identity` (Req 2.3). When provided it is
   * attached as the `X-RideNow-Identity` header. Passed by the caller so httpClient
   * never imports the identity module (no circular dependency).
   */
  principal?: string | null;
  /** Config override (primarily for tests); defaults to the app singleton. */
  config?: AppConfig;
}

/**
 * Perform an HTTP request against a documented API path and return the parsed JSON
 * body typed as `T`. Any failure — network, non-2xx, or a null placeholder origin —
 * is thrown as a sanitized `ApiError`.
 */
export async function httpRequest<T>(
  path: string,
  options: HttpRequestOptions = {},
): Promise<T> {
  const config = options.config ?? appConfig;

  // resolveUrl may throw ApiError.unavailable for a null placeholder origin; that is
  // already a sanitized ApiError, so let it propagate unchanged.
  const url = resolveUrl(path, config);

  const headers: Record<string, string> = { ...options.headers };

  const hasBody = options.body !== undefined && options.body !== null;
  if (hasBody && headers["Content-Type"] === undefined) {
    headers["Content-Type"] = "application/json";
  }

  // Attach the acting principal when the request requires one (Req 2.3).
  if (options.principal) {
    headers["X-RideNow-Identity"] = options.principal;
  }

  const init: RequestInit = {
    method: options.method ?? "GET",
    headers,
  };
  if (hasBody) {
    init.body = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    // Network failure / DNS / connection refused: the service is unreachable.
    throw ApiError.unavailable();
  }

  if (!response.ok) {
    throw await toApiError(response);
  }

  // 204 No Content (or an empty body) has nothing to parse.
  if (response.status === 204) {
    return undefined as T;
  }

  try {
    const text = await response.text();
    return (text.length > 0 ? JSON.parse(text) : undefined) as T;
  } catch {
    // A 2xx with an unparseable body is treated as unavailable rather than leaking
    // raw parse errors to the view.
    throw ApiError.unavailable();
  }
}

/**
 * Convert a non-2xx `Response` into a sanitized `ApiError`.
 *
 * We read the curated `message` from the backend `ApiErrorResponse` when present and
 * pass ONLY that string into the ApiError factory. The raw body is never forwarded, so
 * stack traces or persistence internals cannot reach the view (Req 13.2).
 */
async function toApiError(response: Response): Promise<ApiError> {
  const curatedMessage = await readCuratedMessage(response);

  switch (response.status) {
    case 404:
      return curatedMessage ? ApiError.notFound(curatedMessage) : ApiError.notFound();
    case 409:
      return curatedMessage ? ApiError.conflict(curatedMessage) : ApiError.conflict();
    case 400:
      return curatedMessage
        ? ApiError.validation(curatedMessage)
        : ApiError.validation();
    case 503:
      return curatedMessage
        ? ApiError.unavailable(curatedMessage)
        : ApiError.unavailable();
    default:
      // Any other non-2xx (e.g. 401/403/500): surface a sanitized generic error. We do
      // not echo a possibly-noisy 5xx body, so 5xx falls back to the safe default.
      if (response.status >= 500) {
        return ApiError.unavailable();
      }
      return new ApiError(
        response.status,
        "VALIDATION",
        curatedMessage ?? "The request could not be completed.",
      );
  }
}

/**
 * Safely extract the backend's curated `message` field from an error response.
 *
 * Returns the trimmed `message` only when the body parses as the expected
 * `ApiErrorResponse` shape and carries a non-empty string message. Anything else
 * (non-JSON body, missing field, read error) yields `null` so the caller falls back to
 * a safe default message — never the raw body.
 */
async function readCuratedMessage(response: Response): Promise<string | null> {
  let text: string;
  try {
    text = await response.text();
  } catch {
    return null;
  }

  if (text.length === 0) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // A non-JSON error body (e.g. an HTML error page or raw stack trace) is never
    // surfaced; the caller uses a safe default instead.
    return null;
  }

  if (parsed !== null && typeof parsed === "object" && "message" in parsed) {
    const message = (parsed as ApiErrorResponse).message;
    if (typeof message === "string" && message.trim().length > 0) {
      return message.trim();
    }
  }

  return null;
}
