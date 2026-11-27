/**
 * Property 16: Screen content is present on first render without waiting for animation.
 *
 * **Validates: Requirements 7.4**
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import fc from "fast-check";
import { BottomSheet } from "./BottomSheet";
import { ToastProvider, useToast } from "./toast";
import { PhoneColumn } from "../layout/PhoneColumn";
import { BottomNav } from "../layout/BottomNav";

const HIDING = ["opacity-0", "invisible", "hidden"];

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

function expectVisibleNow(el: HTMLElement) {
  expect(document.body.contains(el)).toBe(true);
  for (let node: HTMLElement | null = el; node; node = node.parentElement) {
    for (const cls of HIDING) {
      expect(node.classList.contains(cls)).toBe(false);
    }
  }
}

function Trigger({ message }: { message: string }) {
  const { toast } = useToast();
  return (
    <button type="button" onClick={() => toast(message, "info")}>
      show
    </button>
  );
}

type Target = "bottomSheet" | "toast" | "phoneColumn" | "bottomNav";
const TARGETS: Target[] = ["bottomSheet", "toast", "phoneColumn", "bottomNav"];

function renderTarget(target: Target): HTMLElement {
  switch (target) {
    case "bottomSheet":
      render(
        <BottomSheet label="Sheet">
          <p>sheet-content</p>
        </BottomSheet>,
      );
      return screen.getByText("sheet-content");
    case "toast":
      render(
        <ToastProvider>
          <Trigger message="toast-content" />
        </ToastProvider>,
      );
      act(() => {
        screen.getByRole("button", { name: "show" }).click();
      });
      return screen.getByText("toast-content");
    case "phoneColumn":
      render(
        <PhoneColumn>
          <p>column-content</p>
        </PhoneColumn>,
      );
      return screen.getByText("column-content");
    case "bottomNav":
      render(
        <MemoryRouter initialEntries={["/a"]}>
          <BottomNav items={[{ to: "/a", label: "Tab a", end: true }, { to: "/b", label: "Tab b", end: true }]} />
        </MemoryRouter>,
      );
      return screen.getByText("Tab a");
  }
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Property 16: content is present on first render", () => {
  it("is in the document and not hidden by class before any timer advances", () => {
    fc.assert(
      fc.property(fc.constantFrom(...TARGETS), fc.boolean(), (target, reduce) => {
        mockMatchMedia(reduce);
        const el = renderTarget(target);
        expectVisibleNow(el);
        cleanup();
      }),
      { numRuns: 100 },
    );
  });
});
