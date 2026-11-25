/**
 * Component tests for the Driver_App screens (Req 5.5, 5.6, 5.7, 5.8).
 *
 * Screens are rendered with stubbed Service_Clients injected through their props and a
 * driver Session seeded in localStorage. The Leaflet map is replaced with a stub because
 * jsdom cannot render tiles.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ReactElement } from "react";
import type { DriverResponse, DriverServiceClientExt } from "../../domain/driver/contract";
import type { TripResponse, TripServiceClientExt } from "../../domain/trip/contract";
import type { VehicleResponse } from "../../domain/vehicle/contract";
import { SessionIdentityProvider } from "../../identity/SessionIdentityProvider";
import { SESSION_KEY, saveSession } from "../../identity/sessionStore";
import { mockProfiles } from "../../domain/seed/people";
import { NoopSnapper } from "../../map/roadSnapper";
import { ToastProvider } from "../../shared/ui";
import { formatVnd } from "../../shared/format";
import { AccountScreen } from "./AccountScreen";
import { DriveScreen } from "./DriveScreen";
import { DriverContext } from "./DriverContext";
import { DriverLayout } from "./DriverLayout";

vi.mock("../../map/MapCanvas", () => ({ MapCanvas: () => <div data-testid="map" /> }));

const profile = mockProfiles.driver[0]!;
const DRIVER_ID = "driver-1";
const DRIVER: DriverResponse = {
  id: DRIVER_ID,
  userId: profile.userId,
  licenseNumber: "LIC-123",
  status: "ACTIVE",
  averageRating: null,
  totalTrips: 0,
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
};

function makeTrip(overrides: Partial<TripResponse> = {}): TripResponse {
  return {
    id: "trip-1",
    passengerId: "rider-1",
    driverId: null,
    vehicleId: null,
    rideType: "CAR",
    pickupLat: 10.7725,
    pickupLng: 106.698,
    pickupAddress: "Ben Thanh Market",
    destinationLat: 10.7797,
    destinationLng: 106.699,
    destinationAddress: "Notre-Dame Cathedral",
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

function makeVehicle(overrides: Partial<VehicleResponse> = {}): VehicleResponse {
  return {
    id: "v-1",
    driverId: DRIVER_ID,
    plateNumber: "59X1-123.45",
    vehicleType: "MOTORBIKE",
    brand: "Honda",
    model: "Vision",
    color: "Red",
    active: true,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function idle(): Geolocation {
  return {
    watchPosition: () => 1,
    clearWatch: () => undefined,
    getCurrentPosition: () => undefined,
  } as unknown as Geolocation;
}

function renderApp(ui: ReactElement, path = "/") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <SessionIdentityProvider>
            <DriverContext.Provider value={DRIVER}>{ui}</DriverContext.Provider>
          </SessionIdentityProvider>
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  saveSession(localStorage, { role: "driver", id: DRIVER.userId });
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function tripStubs(offer: TripResponse, afterAccept: TripResponse) {
  const stubs = {
    listTrips: vi.fn().mockResolvedValue({ items: [offer], total: 1, limit: 20, offset: 0 }),
    estimateFares: vi.fn().mockResolvedValue([
      { vehicleType: "MOTORBIKE", amount: 20000, currency: "VND", distanceKm: 1.2, durationMin: 5 },
      { vehicleType: "CAR", amount: 45000, currency: "VND", distanceKm: 3.5, durationMin: 12 },
    ]),
    acceptTrip: vi.fn().mockResolvedValue(afterAccept),
    getTrip: vi.fn().mockResolvedValue(afterAccept),
    arriveTrip: vi.fn(),
    startTrip: vi.fn(),
    completeTrip: vi.fn(),
  };
  return stubs as unknown as typeof stubs & TripServiceClientExt;
}

function driverStubs() {
  const stubs = {
    goOnline: vi.fn().mockResolvedValue(undefined),
    goOffline: vi.fn().mockResolvedValue(undefined),
    updateLocation: vi.fn().mockResolvedValue(undefined),
  };
  return stubs as unknown as typeof stubs & DriverServiceClientExt;
}

async function goOnline(client: ReturnType<typeof driverStubs>) {
  const toggle = screen.getByRole("switch", { name: "Online" });
  expect(toggle).toHaveAttribute("aria-checked", "false");
  fireEvent.click(toggle);
  await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));
  expect(client.goOnline).toHaveBeenCalledWith(DRIVER_ID);
}

function renderDrive(trips: TripServiceClientExt, client: DriverServiceClientExt) {
  return renderApp(
    <DriveScreen
      client={client}
      tripClient={trips}
      snapper={new NoopSnapper()}
      geolocation={idle()}
      intervalMs={60_000}
    />,
  );
}

describe("DriveScreen", () => {
  it("shows the offline prompt and no offer while offline", () => {
    const trips = tripStubs(makeTrip(), makeTrip());
    renderDrive(trips, driverStubs());

    expect(screen.getByRole("switch", { name: "Online" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("Go online to start receiving trip offers.")).toBeInTheDocument();
    expect(screen.queryByText("New trip offer")).not.toBeInTheDocument();
    expect(trips.listTrips).not.toHaveBeenCalled();
  });

  it("shows the offer card with route, fare for the ride type, and distance, and Accept/Decline", async () => {
    const trips = tripStubs(makeTrip({ rideType: "CAR" }), makeTrip());
    const client = driverStubs();
    renderDrive(trips, client);
    await goOnline(client);

    const card = await screen.findByLabelText("Trip offer");
    expect(within(card).getByText("Ben Thanh Market")).toBeInTheDocument();
    expect(within(card).getByText("Notre-Dame Cathedral")).toBeInTheDocument();
    expect(await within(card).findByText(formatVnd(45000))).toBeInTheDocument();
    expect(within(card).getByText("3.5 km")).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Accept" })).toBeEnabled();
    expect(within(card).getByRole("button", { name: "Decline" })).toBeEnabled();
  });

  it("dismisses the offer on Decline", async () => {
    const trips = tripStubs(makeTrip(), makeTrip());
    const client = driverStubs();
    renderDrive(trips, client);
    await goOnline(client);

    fireEvent.click(await screen.findByRole("button", { name: "Decline" }));

    await waitFor(() => expect(screen.queryByLabelText("Trip offer")).not.toBeInTheDocument());
    expect(screen.getByText("Looking for trips")).toBeInTheDocument();
    expect(trips.acceptTrip).not.toHaveBeenCalled();
  });

  it.each([
    ["DRIVER_ASSIGNED", "I have arrived"],
    ["DRIVER_ARRIVED", "Start trip"],
    ["IN_PROGRESS", "Complete trip"],
  ] as const)("after accepting, status %s shows the single primary button '%s'", async (status, label) => {
    const accepted = makeTrip({ status, driverId: DRIVER_ID });
    const trips = tripStubs(makeTrip(), accepted);
    const client = driverStubs();
    renderDrive(trips, client);
    await goOnline(client);

    fireEvent.click(await screen.findByRole("button", { name: "Accept" }));

    expect(await screen.findByRole("heading", { name: "Current trip" })).toBeInTheDocument();
    expect(trips.acceptTrip).toHaveBeenCalledWith("trip-1", DRIVER_ID);
    const sheet = screen.getByRole("heading", { name: "Current trip" }).closest("div")!.parentElement!;
    expect(await within(sheet).findByRole("button", { name: label })).toBeInTheDocument();
    // Lifecycle buttons only: the Simulation controls are a separate region (task 13.10).
    const lifecycle = within(sheet)
      .getAllByRole("button")
      .filter((b) => !b.closest('[aria-label="Simulation"]'));
    expect(lifecycle).toHaveLength(1);
    expect(within(sheet).getByRole("region", { name: "Simulation" })).toBeInTheDocument();
  });

  it("returns to the offer list when the accepted trip is COMPLETED", async () => {
    const accepted = makeTrip({ status: "COMPLETED", driverId: DRIVER_ID });
    const trips = tripStubs(makeTrip(), accepted);
    const client = driverStubs();
    renderDrive(trips, client);
    await goOnline(client);

    fireEvent.click(await screen.findByRole("button", { name: "Accept" }));

    await waitFor(() => expect(screen.queryByRole("heading", { name: "Current trip" })).not.toBeInTheDocument());
  });
});

describe("AccountScreen", () => {
  const users = {
    getUser: vi.fn().mockResolvedValue({ id: DRIVER.userId, fullName: "Tran Van Tai", email: "tai@example.com" }),
  };
  function accountClient(vehicles: VehicleResponse[]) {
    return { listVehicles: vi.fn().mockResolvedValue(vehicles) } as unknown as DriverServiceClientExt;
  }
  it("renders name, email, license, vehicles and a sign-out control, with no rating", async () => {
    const client = accountClient([makeVehicle()]);
    renderApp(<AccountScreen client={client} userClient={users} />);
    expect(await screen.findByText("Tran Van Tai")).toBeInTheDocument();
    expect(screen.getByText("tai@example.com")).toBeInTheDocument();
    expect(screen.getByText("LIC-123")).toBeInTheDocument();
    expect(client.listVehicles).toHaveBeenCalledWith(DRIVER_ID);
    expect(screen.queryByLabelText("Driver rating")).not.toBeInTheDocument();
    const vehicles = screen.getByRole("region", { name: "Vehicles" });
    expect(await within(vehicles).findByText("Honda Vision")).toBeInTheDocument();
    expect(within(vehicles).getByText(/59X1-123\.45/)).toBeInTheDocument();
    expect(within(vehicles).getByText("Motorbike")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });
  it("shows an empty vehicles state", async () => {
    renderApp(<AccountScreen client={accountClient([])} userClient={users} />);
    expect(await screen.findByText("No vehicles registered.")).toBeInTheDocument();
  });
  it("signs out: clears the session and leaves the screen", async () => {
    renderApp(
      <Routes>
        <Route path="/" element={<AccountScreen client={accountClient([])} userClient={users} />} />
        <Route path="*" element={<p>signed-out destination</p>} />
      </Routes>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(await screen.findByText("signed-out destination")).toBeInTheDocument();
    expect(localStorage.getItem(SESSION_KEY)).toBeNull();
  });
});
describe("DriverLayout", () => {
  it("offers Drive and Account in the bottom nav and hides Earnings", () => {
    renderApp(
      <Routes>
        <Route path="/" element={<DriverLayout />}>
          <Route index element={<p>content</p>} />
        </Route>
      </Routes>,
    );
    const nav = screen.getByRole("navigation", { name: "Driver" });
    expect(within(nav).getByRole("link", { name: /Drive/ })).toHaveAttribute("href", "/driver");
    expect(within(nav).queryByRole("link", { name: /Earnings/ })).not.toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: /Account/ })).toHaveAttribute("href", "/driver/account");
  });
});