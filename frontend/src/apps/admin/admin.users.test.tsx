/**
 * Unit tests for the Admin_Console directory-first experience.
 *
 * Feature: ridenow-frontend — Admin area (directory browse + create + lookup).
 *
 * Covers the reworked admin surfaces (Req 8.1–8.5, 12.4, 13.1–13.3):
 *   - Directory (primary): lists users from the live list endpoint and opens a user's
 *     full record on selection; empty, loading, and unavailable states are handled.
 *   - CreateUserScreen (secondary): client-side validation blocks submission and shows
 *     a field-level message for each blank required field, and rejects an obviously
 *     malformed email before any request (Req 8.2). On success it refetches the
 *     directory so the new account appears.
 *   - UserDetailScreen (secondary look-up): a 404 lookup surfaces a not-found message
 *     (Req 8.4).
 *
 * The user Service_Client is resolved internally by the screens via
 * `resolveUserClient(appConfig)`, so we replace the whole `../../domain/user` module
 * with a hoisted mock and drive `listUsers` / `createUser` / `getUser` directly. Each
 * test renders inside a fresh QueryClientProvider (retries off) + MemoryRouter, and the
 * full-console tests mount DevIdentityProvider with an admin identity set through the
 * real switcher so the identity guard passes.
 */
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  within,
} from "@testing-library/react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";
import { ApiError } from "../../http/ApiError";
import type { Page, UserResponse } from "../../domain/user";
import { DevIdentityProvider } from "../../identity/DevIdentityProvider";
import { AdminConsole } from "./AdminConsole";
import { CreateUserScreen } from "./CreateUserScreen";
import { UserDetailScreen } from "./UserDetailScreen";
import { UserDirectory } from "./UserDirectory";

// --- Hoisted mock of the user domain -------------------------------------------------
// The mock client's methods are vi.fns we can configure per test. resolveUserClient
// always returns the same object so every screen shares the configured behaviour.
const userClientMock = vi.hoisted(() => ({
  createUser: vi.fn(),
  getUser: vi.fn(),
  listUsers: vi.fn(),
}));

vi.mock("../../domain/user", () => ({
  resolveUserClient: () => userClientMock,
}));

/** A QueryClient with retries off so error states appear without delay in tests. */
function newQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

/** Render a screen wrapped in a fresh QueryClientProvider + MemoryRouter (isolated). */
function renderWithClient(ui: ReactElement) {
  return render(
    <QueryClientProvider client={newQueryClient()}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Render the full AdminConsole with an admin identity established via the switcher. */
function renderConsole() {
  const result = render(
    <QueryClientProvider client={newQueryClient()}>
      <MemoryRouter>
        <DevIdentityProvider>
          <AdminConsole />
        </DevIdentityProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const switcher = within(screen.getByLabelText("Development identity switcher"));
  fireEvent.change(switcher.getByLabelText("Role"), { target: { value: "admin" } });
  fireEvent.change(switcher.getByLabelText("Identifier"), {
    target: { value: "admin-1" },
  });
  fireEvent.click(switcher.getByRole("button", { name: "Set identity" }));
  return result;
}

/** Build a UserResponse with sensible defaults. */
function makeUser(overrides: Partial<UserResponse> = {}): UserResponse {
  return {
    id: "u-1",
    cognitoSub: "sub-1",
    email: "ada@example.com",
    phone: null,
    fullName: "Ada Lovelace",
    avatarUrl: null,
    status: "ACTIVE",
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

/** Build a one-page Page<UserResponse> around the given items. */
function page(items: UserResponse[]): Page<UserResponse> {
  return { items, total: items.length, limit: 20, offset: 0 };
}

beforeEach(() => {
  userClientMock.createUser.mockReset();
  userClientMock.getUser.mockReset();
  userClientMock.listUsers.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("Admin area — directory, create, and lookup", () => {
  describe("UserDirectory (Req 8.3, 13.1–13.3)", () => {
    it("lists users and opens the full record when a row is selected", async () => {
      const users = [
        makeUser({ id: "u-1", fullName: "Ada Lovelace", email: "ada@example.com" }),
        makeUser({
          id: "u-2",
          fullName: "Alan Turing",
          email: "alan@example.com",
          cognitoSub: "sub-2",
          status: "SUSPENDED",
        }),
      ];
      userClientMock.listUsers.mockResolvedValue(page(users));

      renderWithClient(<UserDirectory />);

      // Both users render in the directory table once the list resolves.
      const table = await screen.findByRole("table", { name: /users/i });
      expect(within(table).getByText("Ada Lovelace")).toBeInTheDocument();
      expect(within(table).getByText("Alan Turing")).toBeInTheDocument();

      // No detail shown until a row is selected.
      expect(screen.queryByLabelText("User detail")).toBeNull();

      // Selecting Alan opens his full record (browse-and-open, no second request).
      fireEvent.click(within(table).getByText("Alan Turing"));

      const detail = await screen.findByLabelText("User detail");
      expect(within(detail).getByText("sub-2")).toBeInTheDocument();
      expect(within(detail).getByText("alan@example.com")).toBeInTheDocument();
      // Opening a row uses the already-loaded data — getUser is not called.
      expect(userClientMock.getUser).not.toHaveBeenCalled();
    });

    it("shows the empty state when there are no users", async () => {
      userClientMock.listUsers.mockResolvedValue(page([]));

      renderWithClient(<UserDirectory />);

      expect(await screen.findByText(/no accounts yet/i)).toBeInTheDocument();
    });

    it("shows Unavailable with a Retry action when the list endpoint is down", async () => {
      userClientMock.listUsers.mockRejectedValue(ApiError.unavailable());

      renderWithClient(<UserDirectory />);

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(/unavailable/i);
      expect(within(alert).getByRole("button", { name: /retry/i })).toBeInTheDocument();
    });
  });

  describe("CreateUserScreen field-level validation (Req 8.2)", () => {
    it("blocks submission and shows a message for each blank required field", () => {
      renderWithClient(<CreateUserScreen />);

      fireEvent.submit(screen.getByRole("form", { name: /create user/i }));

      const messages = screen.getAllByRole("alert").map((a) => a.textContent ?? "");
      expect(messages).toContain("Cognito sub is required.");
      expect(messages).toContain("Email is required.");
      expect(messages).toContain("Full name is required.");

      // Submission was blocked: no request issued, no success view.
      expect(userClientMock.createUser).not.toHaveBeenCalled();
      expect(screen.queryByText("User created.")).toBeNull();
      expect(screen.queryByRole("status")).toBeNull();
    });

    it("rejects an invalid email with a field-level 'valid email' message", () => {
      renderWithClient(<CreateUserScreen />);

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

      const messages = screen.getAllByRole("alert").map((a) => a.textContent ?? "");
      expect(messages).toContain("Enter a valid email address.");
      expect(messages).not.toContain("Cognito sub is required.");
      expect(messages).not.toContain("Full name is required.");

      expect(userClientMock.createUser).not.toHaveBeenCalled();
      expect(screen.queryByText("User created.")).toBeNull();
    });
  });

  describe("Create success refetches the directory (Req 8.1)", () => {
    it("creates an account from the console and shows it in the directory", async () => {
      const created = makeUser({
        id: "u-9",
        fullName: "Grace Hopper",
        email: "grace@example.com",
        cognitoSub: "sub-9",
      });
      // Directory is empty first; after create it returns the new account.
      userClientMock.listUsers
        .mockResolvedValueOnce(page([]))
        .mockResolvedValue(page([created]));
      userClientMock.createUser.mockResolvedValue(created);

      renderConsole();

      // Directory is the primary surface; it starts empty.
      expect(await screen.findByText(/no accounts yet/i)).toBeInTheDocument();

      // Go to the secondary create action and fill valid fields.
      fireEvent.click(screen.getByRole("button", { name: "New account" }));

      fireEvent.change(screen.getByLabelText(/cognito sub/i), {
        target: { value: "sub-9" },
      });
      fireEvent.change(screen.getByLabelText(/^email/i), {
        target: { value: "grace@example.com" },
      });
      fireEvent.change(screen.getByLabelText(/full name/i), {
        target: { value: "Grace Hopper" },
      });

      fireEvent.submit(screen.getByRole("form", { name: /create user/i }));

      // The create request was issued with the trimmed required fields.
      await waitFor(() => {
        expect(userClientMock.createUser).toHaveBeenCalledWith({
          cognitoSub: "sub-9",
          email: "grace@example.com",
          fullName: "Grace Hopper",
        });
      });

      // Back on the directory, the refetched list now includes the new account.
      fireEvent.click(screen.getByRole("button", { name: "Directory" }));
      const table = await screen.findByRole("table", { name: /users/i });
      expect(within(table).getByText("Grace Hopper")).toBeInTheDocument();
      // The directory was refetched: two list calls (initial empty + post-create).
      expect(userClientMock.listUsers.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("UserDetailScreen not-found view (Req 8.4)", () => {
    it("shows the not-found message when a lookup yields a 404", async () => {
      userClientMock.getUser.mockRejectedValue(ApiError.notFound());

      renderWithClient(<UserDetailScreen />);

      fireEvent.change(screen.getByLabelText(/user id/i), {
        target: { value: "unknown-id" },
      });
      fireEvent.submit(screen.getByRole("form", { name: /look up user/i }));

      await waitFor(() => {
        const messages = screen.getAllByRole("alert").map((a) => a.textContent ?? "");
        expect(messages.some((m) => /no user found/i.test(m))).toBe(true);
      });
      expect(userClientMock.getUser).toHaveBeenCalledWith("unknown-id");
    });
  });
});
