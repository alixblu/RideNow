/**
 * driver.roster.test.tsx — the roster-first Driver_App flow.
 *
 * Tag: Feature: ridenow-frontend, driver roster
 *
 * The driver area leads with a ROSTER: browse the live driver list, open one by
 * selecting a row, see its profile + vehicles + status toggle, and accept SEARCHING
 * trips through the real accept endpoint. These tests drive that flow against stubbed
 * driver + trip Service_Clients (via vi.mock + vi.hoisted) with a driver identity set
 * through the DevIdentityProvider, mirroring the rider test harness. They cover:
 *   - the roster lists drivers and opening a row shows that driver's detail;
 *   - the status filter passes the selected status through to listDrivers;
 *   - add-vehicle validation blocks submission on missing fields;
 *   - the status toggle calls changeStatus;
 *   - "Available rides" lists SEARCHING trips;
 *   - Accept success refetches the list (the ride drops out);
 *   - Accept 409 shows "This ride was just taken" and refetches;
 *   - accepting requires a driver to be opened first.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, it, expect, vi } from "vitest";
import { useEffect } from "react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import type { DriverResponse, Page } from "../../domain/driver";
import type { VehicleResponse } from "../../domain/vehicle";
import type { TripResponse } from "../../domain/trip";
import { ApiError } from "../../http/ApiError";

// Hoisted so the vi.mock factories can reference them before module init.
const {
  createDriver,
  listDrivers,
  getDriver,
  addVehicle,
  listVehicles,
  changeStatus,
  getVehicle,
  listTrips,
  acceptTrip,
} = vi.hoisted(() => ({
  createDriver: vi.fn(),
  listDrivers: vi.fn(),
  getDriver: vi.fn(),
  addVehicle: vi.fn(),
  listVehicles: vi.fn(),
  changeStatus: vi.fn(),
  getVehicle: vi.fn(),
  listTrips: vi.fn(),
  acceptTrip: vi.fn(),
}));

vi.mock("../../domain/driver", () => ({
  resolveDriverClient: () => ({
    createDriver,
    listDrivers,
    getDriver,
    addVehicle,
    listVehicles,
    changeStatus,
    getVehicle,
  }),
}));
vi.mock("../../domain/trip", () => ({
  resolveTripClient: () => ({ listTrips, acceptTrip }),
}));

import { DriverApp } from "./DriverApp";
import { DevIdentityProvider } from "../../identity/DevIdentityProvider";
import { useCurrentIdentity } from "../../identity/useCurrentIdentity";
import { ToastProvider } from "../../shared/ui";

const DRIVER_ID = "driver-acct-1";

function makeDriver(overrides: Partial<DriverResponse> = {}): DriverResponse {
  return {
    id: "driver-1",
    userId: "user-1",
    licenseNumber: "LIC-001",
    status: "ACTIVE",
    averageRating: 4.8,
    totalTrips: 12,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function driverPage(items: DriverResponse[]): Page<DriverResponse> {
  return { items, total: items.length, limit: 20, offset: 0 };
}

function makeVehicle(overrides: Partial<VehicleResponse> = {}): VehicleResponse {
  return {
    id: "vehicle-1",
    driverId: "driver-1",
    plateNumber: "ABC-123",
    vehicleType: "CAR",
    brand: "Toyota",
    model: "Vios",
    color: "White",
    active: true,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeTrip(overrides: Partial<TripResponse> = {}): TripResponse {
  return {
    id: "trip-1",
    passengerId: "rider-1",
    driverId: null,
    vehicleId: null,
    rideType: "CAR",
    pickupLat: 10.7725,
    pickupLng: 106.698,
    pickupAddress: null,
    destinationLat: 10.7797,
    destinationLng: 106.699,
    destinationAddress: null,
    status: "SEARCHING",
    estimatedFare: null,
    finalFare: null,
    cancellationReason: null,
    version: 0,
    requestedAt: "2024-01-01T00:00:00.000Z",
    acceptedAt: null,
    arrivedAt: null,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function tripPage(items: TripResponse[]): Page<TripResponse> {
  return { items, total: items.length, limit: 20, offset: 0 };
}

/** Sets a driver identity, then renders children once it exists. */
function DriverHarness({ children }: { children: ReactElement }) {
  const identity = useCurrentIdentity();
  const hasIdentity = identity.current("driver") !== null;
  useEffect(() => {
    if (!hasIdentity) {
      identity.set({ role: "driver", id: DRIVER_ID });
    }
  }, [hasIdentity, identity]);
  return hasIdentity ? children : null;
}

function renderDriver() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <DevIdentityProvider>
            <DriverHarness>
              <DriverApp />
            </DriverHarness>
          </DevIdentityProvider>
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Feature: ridenow-frontend, driver roster", () => {
  it("lists drivers in the roster and opens a selected row's detail", async () => {
    listDrivers.mockResolvedValue(driverPage([makeDriver()]));
    listTrips.mockResolvedValue(tripPage([]));
    getDriver.mockResolvedValue(makeDriver());
    listVehicles.mockResolvedValue([]);

    renderDriver();

    // The roster shows the driver's license number.
    expect(await screen.findByText("LIC-001")).toBeInTheDocument();

    // Opening the row fetches and shows that driver's detail.
    fireEvent.click(screen.getByRole("button", { name: "Open driver LIC-001" }));

    await waitFor(() => {
      expect(getDriver).toHaveBeenCalledWith("driver-1");
    });
    expect(
      await screen.findByRole("heading", { name: "Driver" }),
    ).toBeInTheDocument();
    expect(screen.getByText("user-1")).toBeInTheDocument();
  });

  it("passes the selected status filter through to listDrivers", async () => {
    listDrivers.mockResolvedValue(driverPage([]));
    listTrips.mockResolvedValue(tripPage([]));

    renderDriver();

    await waitFor(() => {
      expect(listDrivers).toHaveBeenCalledWith({});
    });

    fireEvent.change(screen.getByLabelText("Filter by status"), {
      target: { value: "SUSPENDED" },
    });

    await waitFor(() => {
      expect(listDrivers).toHaveBeenCalledWith({ status: "SUSPENDED" });
    });
  });

  it("blocks add-vehicle submission when required fields are missing", async () => {
    listDrivers.mockResolvedValue(driverPage([makeDriver()]));
    listTrips.mockResolvedValue(tripPage([]));
    getDriver.mockResolvedValue(makeDriver());
    listVehicles.mockResolvedValue([]);

    renderDriver();

    fireEvent.click(await screen.findByRole("button", { name: "Open driver LIC-001" }));

    // Submit the add-vehicle form with no plate/type.
    const addButton = await screen.findByRole("button", { name: "Add vehicle" });
    fireEvent.click(addButton);

    expect(await screen.findByText("Plate number is required.")).toBeInTheDocument();
    expect(screen.getByText("Vehicle type is required.")).toBeInTheDocument();
    expect(addVehicle).not.toHaveBeenCalled();
  });

  it("adds a vehicle when the required fields are supplied", async () => {
    listDrivers.mockResolvedValue(driverPage([makeDriver()]));
    listTrips.mockResolvedValue(tripPage([]));
    getDriver.mockResolvedValue(makeDriver());
    listVehicles.mockResolvedValue([]);
    addVehicle.mockResolvedValue(makeVehicle());

    renderDriver();

    fireEvent.click(await screen.findByRole("button", { name: "Open driver LIC-001" }));

    fireEvent.change(await screen.findByLabelText("Plate number"), {
      target: { value: "XYZ-999" },
    });
    fireEvent.change(screen.getByLabelText("Vehicle type"), {
      target: { value: "MOTORBIKE" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add vehicle" }));

    await waitFor(() => {
      expect(addVehicle).toHaveBeenCalledWith("driver-1", {
        plateNumber: "XYZ-999",
        vehicleType: "MOTORBIKE",
      });
    });
  });

  it("changes a driver's status through the toggle", async () => {
    listDrivers.mockResolvedValue(driverPage([makeDriver({ status: "ACTIVE" })]));
    listTrips.mockResolvedValue(tripPage([]));
    getDriver.mockResolvedValue(makeDriver({ status: "ACTIVE" }));
    listVehicles.mockResolvedValue([]);
    changeStatus.mockResolvedValue(makeDriver({ status: "SUSPENDED" }));

    renderDriver();

    fireEvent.click(await screen.findByRole("button", { name: "Open driver LIC-001" }));

    // Select SUSPENDED in the segmented toggle, then apply.
    const group = await screen.findByRole("group", { name: "Change status" });
    fireEvent.click(within(group).getByRole("button", { name: "SUSPENDED" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() => {
      expect(changeStatus).toHaveBeenCalledWith("driver-1", "SUSPENDED");
    });
  });

  it("lists SEARCHING trips in the available rides panel", async () => {
    listDrivers.mockResolvedValue(driverPage([]));
    listTrips.mockResolvedValue(tripPage([makeTrip({ id: "trip-7" })]));

    renderDriver();

    await waitFor(() => {
      expect(listTrips).toHaveBeenCalledWith({ status: "SEARCHING" });
    });

    const list = await screen.findByRole("list", { name: "Available rides" });
    expect(within(list).getAllByRole("button", { name: "Accept" })).toHaveLength(1);
  });

  it("accepts a ride and refetches so the taken ride drops out", async () => {
    listDrivers.mockResolvedValue(driverPage([makeDriver()]));
    getDriver.mockResolvedValue(makeDriver());
    listVehicles.mockResolvedValue([]);
    // First the ride is available; after acceptance the refetch returns an empty list.
    listTrips
      .mockResolvedValueOnce(tripPage([makeTrip({ id: "trip-7" })]))
      .mockResolvedValue(tripPage([]));
    acceptTrip.mockResolvedValue(
      makeTrip({ id: "trip-7", status: "DRIVER_ASSIGNED", driverId: "driver-1" }),
    );

    renderDriver();

    // Open a driver first (required to accept).
    fireEvent.click(await screen.findByRole("button", { name: "Open driver LIC-001" }));

    const acceptButton = await screen.findByRole("button", { name: "Accept" });
    fireEvent.click(acceptButton);

    await waitFor(() => {
      expect(acceptTrip).toHaveBeenCalledWith("trip-7", "driver-1");
    });

    // The list refetched and the ride is gone.
    await waitFor(() => {
      expect(
        screen.getByText(/no rides are waiting for a driver/i),
      ).toBeInTheDocument();
    });
  });

  it("shows 'This ride was just taken' and refetches on a 409 conflict", async () => {
    listDrivers.mockResolvedValue(driverPage([makeDriver()]));
    getDriver.mockResolvedValue(makeDriver());
    listVehicles.mockResolvedValue([]);
    listTrips
      .mockResolvedValueOnce(tripPage([makeTrip({ id: "trip-7" })]))
      .mockResolvedValue(tripPage([]));
    acceptTrip.mockRejectedValue(ApiError.conflict("already taken"));

    renderDriver();

    fireEvent.click(await screen.findByRole("button", { name: "Open driver LIC-001" }));

    fireEvent.click(await screen.findByRole("button", { name: "Accept" }));

    await waitFor(() => {
      expect(acceptTrip).toHaveBeenCalledTimes(1);
    });
    // The curated "just taken" toast appears.
    expect(await screen.findByText("This ride was just taken.")).toBeInTheDocument();
    // And the list refetched (second listTrips call).
    await waitFor(() => {
      expect(listTrips).toHaveBeenCalledTimes(2);
    });
  });

  it("requires a driver to be opened before a ride can be accepted", async () => {
    listDrivers.mockResolvedValue(driverPage([makeDriver()]));
    listTrips.mockResolvedValue(tripPage([makeTrip({ id: "trip-7" })]));

    renderDriver();

    // The prompt to open a driver is shown, and Accept is disabled.
    expect(
      await screen.findByText(/open a driver from the roster to accept rides/i),
    ).toBeInTheDocument();
    const acceptButton = await screen.findByRole("button", { name: "Accept" });
    expect(acceptButton).toBeDisabled();

    fireEvent.click(acceptButton);
    expect(acceptTrip).not.toHaveBeenCalled();
  });
});
