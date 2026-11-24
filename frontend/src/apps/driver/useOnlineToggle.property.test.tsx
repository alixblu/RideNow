// Feature: production-grade-frontend, Property 12: Online toggle with rollback
// **Validates: Requirements 5.3, 5.4**
import type { ReactNode } from "react";
import { describe, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import fc from "fast-check";
import { ToastProvider } from "../../shared/ui";
import { useOnlineToggle } from "./useOnlineToggle";

function wrapper({ children }: { children: ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>;
}

describe("Property 12: Online toggle with rollback", () => {
  it("settles on the requested state on success, the initial state on failure, and failure shows an error message", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.boolean(),
        fc.boolean(),
        fc.string(),
        async (initial, succeeds, message) => {
          const calls: string[] = [];
          const outcome = async (name: string) => {
            calls.push(name);
            if (!succeeds) throw new Error(message);
            return undefined as never;
          };
          const client = {
            goOnline: (id: string) => outcome(`online:${id}`),
            goOffline: (id: string) => outcome(`offline:${id}`),
          };

          const { result, unmount } = renderHook(
            () => useOnlineToggle("d1", client, initial),
            { wrapper },
          );

          let final: boolean | undefined;
          await act(async () => {
            final = await result.current.toggle();
          });

          const requested = !initial;
          const expected = succeeds ? requested : initial;
          const expectedCall = `${requested ? "online" : "offline"}:d1`;

          const toastText = document.body.querySelector("[aria-live] p")?.textContent ?? "";
          const ok =
            result.current.online === expected &&
            final === expected &&
            result.current.pending === false &&
            calls.length === 1 &&
            calls[0] === expectedCall &&
            (succeeds ? toastText === "" : toastText.trim().length > 0);

          unmount();
          return ok;
        },
      ),
      { numRuns: 50 },
    );
  });
});
