/**
 * driver.errors.test.tsx — Task 11.5 unit tests.
 *
 * Feature: ridenow-frontend, Task 11.5: driver/vehicle not-found and conflict handling.
 *
 * These are concrete-example unit tests (not property-based) that exercise the two
 * client-error paths the driver screens must surface:
 *
 *  - Not-found (Req 5.4, 7.3): DriverLookupScreen.getDriver rejecting with
 *    ApiError.notFound() renders a user-facing not-found message rather than driver
 *    detail.
 *  - Conflict (Req 5.5, 6.6): a create-driver / add-vehicle mutation rejecting with
 *    ApiError.conflict renders the curated conflict message through ErrorBanner, and
 *    no stack trace / persistence internals leak (the ApiError.message is the only
 *    text shown).
 *
 * Each screen takes a `client: DriverServiceClient` prop. We hand it a vi.fn-based
 * stub whose methods reject with ApiError instances to simulate backend responses, so
 * no real fetch is involved. Renders are wrapped in a fresh QueryClientProvider per
 * test with retries disabled so a rejected query/mutation settles into its error state
 * immediately.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, it, expect, vi } from "vitest";
import type { ReactElement } from "react";
import type { DriverServiceClient } from "../../domain/driver";
import { ApiError } from "../../http/ApiError";
import { DriverLookupScreen } from "./DriverLookupScreen";
import { VehiclesScreen } from "./VehiclesScreen";
import { CreateDriverScreen } from "./CreateDriverScreen";

/**
 * A fully-stubbed DriverServiceClient. Every method is a vi.fn so a test can point a
 * single operation at a rejecting promise while the rest stay unused. Defaults reject
 * with a generic unavailable error so an unexpected call is obvious rather than silent.
 */
function makeStubClient(
  overrides: Partial<DriverServiceClient> = {},
): DriverServiceClient {
  return {
    createDriver: vi.fn(() => Promise.reject(ApiError.unavailable())),
    getDriver: vi.fn(() => Promise.reject(ApiError.unavailable())),
    addVehicle: vi.fn(() => Promise.reject(ApiError.unavailable())),
    listVehicles: vi.fn(() => Promise.resolve([])),
    changeStatus: vi.fn(() => Promise.reject(ApiError.unavailable())),
    getVehicle: vi.fn(() => Promise.reject(ApiError.unavailable())),
    ...overrides,
  };
}

/** Render a screen under a fresh QueryClient (retries off so errors surface at once). */
function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Feature: ridenow-frontend, Task 11.5: driver/vehicle not-found and conflict handling", () => {
  // -------------------------------------------------------------------------
  // Not-found (Req 5.4, 7.3)
  // -------------------------------------------------------------------------
  it("shows a not-found message when getDriver rejects with ApiError.notFound (Req 5.4, 7.3)", async () => {
    const getDriver = vi.fn(() => Promise.reject(ApiError.notFound()));
    const client = makeStubClient({ getDriver });
    renderWithClient(<DriverLookupScreen client={client} />);

    // Drive the lookup form: set an id and submit so the query runs.
    fireEvent.change(screen.getByLabelText("Driver ID"), {
      target: { value: "missing-driver-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Open" }));

    // The not-found branch renders a message naming the id; no driver detail appears.
    await waitFor(() => {
      expect(
        screen.getByText(/No driver found for id "missing-driver-1"\./i),
      ).toBeInTheDocument();
    });
    expect(getDriver).toHaveBeenCalledWith("missing-driver-1");
    // The driver detail view is not rendered for a not-found result.
    expect(
      screen.queryByRole("heading", { name: "Driver" }),
    ).not.toBeInTheDocument();
  });

  it("shows a not-found message when getVehicle rejects with ApiError.notFound (Req 5.4)", async () => {
    const getVehicle = vi.fn(() => Promise.reject(ApiError.notFound()));
    const client = makeStubClient({ getVehicle });
    renderWithClient(<VehiclesScreen client={client} />);

    // The vehicle lookup form is always present; set an id and open it.
    fireEvent.change(screen.getByLabelText("Vehicle ID"), {
      target: { value: "missing-vehicle-9" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Open" }));

    await waitFor(() => {
      expect(
        screen.getByText(/No vehicle found for id "missing-vehicle-9"\./i),
      ).toBeInTheDocument();
    });
    expect(getVehicle).toHaveBeenCalledWith("missing-vehicle-9");
  });

  // -------------------------------------------------------------------------
  // Conflict — create driver (Req 5.5)
  // -------------------------------------------------------------------------
  it("surfaces a sanitized conflict message when createDriver rejects with ApiError.conflict (Req 5.5)", async () => {
    const conflictMessage = "License number already exists.";
    const createDriver = vi.fn(() =>
      Promise.reject(ApiError.conflict(conflictMessage)),
    );
    const client = makeStubClient({ createDriver });
    renderWithClient(<CreateDriverScreen client={client} />);

    // Fill both required fields so client-side validation passes and the request fires.
    fireEvent.change(screen.getByLabelText("User ID"), {
      target: { value: "user-1" },
    });
    fireEvent.change(screen.getByLabelText("License number"), {
      target: { value: "LIC-123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create driver" }));

    // The curated conflict message is rendered via ErrorBanner (role="alert").
    const banner = await screen.findByRole("alert");
    expect(banner).toHaveTextContent(conflictMessage);
    expect(createDriver).toHaveBeenCalledTimes(1);

    // No raw backend internals leak: the rendered text is exactly the curated message,
    // with no stack-trace / persistence noise.
    expect(banner.textContent).toBe(conflictMessage);
    expect(banner.textContent).not.toMatch(/\bat\s+\w+\.\w+/i); // stack frames
    expect(banner.textContent).not.toMatch(/Exception|SQL|constraint|org\.|java\./i);
  });

  // -------------------------------------------------------------------------
  // Conflict — add vehicle (Req 6.6)
  // -------------------------------------------------------------------------
  it("surfaces a sanitized conflict message when addVehicle rejects with ApiError.conflict (Req 6.6)", async () => {
    const conflictMessage = "Plate number already registered.";
    const addVehicle = vi.fn(() =>
      Promise.reject(ApiError.conflict(conflictMessage)),
    );
    const client = makeStubClient({ addVehicle });
    renderWithClient(<VehiclesScreen client={client} />);

    // Scope the add form to a driver first.
    fireEvent.change(screen.getByLabelText("Driver ID"), {
      target: { value: "driver-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Use driver" }));

    // Fill the required add-vehicle fields (plate + type) and submit.
    fireEvent.change(screen.getByLabelText("Plate number"), {
      target: { value: "ABC-123" },
    });
    fireEvent.change(screen.getByLabelText("Vehicle type"), {
      target: { value: "CAR" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add vehicle" }));

    await waitFor(() => {
      expect(addVehicle).toHaveBeenCalledTimes(1);
    });
    expect(addVehicle).toHaveBeenCalledWith("driver-1", {
      plateNumber: "ABC-123",
      vehicleType: "CAR",
    });

    // The conflict message appears, curated and leak-free.
    const banner = await screen.findByText(conflictMessage);
    expect(banner).toHaveTextContent(conflictMessage);
    expect(banner.textContent).toBe(conflictMessage);
    expect(banner.textContent).not.toMatch(/Exception|SQL|constraint|org\.|java\./i);
  });
});
