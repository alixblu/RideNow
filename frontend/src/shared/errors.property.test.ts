import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { ApiError, type ApiErrorCode } from "../http/ApiError";
import { FRIENDLY_MESSAGES, isSafeMessage, safeMessage } from "./errors";

const FALLBACKS: string[] = Object.values(FRIENDLY_MESSAGES);
const STATUS_RE = /\b[1-5]\d{2}\b/;

function parsesAsJson(text: string): boolean {
  try {
    const v = JSON.parse(text);
    return typeof v === "object" && v !== null;
  } catch {
    return false;
  }
}

const codeArb = fc.constantFrom<ApiErrorCode>("NOT_FOUND", "CONFLICT", "VALIDATION", "UNAVAILABLE");
const statusArb = fc.integer({ min: 100, max: 599 });
const wordsArb = fc
  .array(fc.stringMatching(/^[A-Za-z]{1,10}$/), { minLength: 1, maxLength: 8 })
  .map((w) => w.join(" "));

// Messages that carry a raw status code or JSON body.
const leakyMessageArb = fc.oneof(
  fc.tuple(statusArb, wordsArb).map(([s, w]) => `${s} ${w}`),
  fc.tuple(statusArb, wordsArb).map(([s, w]) => `HTTP ${s}: ${w}`),
  fc.tuple(statusArb, wordsArb).map(([s, w]) => `${w} status ${s}`),
  fc.tuple(statusArb, wordsArb).map(([s, w]) => JSON.stringify({ status: s, message: w })),
  wordsArb.map((w) => JSON.stringify([{ error: w }])),
  fc.tuple(statusArb, wordsArb).map(([s, w]) => `{"status":${s},"error":"${w}"}`),
);

describe("Property 33: error rendering never leaks a raw status code or JSON body", () => {
  /**
   * **Validates: Requirements 12.8**
   */
  it("leaky messages are replaced by a fixed safe fallback", () => {
    fc.assert(
      fc.property(statusArb, codeArb, leakyMessageArb, (status, code, message) => {
        const out = safeMessage(new ApiError(status, code, message));
        expect(FALLBACKS).toContain(out);
        expect(STATUS_RE.test(out)).toBe(false);
        expect(parsesAsJson(out)).toBe(false);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 12.8**
   */
  it("for any message, output is the curated message or a fallback, and never JSON", () => {
    fc.assert(
      fc.property(statusArb, codeArb, fc.string({ maxLength: 300 }), (status, code, message) => {
        const out = safeMessage(new ApiError(status, code, message));
        if (FALLBACKS.includes(out)) return;
        expect(out).toBe(message.trim());
        expect(isSafeMessage(message)).toBe(true);
        expect(parsesAsJson(out)).toBe(false);
      }),
      { numRuns: 300 },
    );
  });

  /**
   * **Validates: Requirements 12.8**
   */
  it("plain curated sentences are preserved; non-ApiError values use the default fallback", () => {
    fc.assert(
      fc.property(codeArb.filter((c) => c !== "UNAVAILABLE"), wordsArb, (code, text) => {
        expect(safeMessage(new ApiError(400, code, text))).toBe(text);
      }),
      { numRuns: 100 },
    );
    fc.assert(
      fc.property(fc.anything(), (value) => {
        if (value instanceof ApiError) return;
        expect(safeMessage(value)).toBe(FRIENDLY_MESSAGES.DEFAULT);
      }),
      { numRuns: 100 },
    );
  });
});
