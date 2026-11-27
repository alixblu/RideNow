/**
 * Property tests for Button (frontend-ui-enhancement task 3.2).
 * Property 3: variants/sizes render an interactive control unless disabled or loading.
 * Property 4: md and lg meet the minimum touch target (h-11 / h-12).
 * Property 5: public props and export name are unchanged.
 * Validates: Requirements 3.2, 3.3, 3.4, 3.5, 3.6
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as fc from "fast-check";
import * as ButtonModule from "./Button";
import { Button } from "./Button";

const variants = ["primary", "secondary", "ghost", "danger"] as const;
const sizes = ["sm", "md", "lg"] as const;
const RUNS = { numRuns: 100 };

const combo = fc.record({
  variant: fc.constantFrom(...variants),
  size: fc.constantFrom(...sizes),
  disabled: fc.boolean(),
  loading: fc.boolean(),
});

afterEach(cleanup);

describe("Button properties", () => {
  it("Property 3: renders an interactive button; click is ignored when disabled or loading", () => {
    fc.assert(
      fc.property(combo, ({ variant, size, disabled, loading }) => {
        const onClick = vi.fn();
        const { unmount } = render(
          <Button variant={variant} size={size} disabled={disabled} loading={loading} onClick={onClick}>
            Go
          </Button>,
        );
        const btn = screen.getByRole("button", { name: "Go" });
        fireEvent.click(btn);
        if (disabled || loading) {
          expect(btn).toBeDisabled();
          expect(onClick).not.toHaveBeenCalled();
        } else {
          expect(btn).toBeEnabled();
          expect(onClick).toHaveBeenCalledTimes(1);
        }
        expect(btn.getAttribute("aria-busy") === "true").toBe(loading);
        // Press transition uses the 80 ms token, never the 120 ms one (Req 3.2).
        expect(btn).toHaveClass("duration-press");
        expect(btn).not.toHaveClass("duration-fast");
        unmount();
      }),
      RUNS,
    );
  });

  it("Property 4: md and lg meet the 44 px minimum touch target", () => {
    fc.assert(
      fc.property(combo, fc.boolean(), ({ variant, size, disabled, loading }, touch) => {
        const { unmount } = render(
          <Button variant={variant} size={size} disabled={disabled} loading={loading} touch={touch}>
            Go
          </Button>,
        );
        const btn = screen.getByRole("button");
        if (size === "md") expect(btn).toHaveClass("h-11");
        if (size === "lg") expect(btn).toHaveClass("h-12");
        if (touch) expect(btn).toHaveClass("min-h-11", "min-w-11");
        unmount();
      }),
      RUNS,
    );
  });

  it("Property 5: keeps the Button export and accepts the same public props", () => {
    expect(typeof ButtonModule.Button).toBe("object"); // forwardRef component
    expect(ButtonModule.Button).toBe(Button);
    fc.assert(
      fc.property(
        combo,
        fc.boolean(),
        fc.boolean(),
        ({ variant, size, disabled, loading }, block, touch) => {
          const { unmount } = render(
            <Button
              variant={variant}
              size={size}
              block={block}
              touch={touch}
              loading={loading}
              disabled={disabled}
              leftIcon={<svg data-testid="icon" />}
              className="extra"
              type="submit"
              aria-label="Label"
            >
              Text
            </Button>,
          );
          const btn = screen.getByRole("button", { name: "Label" });
          expect(btn).toHaveAttribute("type", "submit");
          expect(btn).toHaveClass("extra");
          expect(btn.classList.contains("w-full")).toBe(block);
          expect(screen.queryByTestId("icon") !== null).toBe(!loading);
          unmount();
        },
      ),
      RUNS,
    );
  });
});
