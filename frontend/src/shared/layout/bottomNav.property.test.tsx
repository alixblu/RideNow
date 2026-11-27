/**
 * Property 11: BottomNav highlights exactly the active destination and meets the touch target.
 * **Validates: Requirements 6.2, 6.5**
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import fc from "fast-check";
import { BottomNav, type BottomNavItem } from "./BottomNav";

afterEach(cleanup);

const segment = fc.stringMatching(/^[a-z]{1,8}$/);

const scenario = fc
  .uniqueArray(segment, { minLength: 1, maxLength: 6 })
  .chain((segments) =>
    fc.record({
      items: fc.constant(
        segments.map<BottomNavItem>((s) => ({ to: `/${s}`, label: `Tab ${s}`, end: true })),
      ),
      activeIndex: fc.integer({ min: 0, max: segments.length - 1 }),
    }),
  );

describe("Property 11: BottomNav active destination and touch targets", () => {
  it("marks exactly one link active with the accent indicator, and all links meet 44px targets", () => {
    fc.assert(
      fc.property(scenario, ({ items, activeIndex }) => {
        const { unmount } = render(
          <MemoryRouter initialEntries={[items[activeIndex]!.to]}>
            <BottomNav items={items} />
          </MemoryRouter>,
        );
        const links = within(screen.getByRole("navigation")).getAllByRole("link");
        expect(links).toHaveLength(items.length);

        const current = links.filter((l) => l.getAttribute("aria-current") === "page");
        expect(current).toHaveLength(1);
        expect(current[0]!.getAttribute("href")).toBe(items[activeIndex]!.to);

        const indicated = links.filter((l) => l.classList.contains("before:bg-accent"));
        expect(indicated).toEqual(current);

        for (const link of links) {
          expect(link.classList.contains("min-h-11")).toBe(true);
          expect(link.classList.contains("min-w-11")).toBe(true);
        }
        unmount();
      }),
      { numRuns: 100 },
    );
  });
});
