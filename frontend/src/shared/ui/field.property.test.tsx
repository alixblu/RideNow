/**
 * Feature: frontend-ui-enhancement
 * Property 6: Field renders an error alert and a danger-bordered Input exactly
 * when an error is present.
 *
 * **Validates: Requirements 4.4**
 */
import { cleanup, render, screen } from "@testing-library/react";
import fc from "fast-check";
import { afterEach, describe, expect, it } from "vitest";
import { Field } from "./Field";
import { Input } from "./Input";

afterEach(cleanup);

const textArb = fc
  .string({ minLength: 1, maxLength: 40 })
  .filter((s) => s.trim().length > 0 && s === s.trim());

describe("Property 6: Field error rendering", () => {
  it("renders role=alert with the message and a danger-bordered Input when error is set", () => {
    fc.assert(
      fc.property(textArb, textArb, (label, error) => {
        const { unmount } = render(
          <Field htmlFor="f" label={label} error={error}>
            <Input id="f" invalid={Boolean(error)} />
          </Field>,
        );
        const alert = screen.getByRole("alert");
        expect(alert.textContent).toBe(error);
        const input = document.getElementById("f") as HTMLInputElement;
        expect(input.getAttribute("aria-invalid")).toBe("true");
        expect(input.className).toContain("border-danger");
        unmount();
      }),
      { numRuns: 50 },
    );
  });

  it("renders no alert and no danger border when error is absent", () => {
    fc.assert(
      fc.property(textArb, fc.option(textArb, { nil: undefined }), (label, hint) => {
        const { unmount } = render(
          <Field htmlFor="f" label={label} hint={hint}>
            <Input id="f" invalid={false} />
          </Field>,
        );
        expect(screen.queryByRole("alert")).toBeNull();
        const input = document.getElementById("f") as HTMLInputElement;
        expect(input.getAttribute("aria-invalid")).toBeNull();
        expect(input.className).not.toContain("border-danger");
        unmount();
      }),
      { numRuns: 50 },
    );
  });
});
