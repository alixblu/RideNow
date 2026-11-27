/**
 * Property tests for BottomSheet (frontend-ui-enhancement task 5.2).
 * Property 7: snap cycling is a closed round trip over {peek, half, full}.
 * Property 8: the root contract survives any snap state or motion preference.
 * Validates: Requirements 5.3, 5.4, 5.5
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as fc from "fast-check";
import { BottomSheet, nextSnap } from "./BottomSheet";
import type { SheetSnap } from "./BottomSheet";

const RUNS = { numRuns: 100 };
const snaps = fc.constantFrom<SheetSnap>("peek", "half", "full");

function mockMatchMedia(reduce: boolean) {
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: reduce && query.includes("prefers-reduced-motion"),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
        onchange: null,
      }) as unknown as MediaQueryList,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("BottomSheet properties", () => {
  it("Property 7: three cycles return to the start and every step stays in the set", () => {
    fc.assert(
      fc.property(snaps, (start) => {
        const a = nextSnap(start);
        const b = nextSnap(a);
        const c = nextSnap(b);
        expect(new Set([start, a, b]).size).toBe(3);
        expect(c).toBe(start);
      }),
      RUNS,
    );
  });

  it("Property 7: clicking the handle cycles data-snap and returns after three clicks", () => {
    fc.assert(
      fc.property(snaps, (start) => {
        const { unmount } = render(
          <BottomSheet label="Sheet" defaultSnap={start}>
            body
          </BottomSheet>,
        );
        const sheet = screen.getByRole("region", { name: "Sheet" });
        const seen: string[] = [sheet.getAttribute("data-snap")!];
        for (let i = 0; i < 3; i++) {
          fireEvent.click(screen.getByRole("button", { name: /resize panel/i }));
          seen.push(sheet.getAttribute("data-snap")!);
        }
        expect(seen[0]).toBe(start);
        expect(seen[3]).toBe(start);
        expect(seen.slice(0, 3).every((s) => ["peek", "half", "full"].includes(s))).toBe(true);
        expect(new Set(seen.slice(0, 3)).size).toBe(3);
        unmount();
      }),
      RUNS,
    );
  });

  it("Property 8: root contract holds for every snap state and motion preference", () => {
    fc.assert(
      fc.property(snaps, fc.boolean(), (snap, reduce) => {
        mockMatchMedia(reduce);
        const { unmount } = render(
          <BottomSheet label="Sheet" snap={snap}>
            body
          </BottomSheet>,
        );
        const sheet = screen.getByRole("region", { name: "Sheet" });
        expect(sheet.classList.contains("z-10")).toBe(true);
        expect(sheet.getAttribute("data-snap")).toBe(snap);
        const handle = screen.getByRole("button", { name: `Resize panel (currently ${snap})` });
        expect(handle.getAttribute("aria-label")).toBe(`Resize panel (currently ${snap})`);
        expect(handle.classList.contains("min-h-11")).toBe(true);
        unmount();
      }),
      RUNS,
    );
  });
});
