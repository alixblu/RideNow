/**
 * Feature: frontend-ui-enhancement, Property 12: theme toggle persists the selected theme
 * and only ever yields a known theme value.
 * **Validates: Requirements 2.2**
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import fc from "fast-check";
import { ThemeToggle } from "./ThemeToggle";

const KEY = "rn-theme";

describe("Property 12: ThemeToggle persistence", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });
  afterEach(() => cleanup());

  it("persists the selected theme and only yields light or dark", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<"light" | "dark" | null>("light", "dark", null),
        fc.integer({ min: 1, max: 12 }),
        (initial, clicks) => {
          localStorage.clear();
          if (initial) document.documentElement.setAttribute("data-theme", initial);
          else document.documentElement.removeAttribute("data-theme");

          const { unmount } = render(<ThemeToggle />);
          let expected: "light" | "dark" = initial === "light" ? "light" : "dark";
          for (let i = 0; i < clicks; i++) {
            fireEvent.click(screen.getByRole("button"));
            expected = expected === "dark" ? "light" : "dark";
            const stored = localStorage.getItem(KEY);
            expect(["light", "dark"]).toContain(stored);
            expect(stored).toBe(expected);
            expect(document.documentElement.getAttribute("data-theme")).toBe(expected);
          }
          unmount();
        },
      ),
      { numRuns: 50 },
    );
  });
});
