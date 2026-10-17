import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect } from "vitest";
import App from "./App";

// Smoke test: confirms the toolchain is wired up and the App_Shell renders its
// brand chrome standalone (Req 1.5). App now owns the route table, so it needs a
// router context in tests; main.tsx supplies BrowserRouter in production.
// Richer shell/navigation tests land in tasks 6.2–6.4.
describe("App shell", () => {
  it("renders the RideNow brand", () => {
    render(
      <MemoryRouter initialEntries={["/rider"]}>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByText("RideNow")).toBeInTheDocument();
  });
});
