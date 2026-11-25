/**
 * Feature: frontend-booking-and-password-login, Property 10: The persisted Session
 * never contains a password
 *
 * **Validates: Requirements 3.12**
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import fc from "fast-check";
import { SessionIdentityProvider } from "../identity/SessionIdentityProvider";
import { SESSION_KEY } from "../identity/sessionStore";
import * as authApi from "./authApi";
import { SignInScreen } from "./SignInScreen";
import { SignUpScreen } from "./SignUpScreen";

vi.mock("./authApi", async () => {
  const actual = await vi.importActual<typeof import("./authApi")>("./authApi");
  return { ...actual, register: vi.fn(), login: vi.fn() };
});

const alnum = fc.stringMatching(/^[a-z0-9]{1,10}$/);
const email = fc.tuple(alnum, alnum, alnum).map(([a, b, c]) => `${a}@${b}.${c}`);
// The "!" prefix guarantees the password cannot coincide with the role/uuid text
// that legitimately appears in the persisted Session.
const password = fc.stringMatching(/^[A-Za-z0-9]{8,40}$/).map((s) => `!${s}`);
const accountType = fc.constantFrom<authApi.AccountType>("RIDER", "DRIVER");

function mount(ui: React.ReactElement) {
  return render(
    <SessionIdentityProvider>
      <MemoryRouter>{ui}</MemoryRouter>
    </SessionIdentityProvider>,
  );
}

function setValue(el: Element, value: string) {
  fireEvent.change(el, { target: { value } });
}

function allStoredText(): string {
  const parts: string[] = [];
  for (const store of [localStorage, sessionStorage]) {
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i)!;
      parts.push(key, store.getItem(key) ?? "");
    }
  }
  return parts.join("\n");
}

describe("Property 10: the persisted Session never contains a password", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.mocked(authApi.register).mockReset();
    vi.mocked(authApi.login).mockReset();
  });
  afterEach(cleanup);

  it("sign-up persists only role and id, never the password", async () => {
    await fc.assert(
      fc.asyncProperty(fc.uuid(), email, password, accountType, async (id, mail, pw, type) => {
        localStorage.clear();
        vi.mocked(authApi.register).mockResolvedValue({
          id,
          email: mail,
          fullName: "Test User",
          phone: null,
          status: "ACTIVE",
          accountType: type,
        });
        const { container, unmount } = mount(<SignUpScreen />);
        setValue(container.querySelector("#signup-name")!, "Test User");
        setValue(container.querySelector("#signup-email")!, mail);
        setValue(container.querySelector("#signup-password")!, pw);
        fireEvent.submit(container.querySelector("form")!);

        await waitFor(() => expect(localStorage.getItem(SESSION_KEY)).not.toBeNull());
        const raw = localStorage.getItem(SESSION_KEY)!;
        expect(JSON.parse(raw).id).toBe(id);
        expect(raw).not.toContain(pw);
        expect(allStoredText()).not.toContain(pw);
        unmount();
      }),
      { numRuns: 100 },
    );
  }, 60_000);

  it("sign-in persists only role and id, never the password", async () => {
    await fc.assert(
      fc.asyncProperty(fc.uuid(), email, password, accountType, async (id, mail, pw, type) => {
        localStorage.clear();
        vi.mocked(authApi.login).mockResolvedValue({
          id,
          email: mail,
          fullName: "Test User",
          phone: null,
          status: "ACTIVE",
          accountType: type,
        });
        const { container, unmount } = mount(<SignInScreen />);
        setValue(container.querySelector("#signin-email")!, mail);
        setValue(container.querySelector("#signin-password")!, pw);
        fireEvent.submit(container.querySelector("form")!);

        await waitFor(() => expect(localStorage.getItem(SESSION_KEY)).not.toBeNull());
        const raw = localStorage.getItem(SESSION_KEY)!;
        expect(JSON.parse(raw).id).toBe(id);
        expect(raw).not.toContain(pw);
        expect(allStoredText()).not.toContain(pw);
        unmount();
      }),
      { numRuns: 100 },
    );
  }, 60_000);
});
