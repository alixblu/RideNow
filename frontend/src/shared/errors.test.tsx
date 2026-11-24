import { describe, it, expect, afterEach } from "vitest";
import fc from "fast-check";
import { render, screen, cleanup } from "@testing-library/react";
import { ApiError } from "../http/ApiError";
import type { ApiErrorCode } from "../http/ApiError";
import { ErrorState } from "./ui/ErrorState";

/**
 * Feature: production-grade-frontend, Property 19: Friendly errors leak nothing raw
 *
 * **Validates: Requirements 3.8**
 */
const CODES: ApiErrorCode[] = ["NOT_FOUND", "CONFLICT", "VALIDATION", "UNAVAILABLE"];

afterEach(cleanup);

describe("Property 19: Friendly errors leak nothing raw", () => {
  it("ErrorState text is non-empty, free of status numbers and braces, with a retry control", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 599 }),
        fc.constantFrom(...CODES),
        fc.string(),
        fc.oneof(fc.string(), fc.json().map((j) => `{"error":${j}}`)),
        (status, code, message, body) => {
          // The message may carry body text; it must never be rendered.
          const error = new ApiError(status, code, `${message} ${body} ${status}`);
          const { container, unmount } = render(<ErrorState error={error} onRetry={() => {}} />);
          const text = container.textContent ?? "";

          expect(text.trim().length).toBeGreaterThan(0);
          expect(text).not.toContain(String(status));
          expect(text).not.toMatch(/[{}]/);
          expect(screen.getByRole("button", { name: /retry/i })).toBeTruthy();
          unmount();
        },
      ),
      { numRuns: 100 },
    );
  });
});
