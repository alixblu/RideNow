/**
 * Maps a failed auth request to what the form shows (Req 3.7, 4.7).
 * The backend's curated message (401/403/409/400) is shown as is. The request layer
 * already strips raw bodies, so `ApiError.message` is safe to display.
 */
import { ApiError } from "../http/ApiError";
import { FRIENDLY_MESSAGES, safeMessage } from "../shared/errors";

export interface AuthFailure {
  message: string;
  /** True when the service could not be reached; the form offers a retry control. */
  unavailable: boolean;
}

export const UNAVAILABLE_MESSAGE = "The service is unavailable right now. Please try again.";

export function toAuthFailure(error: unknown): AuthFailure {
  if (error instanceof ApiError) {
    if (error.code === "UNAVAILABLE") {
      return { message: UNAVAILABLE_MESSAGE, unavailable: true };
    }
    return { message: safeMessage(error), unavailable: false };
  }
  return { message: FRIENDLY_MESSAGES.DEFAULT, unavailable: false };
}
