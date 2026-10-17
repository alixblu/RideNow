/**
 * Unit tests for Task 12.2 — Admin_Console user validation and not-found.
 *
 * Tag: Feature: ridenow-frontend, Task 12.2: user validation and not-found
 *
 * Covers two requirement clauses:
 *   - Req 8.2 (field-level validation): CreateUserScreen must block submission and
 *     surface a field-level message for each blank required field, and must reject an
 *     obviously malformed email before issuing any request. These assertions are pure
 *     client-side behaviour and need no backend.
 *   - Req 8.4 (user not-found view): UserDetailScreen must render a user-facing
 *     not-found message when a lookup yields a 404. Both admin screens resolve their
 *     user Service_Client internally via `resolveUserClient(appConfig)` (not through a
 *     prop), so we cannot inject a rejecting client. In this repo the user domain
 *     defaults to `live` mode (config/appConfig.ts: DEFAULT_MODES.user === "live") and
 *     `/api/users` maps to a real origin, so a lookup reaches `fetch`. To exercise the
 *     real 404 path deterministically with no backend, we stub the global `fetch` to
 *     return a 404; `httpClient` then normalizes it to `ApiError.notFound` and the
 *     screen shows "No user found" (Req 8.4).
 *
 * Each test renders inside its own fresh QueryClientProvider so query/mutation state
 * never leaks between cases. Retries are disabled so an error state settles promptly.
 */
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { CreateUserScreen } from "./CreateUserScreen";
import { UserDetailScreen } from "./UserDetailScreen";

/** A QueryClient with retries off so error states appear without delay in tests. */
function newQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

/** Render a screen wrapped in a brand-new QueryClientProvider (isolated per test). */
function renderWithClient(ui: ReactElement) {
  return render(<QueryClientProvider client={newQueryClient()}>{ui}</QueryClientProvider>);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Feature: ridenow-frontend, Task 12.2: user validation and not-found", () => {
  describe("CreateUserScreen field-level validation (Req 8.2)", () => {
    it("blocks submission and shows a message for each blank required field", () => {
      renderWithClient(<CreateUserScreen />);

      // Submit the form with every required field left blank.
      fireEvent.submit(screen.getByRole("form", { name: /create user/i }));

      // A field-level alert is shown for each required field.
      const alerts = screen.getAllByRole("alert");
      const messages = alerts.map((a) => a.textContent ?? "");
      expect(messages).toContain("Cognito sub is required.");
      expect(messages).toContain("Email is required.");
      expect(messages).toContain("Full name is required.");

      // Submission was blocked: no request issued, so the success view is absent.
      expect(screen.queryByText("User created.")).toBeNull();
      expect(screen.queryByRole("status")).toBeNull();
    });

    it("rejects an invalid email with a field-level 'valid email' message", () => {
      renderWithClient(<CreateUserScreen />);

      // Fill the other required fields validly, but give a malformed email.
      fireEvent.change(screen.getByLabelText(/cognito sub/i), {
        target: { value: "sub-123" },
      });
      fireEvent.change(screen.getByLabelText(/full name/i), {
        target: { value: "Ada Lovelace" },
      });
      fireEvent.change(screen.getByLabelText(/^email/i), {
        target: { value: "not-an-email" },
      });

      fireEvent.submit(screen.getByRole("form", { name: /create user/i }));

      // Only the email field should report an error, and it must be the format message.
      const alerts = screen.getAllByRole("alert");
      const messages = alerts.map((a) => a.textContent ?? "");
      expect(messages).toContain("Enter a valid email address.");
      expect(messages).not.toContain("Cognito sub is required.");
      expect(messages).not.toContain("Full name is required.");

      // Still blocked — no success view.
      expect(screen.queryByText("User created.")).toBeNull();
    });
  });

  describe("UserDetailScreen not-found view (Req 8.4)", () => {
    it("shows the not-found message when a lookup yields a 404", async () => {
      // Stub fetch so the live user client's getUser resolves to a 404, which the
      // request layer normalizes to ApiError.notFound. This drives the real 404 path
      // deterministically with no backend.
      const notFoundBody = JSON.stringify({
        status: 404,
        error: "Not Found",
        message: "User not found.",
      });
      vi.stubGlobal(
        "fetch",
        vi.fn(() =>
          Promise.resolve(
            new Response(notFoundBody, {
              status: 404,
              headers: { "Content-Type": "application/json" },
            }),
          ),
        ),
      );

      renderWithClient(<UserDetailScreen />);

      // Type an unknown id and submit the lookup.
      fireEvent.change(screen.getByLabelText(/user id/i), {
        target: { value: "unknown-id-" + Math.random().toString(16).slice(2) },
      });
      fireEvent.submit(screen.getByRole("form", { name: /look up user/i }));

      // The not-found message appears once the query settles.
      await waitFor(() => {
        const alerts = screen.getAllByRole("alert");
        const messages = alerts.map((a) => a.textContent ?? "");
        expect(messages.some((m) => /no user found/i.test(m))).toBe(true);
      });

      // The lookup was attempted (fetch was called).
      expect(fetch).toHaveBeenCalledTimes(1);
    });
  });
});
