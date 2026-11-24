/**
 * Component tests for SignInScreen and RolePicker (Req 2.2, 2.4, 2.5, 2.6).
 */
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { SessionIdentityProvider } from "../identity/SessionIdentityProvider";
import { mockProfiles } from "../identity/mockProfiles";
import { homeRouteFor } from "../identity/guard";
import type { Role } from "../identity/types";
import { PHONE_ERROR } from "./phone";
import { RolePicker } from "./RolePicker";
import { SignInScreen } from "./SignInScreen";

function Where() {
  const loc = useLocation();
  const state = loc.state as { phone?: string } | null;
  return (
    <div data-testid="where">
      {loc.pathname}|{state?.phone ?? ""}
    </div>
  );
}

function renderAt(entry: string | { pathname: string; state?: unknown }) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <SessionIdentityProvider>
        <Routes>
          <Route path="/sign-in" element={<SignInScreen />} />
          <Route path="/role" element={<RolePicker />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </SessionIdentityProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => localStorage.clear());
afterEach(() => cleanup());

describe("SignInScreen", () => {
  it("renders brand mark, phone input and Continue button", () => {
    renderAt("/sign-in");
    expect(screen.getByRole("heading", { name: "RideNow" })).toBeInTheDocument();
    expect(screen.getByLabelText("Phone number")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeInTheDocument();
  });

  it("shows a validation message and stays on the page for an invalid phone", () => {
    renderAt("/sign-in");
    fireEvent.change(screen.getByLabelText("Phone number"), { target: { value: "12ab" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByText(PHONE_ERROR)).toBeInTheDocument();
    expect(screen.getByLabelText("Phone number")).toBeInTheDocument();
    expect(screen.queryByTestId("where")).toBeNull();
  });

  it("navigates to /role with the phone digits for a valid phone", () => {
    renderAt("/sign-in");
    fireEvent.change(screen.getByLabelText("Phone number"), {
      target: { value: "0901 234 567" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("heading", { name: "Choose how to continue" })).toBeInTheDocument();
    expect(screen.queryByText(PHONE_ERROR)).toBeNull();
  });
});

describe("RolePicker", () => {
  const withPhone = { pathname: "/role", state: { phone: "0901234567" } };

  it("redirects to sign-in when there is no phone state", () => {
    renderAt("/role");
    expect(screen.getByRole("heading", { name: "RideNow" })).toBeInTheDocument();
  });

  it.each<[Role, string]>([
    ["rider", "Rider"],
    ["driver", "Driver"],
    ["admin", "Admin"],
  ])("lists a profile per seed profile for the %s role", (role, label) => {
    renderAt(withPhone);
    fireEvent.click(screen.getByRole("button", { name: label }));
    const list = screen.getByRole("list", { name: `${role} profiles` });
    const items = list.querySelectorAll("li");
    expect(items.length).toBe(mockProfiles[role].length);
    for (const p of mockProfiles[role]) {
      expect(screen.getByText(p.name)).toBeInTheDocument();
    }
  });

  it.each<Role>(["rider", "driver", "admin"])(
    "selecting a %s profile signs in and navigates to the role home",
    (role) => {
      renderAt(withPhone);
      const profile = mockProfiles[role][0]!;
      fireEvent.click(
        screen.getByRole("button", { name: role[0]!.toUpperCase() + role.slice(1) }),
      );
      fireEvent.click(screen.getByText(profile.name));
      const expected = homeRouteFor({ role, id: profile.userId });
      expect(screen.getByTestId("where").textContent).toBe(`${expected}|`);
      expect(localStorage.length).toBeGreaterThan(0);
    },
  );
});
