/**
 * Unit tests for the sign-up and sign-in screens: success navigation, backend
 * 401/403/409 messages, session restore, sign-out and the /admin redirect.
 *
 * Validates: Requirements 3.4, 3.5, 3.7, 3.9, 3.11, 3.14, 12.4
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import App from "../App";
import { AccountScreen } from "../apps/rider/AccountScreen";
import { ApiError } from "../http/ApiError";
import { SessionIdentityProvider } from "../identity/SessionIdentityProvider";
import { saveSession, SESSION_KEY } from "../identity/sessionStore";
import * as authApi from "./authApi";
import { SignInScreen } from "./SignInScreen";
import { SignUpScreen } from "./SignUpScreen";

vi.mock("./authApi", async () => {
  const actual = await vi.importActual<typeof import("./authApi")>("./authApi");
  return { ...actual, register: vi.fn(), login: vi.fn() };
});

const user = (accountType: authApi.AccountType): authApi.AuthUser => ({
  id: "11111111-1111-1111-1111-111111111111",
  email: "a@b.co",
  fullName: "Ann Lee",
  phone: null,
  status: "ACTIVE",
  accountType,
});

function mountAt(path: string) {
  return render(
    <SessionIdentityProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/sign-in" element={<SignInScreen />} />
          <Route path="/sign-up" element={<SignUpScreen />} />
          <Route path="/rider" element={<p>rider home</p>} />
          <Route path="/driver" element={<p>driver home</p>} />
        </Routes>
      </MemoryRouter>
    </SessionIdentityProvider>,
  );
}

function type(selector: string, value: string) {
  fireEvent.change(document.querySelector(selector)!, { target: { value } });
}

function fillSignIn(email = "a@b.co", password = "password1") {
  type("#signin-email", email);
  type("#signin-password", password);
  fireEvent.submit(document.querySelector("form")!);
}

function fillSignUp(email = "a@b.co") {
  type("#signup-name", "Ann Lee");
  type("#signup-email", email);
  type("#signup-password", "password1");
}

describe("auth screens", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(authApi.register).mockReset();
    vi.mocked(authApi.login).mockReset();
  });
  afterEach(cleanup);

  describe("sign-up", () => {
    it("registers a rider, stores the Session and navigates to /rider", async () => {
      vi.mocked(authApi.register).mockResolvedValue(user("RIDER"));
      mountAt("/sign-up");
      fillSignUp();
      fireEvent.submit(document.querySelector("form")!);

      expect(await screen.findByText("rider home")).toBeInTheDocument();
      expect(authApi.register).toHaveBeenCalledWith({
        fullName: "Ann Lee",
        email: "a@b.co",
        password: "password1",
        accountType: "RIDER",
      });
      expect(JSON.parse(localStorage.getItem(SESSION_KEY)!)).toEqual({
        role: "rider",
        id: user("RIDER").id,
      });
    });

    it("registers a driver and navigates to /driver", async () => {
      vi.mocked(authApi.register).mockResolvedValue(user("DRIVER"));
      mountAt("/sign-up");
      fillSignUp();
      fireEvent.click(screen.getByRole("radio", { name: "Drive" }));
      fireEvent.submit(document.querySelector("form")!);

      expect(await screen.findByText("driver home")).toBeInTheDocument();
      expect(vi.mocked(authApi.register).mock.calls[0]![0].accountType).toBe("DRIVER");
    });

    it("shows the backend 409 message above the submit button and keeps the email", async () => {
      vi.mocked(authApi.register).mockRejectedValue(ApiError.conflict("Email already registered"));
      mountAt("/sign-up");
      fillSignUp("dup@b.co");
      fireEvent.submit(document.querySelector("form")!);

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("Email already registered");
      expect(document.querySelector<HTMLInputElement>("#signup-email")!.value).toBe("dup@b.co");
      expect(localStorage.getItem(SESSION_KEY)).toBeNull();
    });
  });

  describe("sign-in", () => {
    it("logs a driver in and navigates to /driver", async () => {
      vi.mocked(authApi.login).mockResolvedValue(user("DRIVER"));
      mountAt("/sign-in");
      fillSignIn();

      expect(await screen.findByText("driver home")).toBeInTheDocument();
      expect(authApi.login).toHaveBeenCalledWith({ email: "a@b.co", password: "password1" });
      expect(JSON.parse(localStorage.getItem(SESSION_KEY)!).role).toBe("driver");
    });

    it("logs a rider in and navigates to /rider", async () => {
      vi.mocked(authApi.login).mockResolvedValue(user("RIDER"));
      mountAt("/sign-in");
      fillSignIn();
      expect(await screen.findByText("rider home")).toBeInTheDocument();
    });

    it.each([
      [401, "Invalid email or password"],
      [403, "This account is suspended"],
    ])("shows the backend %i message and keeps the email", async (status, message) => {
      vi.mocked(authApi.login).mockRejectedValue(new ApiError(status, "VALIDATION", message));
      mountAt("/sign-in");
      fillSignIn("keep@b.co");

      expect(await screen.findByRole("alert")).toHaveTextContent(message);
      expect(document.querySelector<HTMLInputElement>("#signin-email")!.value).toBe("keep@b.co");
      expect(localStorage.getItem(SESSION_KEY)).toBeNull();
    });

    it("shows the backend 409 message", async () => {
      vi.mocked(authApi.login).mockRejectedValue(ApiError.conflict("Account conflict"));
      mountAt("/sign-in");
      fillSignIn();
      expect(await screen.findByRole("alert")).toHaveTextContent("Account conflict");
    });
  });

  describe("session restore, sign-out and admin redirect", () => {
    it("restores a stored Session without showing the Auth_Screen", async () => {
      saveSession(localStorage, { role: "driver", id: "d-1" });
      render(
        <MemoryRouter initialEntries={["/sign-in"]}>
          <App />
        </MemoryRouter>,
      );
      expect(await screen.findByRole("link", { name: /account/i }, { timeout: 5000 })).toBeInTheDocument();
      expect(screen.queryByText("Sign in to your account")).not.toBeInTheDocument();
    });

    it("sign-out deletes the Session and navigates to /sign-in", async () => {
      saveSession(localStorage, { role: "rider", id: "r-1" });
      render(
        <SessionIdentityProvider>
          <MemoryRouter initialEntries={["/rider/account"]}>
            <Routes>
              <Route path="/rider/account" element={<AccountScreen />} />
              <Route path="/sign-in" element={<p>signed-out destination</p>} />
            </Routes>
          </MemoryRouter>
        </SessionIdentityProvider>,
      );
      fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

      expect(await screen.findByText("signed-out destination")).toBeInTheDocument();
      expect(localStorage.getItem(SESSION_KEY)).toBeNull();
    });

    it("redirects /admin to /sign-in when there is no Session", async () => {
      render(
        <MemoryRouter initialEntries={["/admin"]}>
          <App />
        </MemoryRouter>,
      );
      await waitFor(() =>
        expect(screen.getByText("Sign in to your account")).toBeInTheDocument(),
      );
    });

    it("redirects /admin to the Account_Type home when a Session exists", async () => {
      saveSession(localStorage, { role: "rider", id: "r-1" });
      render(
        <MemoryRouter initialEntries={["/admin"]}>
          <App />
        </MemoryRouter>,
      );
      expect(await screen.findByRole("link", { name: /activity/i }, { timeout: 5000 })).toBeInTheDocument();
      expect(screen.queryByText("Sign in to your account")).not.toBeInTheDocument();
    });
  });
});
