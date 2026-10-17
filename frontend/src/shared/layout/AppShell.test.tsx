/**
 * AppShell.test.tsx — Task 6.4 unit tests.
 *
 * Feature: ridenow-frontend, Task 6.4: shell navigation and identity prompt.
 *
 * Covers the three unit-level behaviors the task calls for:
 *  - Req 1.1: the App_Shell presents all three selectable areas (Rider, Driver,
 *    Admin) as nav links.
 *  - Req 1.2: navigating to an area indicates it as active. NavLink sets
 *    aria-current="page" on the matched link, so we assert that attribute on the
 *    active link and its absence on the others.
 *  - Req 2.4: a role-specific screen shows the "set your identity" prompt while no
 *    Current_Identity is set for that role, and the prompt disappears once an
 *    identity is established through the dev switcher.
 *
 * These exercise the real composition (DevIdentityProvider + AppRoutes + AppShell)
 * under a MemoryRouter, mirroring the router render pattern in App.test.tsx. Only
 * fireEvent is used (user-event is not a dependency).
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, it, expect } from "vitest";
import App from "../../App";

type Role = "rider" | "driver" | "admin";

/** Render the full App_Shell (DevIdentityProvider + AppRoutes) under a router. */
function renderApp(initialEntries: string[]) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <App />
    </MemoryRouter>,
  );
}

/** Scope queries to the dev switcher so they never collide with page chrome. */
function switcher() {
  return within(screen.getByLabelText("Development identity switcher"));
}

/** Set the Current_Identity through the real switcher UI (role + id + commit). */
function setIdentity(role: Role, id: string) {
  const ui = switcher();
  fireEvent.change(ui.getByLabelText("Role"), { target: { value: role } });
  fireEvent.change(ui.getByLabelText("Identifier"), { target: { value: id } });
  fireEvent.click(ui.getByRole("button", { name: "Set identity" }));
}

afterEach(() => {
  cleanup();
});

describe("Feature: ridenow-frontend, Task 6.4: shell navigation and identity prompt", () => {
  it("renders all three selectable application areas as nav links (Req 1.1)", () => {
    renderApp(["/rider"]);

    // The nav chrome groups the three area links.
    const nav = within(screen.getByRole("navigation", { name: "Application areas" }));

    expect(nav.getByRole("link", { name: "Rider" })).toBeInTheDocument();
    expect(nav.getByRole("link", { name: "Driver" })).toBeInTheDocument();
    expect(nav.getByRole("link", { name: "Admin" })).toBeInTheDocument();
  });

  it("indicates the active area for the current route via aria-current (Req 1.2)", () => {
    renderApp(["/driver"]);

    const nav = within(screen.getByRole("navigation", { name: "Application areas" }));
    const riderLink = nav.getByRole("link", { name: "Rider" });
    const driverLink = nav.getByRole("link", { name: "Driver" });
    const adminLink = nav.getByRole("link", { name: "Admin" });

    // NavLink marks the matched area with aria-current="page"; only Driver matches.
    expect(driverLink).toHaveAttribute("aria-current", "page");
    expect(riderLink).not.toHaveAttribute("aria-current", "page");
    expect(adminLink).not.toHaveAttribute("aria-current", "page");

    // The active indicator is also reflected by the active CSS-module class.
    expect(driverLink.className).not.toEqual(riderLink.className);
  });

  it("shows the set-your-identity prompt when no identity is set for the area role (Req 2.4)", () => {
    renderApp(["/rider"]);

    // No Current_Identity yet: the rider screen renders the guard prompt.
    const prompt = screen.getByRole("status");
    expect(prompt).toHaveTextContent(/set your .*identity/i);
  });

  it("hides the identity prompt once a rider identity is set via the switcher (Req 2.4)", () => {
    renderApp(["/rider"]);

    // Guard is shown first...
    expect(screen.getByRole("status")).toHaveTextContent(/set your .*identity/i);

    // ...then establishing a rider identity through the switcher removes it and the
    // real rider screens render in its place. RiderApp no longer shows a placeholder;
    // it mounts the rider screens nav plus the Trip screen, so we assert that chrome
    // is present and the guard prompt is gone (Req 2.4).
    setIdentity("rider", "rider-123");

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: "Rider screens" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Request a trip" }),
    ).toBeInTheDocument();
  });
});
