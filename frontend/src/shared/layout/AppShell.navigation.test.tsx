/**
 * AppShell.navigation.test.tsx — Property 1: Identity preserved across navigation.
 *
 * Feature: ridenow-frontend, Property 1: Identity preserved across navigation.
 * Validates: Requirements 1.3.
 *
 * App.tsx mounts DevIdentityProvider ABOVE AppRoutes (which renders AppShell with
 * NavLinks to /rider, /driver, /admin). Because the provider sits outside every
 * area subtree, navigating between areas must never unmount it, so the
 * Current_Identity set before a navigation sequence must still be readable after it
 * (Req 1.3).
 *
 * This drives the REAL switcher UI (role <select>, identifier <input>, "Set
 * identity" button) to establish a Current_Identity, then clicks the nav links in a
 * generated sequence, and finally asserts the switcher's identity indicator still
 * shows the identity that was set. The switcher's role dropdown is left on the role
 * we set, so its "Current {role}: {id}" indicator reflects exactly that identity.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, it } from "vitest";
import fc from "fast-check";
import App from "../../App";

type Role = "rider" | "driver" | "admin";

// The nav labels rendered by AppShell (NavLink text) map 1:1 to areas.
const NAV_LABELS = ["Rider", "Driver", "Admin"] as const;

/** Render the full App_Shell (DevIdentityProvider + AppRoutes) under a router. */
function renderApp() {
  return render(
    <MemoryRouter initialEntries={["/rider"]}>
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

/** Click a nav link by its visible label to navigate between areas. */
function navigateTo(label: (typeof NAV_LABELS)[number]) {
  fireEvent.click(screen.getByRole("link", { name: label }));
}

afterEach(() => {
  cleanup();
});

describe("Feature: ridenow-frontend, Property 1: Identity preserved across navigation", () => {
  it("preserves the Current_Identity across any sequence of area navigations", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<Role>("rider", "driver", "admin"),
        // Non-empty identifier that is unchanged by the switcher's trim(): no
        // surrounding whitespace, and at least one visible character.
        fc
          .string({ minLength: 1, maxLength: 24 })
          .map((s) => s.replace(/\s/g, "x"))
          .filter((s) => s.trim().length > 0),
        fc.array(fc.constantFrom(...NAV_LABELS), { minLength: 1, maxLength: 6 }),
        (role, id, sequence) => {
          renderApp();
          try {
            // Establish the identity BEFORE navigating.
            setIdentity(role, id);

            // The switcher indicator reflects the just-set identity.
            const ui = switcher();
            ui.getByText(`Current ${role}: ${id}`);

            // Navigate among rider/driver/admin in the generated order.
            for (const label of sequence) {
              navigateTo(label);
            }

            // AFTER the sequence, the identity read from the switcher (which sits
            // above the router and is never unmounted) is unchanged.
            switcher().getByText(`Current ${role}: ${id}`);
          } finally {
            cleanup();
          }
        },
      ),
      { numRuns: 50 },
    );
  });
});
