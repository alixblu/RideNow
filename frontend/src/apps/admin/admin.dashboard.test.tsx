/**
 * Component tests for the Admin_Dashboard (Req 6.1, 6.5, 6.6).
 *
 * - Drawer: at a narrow viewport (matchMedia stub) the sidebar collapses into a menu
 *   button that opens a drawer; at desktop width the sidebar is persistent.
 * - Row selection opens the detail panel without leaving the destination.
 * - Typing in search resets pagination to page 1.
 */
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { IdentityContext } from "../../identity/IdentityContext";
import type { IdentityApi } from "../../identity/types";
import { AdminLayout } from "./AdminLayout";
import { DataTablePage } from "./DataTablePage";
import type { Column } from "./table";

function stubMatchMedia(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    (query: string) => ({
      matches,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
      onchange: null,
    }),
  );
}

const identityApi: IdentityApi = {
  identity: { role: "admin", id: "admin-1" },
  signIn: () => {},
  signOut: () => {},
  current: () => ({ role: "admin", id: "admin-1" }),
};

function renderLayout() {
  return render(
    <IdentityContext.Provider value={identityApi}>
      <MemoryRouter initialEntries={["/admin"]}>
        <Routes>
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<div>Overview content</div>} />
            <Route path="trips" element={<div>Trips content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </IdentityContext.Provider>,
  );
}

interface Row {
  id: string;
  name: string;
}

const columns: Column<Row>[] = [
  { key: "id", header: "ID", cell: (r) => r.id, text: (r) => r.id },
  { key: "name", header: "Name", cell: (r) => r.name, text: (r) => r.name },
];

const rows: Row[] = Array.from({ length: 25 }, (_, i) => ({
  id: `row-${String(i + 1).padStart(2, "0")}`,
  name: i === 22 ? "Zed Special" : `Person ${i + 1}`,
}));

function renderTable() {
  const load = () => Promise.resolve(rows);
  return render(
    <DataTablePage<Row>
      title="Riders"
      columns={columns}
      load={load}
      rowKey={(r) => r.id}
      detailTitle={(r) => `Detail ${r.name}`}
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Admin_Dashboard layout (Req 6.1, 6.6)", () => {
  it("collapses the sidebar into a menu button that opens and closes a drawer at narrow width", () => {
    stubMatchMedia(false);
    renderLayout();

    expect(screen.queryByTestId("admin-sidebar")).toBeNull();
    expect(screen.queryByTestId("admin-drawer")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    const drawer = screen.getByTestId("admin-drawer");
    expect(within(drawer).getByRole("link", { name: "Trips" })).toBeInTheDocument();

    // Navigating from the drawer closes it.
    fireEvent.click(within(drawer).getByRole("link", { name: "Trips" }));
    expect(screen.queryByTestId("admin-drawer")).toBeNull();
    expect(screen.getByText("Trips content")).toBeInTheDocument();

    // Reopen and close with the close button.
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    fireEvent.click(screen.getByRole("button", { name: "Close menu" }));
    expect(screen.queryByTestId("admin-drawer")).toBeNull();
  });

  it("shows a persistent sidebar and no menu button at desktop width", () => {
    stubMatchMedia(true);
    renderLayout();

    expect(screen.getByTestId("admin-sidebar")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open menu" })).toBeNull();
  });
});

describe("Admin_Dashboard data table (Req 6.5)", () => {
  it("opens a detail panel when a row is selected and closes it again", async () => {
    renderTable();

    const body = await screen.findAllByTestId("table-row");
    expect(screen.queryByTestId("detail-panel")).toBeNull();

    fireEvent.click(body[1]!);

    const panel = screen.getByTestId("detail-panel");
    expect(within(panel).getByText("Detail Person 2")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Riders" })).toBeInTheDocument();

    fireEvent.click(within(panel).getByRole("button", { name: "Close detail" }));
    expect(screen.queryByTestId("detail-panel")).toBeNull();
  });

  it("resets to page 1 when the search text changes", async () => {
    renderTable();

    await screen.findAllByTestId("table-row");
    expect(screen.getByTestId("page-indicator")).toHaveTextContent("Page 1 of 3");

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByTestId("page-indicator")).toHaveTextContent("Page 2 of 3");

    // "row-" matches all 25 rows, so three pages remain but the page must reset.
    fireEvent.change(screen.getByLabelText("Search riders"), {
      target: { value: "ROW-" },
    });
    expect(screen.getByTestId("page-indicator")).toHaveTextContent("Page 1 of 3");

    // A narrowing query filters case-insensitively.
    fireEvent.change(screen.getByLabelText("Search riders"), {
      target: { value: "zed special" },
    });
    expect(screen.getAllByTestId("table-row")).toHaveLength(1);
    expect(screen.getByTestId("page-indicator")).toHaveTextContent("Page 1 of 1");
  });
});
