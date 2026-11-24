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
import type { DriverServiceClientExt } from "../../domain/driver/contract";
import type { TripResponse, TripServiceClientExt } from "../../domain/trip/contract";
import type { VehicleResponse } from "../../domain/vehicle/contract";
import { SessionIdentityProvider } from "../../identity/SessionIdentityProvider";
import { SESSION_KEY, saveSession } from "../../identity/sessionStore";
import { mockProfiles } from "../../identity/mockProfiles";
import { NoopSnapper } from "../../map/roadSnapper";
import { ToastProvider } from "../../shared/ui";
import { formatVnd } from "../../shared/format";
import { AccountScreen } from "./AccountScreen";
import { DriveScreen } from "./DriveScreen";
import { DriverLayout } from "./DriverLayout";
import { EarningsScreen } from "./EarningsScreen";

vi.mock("../../map/MapCanvas", () => ({ MapCanvas: () => <div data-testid="map" /> }));

const profile = mockProfiles.driver[0]!;
const DRIVER_ID = profile.userId;

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
          <SessionIdentityProvider>{ui}</SessionIdentityProvider>
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  saveSession(localStorage, { role: "driver", id: DRIVER_ID });
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
    ["DRIVER_ASSIGNED", "Arrived at pickup"],
    ["DRIVER_ARRIVED", "Start trip"],
    ["IN_PROGRESS", "Complete trip"],
    ["COMPLETED", "Done"],
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
    expect(within(sheet).getAllByRole("button")).toHaveLength(1);
  });
});

describe("EarningsScreen", () => {
  it("renders today and week totals and each completed trip with its fare", async () => {
    const trips = {
      getEarnings: vi.fn().mockResolvedValue({
        todayTotal: 120000,
        weekTotal: 560000,
        trips: [
          { tripId: "t1", completedAt: "2025-06-15T01:00:00.000Z", fare: 45000, route: "Ben Thanh to Landmark 81" },
          { tripId: "t2", completedAt: "2025-06-14T01:00:00.000Z", fare: 75000, route: "Airport to District 1" },
        ],
      }),
    } as unknown as TripServiceClientExt;
    renderApp(<EarningsScreen tripClient={trips} />);

    expect(await screen.findByTestId("earnings-today")).toHaveTextContent(formatVnd(120000));
    expect(screen.getByTestId("earnings-week")).toHaveTextContent(formatVnd(560000));
    expect(trips.getEarnings).toHaveBeenCalledWith(DRIVER_ID);

    const items = within(screen.getByRole("region", { name: "Completed trips" })).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(within(items[0]!).getByText("Ben Thanh to Landmark 81")).toBeInTheDocument();
    expect(within(items[0]!).getByText(formatVnd(45000))).toBeInTheDocument();
    expect(within(items[1]!).getByText(formatVnd(75000))).toBeInTheDocument();
  });

  it("shows an empty state when there are no completed trips", async () => {
    const trips = {
      getEarnings: vi.fn().mockResolvedValue({ todayTotal: 0, weekTotal: 0, trips: [] }),
    } as unknown as TripServiceClientExt;
    renderApp(<EarningsScreen tripClient={trips} />);

    expect(await screen.findByText("No completed trips yet.")).toBeInTheDocument();
    expect(screen.getByTestId("earnings-today")).toHaveTextContent(formatVnd(0));
  });
});

describe("AccountScreen", () => {
  function accountClient(rating: { average: number; ratedTrips: number } | Error, vehicles: VehicleResponse[]) {
    return {
      getDriverRating: vi.fn().mockImplementation(() =>
        rating instanceof Error ? Promise.reject(rating) : Promise.resolve(rating),
      ),
      listVehicles: vi.fn().mockResolvedValue(vehicles),
    } as unknown as DriverServiceClientExt;
  }

  it("renders name, rating, vehicles and a sign-out control", async () => {
    const client = accountClient({ average: 4.75, ratedTrips: 12 }, [makeVehicle()]);
    renderApp(<AccountScreen client={client} />);

    expect(screen.getByText(profile.name)).toBeInTheDocument();
    const rating = await screen.findByLabelText("Driver rating");
    expect(rating).toHaveTextContent("4.8");
    expect(rating).toHaveTextContent("(12 trips)");

    const vehicles = screen.getByRole("region", { name: "Vehicles" });
    expect(await within(vehicles).findByText("Honda Vision")).toBeInTheDocument();
    expect(within(vehicles).getByText(/59X1-123\.45/)).toBeInTheDocument();
    expect(within(vehicles).getByText("Motorbike")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });

  it("shows 'No rating yet' and an empty vehicles state", async () => {
    const client = accountClient(new Error("none"), []);
    renderApp(<AccountScreen client={client} />);

    expect(await screen.findByText("No rating yet")).toBeInTheDocument();
    expect(await screen.findByText("No vehicles registered.")).toBeInTheDocument();
  });

  it("signs out: clears the session and leaves the screen", async () => {
    const client = accountClient({ average: 5, ratedTrips: 1 }, []);
    renderApp(
      <Routes>
        <Route path="/" element={<AccountScreen client={client} />} />
        <Route path="*" element={<p>signed-out destination</p>} />
      </Routes>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

    expect(await screen.findByText("signed-out destination")).toBeInTheDocument();
    expect(localStorage.getItem(SESSION_KEY)).toBeNull();
  });
});

describe("DriverLayout", () => {
  it("offers Drive, Earnings and Account in the bottom nav", () => {
    renderApp(
      <Routes>
        <Route path="/" element={<DriverLayout />}>
          <Route index element={<p>content</p>} />
        </Route>
      </Routes>,
    );

    const nav = screen.getByRole("navigation", { name: "Driver" });
    expect(within(nav).getByRole("link", { name: /Drive/ })).toHaveAttribute("href", "/driver");
    expect(within(nav).getByRole("link", { name: /Earnings/ })).toHaveAttribute("href", "/driver/earnings");
    expect(within(nav).getByRole("link", { name: /Account/ })).toHaveAttribute("href", "/driver/account");
  });
});
