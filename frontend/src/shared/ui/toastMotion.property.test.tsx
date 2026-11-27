/**
 * Property 9: Reduced motion disables the toast entrance class.
 *
 * **Validates: Requirements 7.3, 4.6**
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import fc from "fast-check";
import { ToastProvider, useToast } from "./toast";

type Tone = "success" | "error" | "info";
const TONES: Tone[] = ["success", "error", "info"];

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

function Trigger({ tone, message }: { tone: Tone; message: string }) {
  const { toast } = useToast();
  return (
    <button type="button" onClick={() => toast(message, tone)}>
      show
    </button>
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Property 9: reduced motion on toast", () => {
  it("has animate-slide-up only when reduced motion is not preferred, for every tone", () => {
    fc.assert(
      fc.property(fc.constantFrom(...TONES), fc.boolean(), (tone, reduce) => {
        mockMatchMedia(reduce);
        const message = `msg-${tone}`;
        const { unmount } = render(
          <ToastProvider>
            <Trigger tone={tone} message={message} />
          </ToastProvider>,
        );
        act(() => {
          screen.getByRole("button", { name: "show" }).click();
        });
        const card = screen.getByText(message).parentElement as HTMLElement;
        expect(card.classList.contains("animate-slide-up")).toBe(!reduce);
        unmount();
      }),
      { numRuns: 50 },
    );
  });
});
