/**
 * Feature: frontend-ui-enhancement, Property 15: every icon-only Primitive control has a
 * non-empty accessible name.
 *
 * **Validates: Requirements 10.2**
 */
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import fc from "fast-check";
import { Plus } from "lucide-react";
import { BottomSheet } from "./BottomSheet";
import type { SheetSnap } from "./BottomSheet";
import { Button } from "./Button";
import { ThemeToggle } from "./ThemeToggle";
import { ToastProvider, useToast } from "./toast";

const SNAPS: SheetSnap[] = ["peek", "half", "full"];

function Trigger() {
  const { toast } = useToast();
  return (
    <button type="button" onClick={() => toast("hello")}>
      show
    </button>
  );
}

afterEach(() => cleanup());

describe("Property 15: icon-only controls have accessible names", () => {
  it("ThemeToggle is found by role with a non-empty name in either theme", () => {
    fc.assert(
      fc.property(fc.constantFrom("light", "dark"), (theme) => {
        document.documentElement.setAttribute("data-theme", theme);
        const { unmount } = render(<ThemeToggle />);
        const name = screen.getByRole("button").getAttribute("aria-label") ?? "";
        expect(name.trim()).not.toBe("");
        expect(screen.getByRole("button", { name })).toBeTruthy();
        unmount();
      }),
      { numRuns: 20 },
    );
  });

  it("BottomSheet handle has a non-empty name for every snap state", () => {
    fc.assert(
      fc.property(fc.constantFrom(...SNAPS), (snap) => {
        const { unmount } = render(
          <BottomSheet label="Sheet" snap={snap}>
            content
          </BottomSheet>,
        );
        const handle = screen.getByRole("button", { name: /resize panel/i });
        const name = handle.getAttribute("aria-label") ?? "";
        expect(name.trim()).not.toBe("");
        expect(name).toContain(snap);
        unmount();
      }),
      { numRuns: 20 },
    );
  });

  it("toast dismiss control has a non-empty name", () => {
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    act(() => {
      screen.getByRole("button", { name: "show" }).click();
    });
    const dismiss = screen.getByRole("button", { name: /dismiss/i });
    expect((dismiss.getAttribute("aria-label") ?? "").trim()).not.toBe("");
  });

  it("icon-only Button with aria-label is found by its name", () => {
    fc.assert(
      fc.property(
        fc
          .array(fc.stringMatching(/^[A-Za-z]{1,8}$/), { minLength: 1, maxLength: 3 })
          .map((words) => words.join(" ")),
        (label) => {
          const { unmount } = render(
            <Button aria-label={label}>
              <Plus aria-hidden="true" />
            </Button>,
          );
          try {
            expect(screen.getByRole("button", { name: label })).toBeTruthy();
          } finally {
            unmount();
          }
        },
      ),
      { numRuns: 30 },
    );
  });
});
