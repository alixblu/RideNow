/**
 * Property 9: Reduced motion disables BottomSheet transition classes.
 *
 * **Validates: Requirements 7.3**
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import fc from "fast-check";
import { BottomSheet } from "./BottomSheet";
import type { SheetSnap } from "./BottomSheet";

const SNAPS: SheetSnap[] = ["peek", "half", "full"];
const ANIMATED = ["transition-[max-height]", "duration-base", "ease-standard"];

function mockMatchMedia(reduce: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: reduce && query.includes("prefers-reduced-motion"),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Property 9: reduced motion on BottomSheet", () => {
  it("uses transition-none when reduce matches, animated classes otherwise, for every snap", () => {
    fc.assert(
      fc.property(fc.constantFrom(...SNAPS), fc.boolean(), (snap, reduce) => {
        mockMatchMedia(reduce);
        const { unmount } = render(
          <BottomSheet label="Sheet" snap={snap}>
            content
          </BottomSheet>,
        );
        const root = screen.getByRole("region", { name: "Sheet" });
        expect(root.getAttribute("data-snap")).toBe(snap);
        if (reduce) {
          expect(root.classList.contains("transition-none")).toBe(true);
          for (const c of ANIMATED) expect(root.classList.contains(c)).toBe(false);
        } else {
          expect(root.classList.contains("transition-none")).toBe(false);
          for (const c of ANIMATED) expect(root.classList.contains(c)).toBe(true);
        }
        unmount();
      }),
      { numRuns: 100 },
    );
  });
});
