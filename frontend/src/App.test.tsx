import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import App from "./App";
import { saveSession } from "./identity/sessionStore";
import { mockProfiles } from "./domain/seed/people";

// App owns providers and the route table; it needs a router context in tests
// (main.tsx supplies BrowserRouter in production). Sessions are seeded through
// saveSession so SessionIdentityProvider restores them on first render (Req 2.8).
function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

describe("App routing", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("redirects an unauthenticated visit to the sign-in screen", () => {
    renderAt("/rider");
    expect(screen.getByRole("heading", { name: "RideNow" })).toBeInTheDocument();
  });

  it("loads the lazy rider chunk for a stored rider Session", async () => {
    saveSession(localStorage, { role: "rider", id: mockProfiles.rider[0]!.userId });
    renderAt("/rider");
    expect(await screen.findByRole("link", { name: /activity/i }, { timeout: 5000 })).toBeInTheDocument();
  });

  it("redirects a rider away from /admin to the rider home", async () => {
    saveSession(localStorage, { role: "rider", id: mockProfiles.rider[0]!.userId });
    renderAt("/admin");
    expect(await screen.findByRole("link", { name: /activity/i }, { timeout: 5000 })).toBeInTheDocument();
  });

  it("redirects a signed-in user from /sign-in to their role home", async () => {
    saveSession(localStorage, { role: "driver", id: mockProfiles.driver[0]!.userId });
    renderAt("/sign-in");
    expect(await screen.findByRole("button", { name: /sign out/i }, { timeout: 5000 })).toBeInTheDocument();
  });
});

