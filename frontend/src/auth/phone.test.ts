// Feature: production-grade-frontend, Property 4: Phone validation matches the 9 to 15 digit rule
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { validatePhone } from "./phone";

const digitArb = fc.constantFrom(..."0123456789".split(""));
const sepArb = fc.constantFrom(" ", "-", "  ", "--");

/** Digits with optional separators between them and an optional leading plus. */
function formatted(minDigits: number, maxDigits: number) {
  return fc
    .tuple(
      fc.array(digitArb, { minLength: minDigits, maxLength: maxDigits }),
      fc.array(fc.option(sepArb, { nil: "" }), { minLength: maxDigits, maxLength: maxDigits }),
      fc.boolean(),
    )
    .map(([digits, seps, plus]) => ({
      digits: digits.join(""),
      text: (plus ? "+" : "") + digits.map((d, i) => d + (i < digits.length - 1 ? seps[i] : "")).join(""),
    }));
}

describe("Property 4: phone validation matches the 9 to 15 digit rule", () => {
  it("accepts 9 to 15 digits with spaces, dashes and one leading plus, returning the digits", () => {
    // **Validates: Requirements 2.3, 2.4**
    fc.assert(
      fc.property(formatted(9, 15), ({ digits, text }) => {
        const r = validatePhone(text);
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.digits).toBe(digits);
      }),
      { numRuns: 100 },
    );
  });

  it("rejects fewer than 9 or more than 15 digits with a non-empty message", () => {
    // **Validates: Requirements 2.3, 2.4**
    const tooFew = formatted(0, 8);
    const tooMany = formatted(16, 25);
    fc.assert(
      fc.property(fc.oneof(tooFew, tooMany), ({ text }) => {
        const r = validatePhone(text);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.message.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );
  });

  it("rejects input containing any character other than digits, spaces, dashes or a leading plus", () => {
    // **Validates: Requirements 2.3, 2.4**
    const badChar = fc
      .string({ minLength: 1, maxLength: 1 })
      .filter((c) => !/[0-9 +-]/.test(c) && c.trim() !== "");
    fc.assert(
      fc.property(formatted(9, 15), badChar, fc.nat(), ({ text }, ch, pos) => {
        const i = pos % (text.length + 1);
        const r = validatePhone(text.slice(0, i) + ch + text.slice(i));
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.message.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );
  });

  it("rejects a second plus sign", () => {
    // **Validates: Requirements 2.3, 2.4**
    fc.assert(
      fc.property(formatted(9, 15), ({ text }) => {
        expect(validatePhone("+" + text.replace(/^\+/, "") ).ok).toBe(true);
        expect(validatePhone("++" + text.replace(/^\+/, "")).ok).toBe(false);
      }),
      { numRuns: 50 },
    );
  });

  it("rejects the empty string and separator-only input", () => {
    expect(validatePhone("").ok).toBe(false);
    expect(validatePhone(" - ").ok).toBe(false);
    expect(validatePhone("+").ok).toBe(false);
  });
});
