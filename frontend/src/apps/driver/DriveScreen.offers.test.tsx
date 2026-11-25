/**
 * Additional DriveScreen unit tests (Req 10.1, 10.4, 10.5, 10.6, 10.7).
 *
 * Complements driver.screens.test.tsx, which covers the offline prompt, the offer card,
 * Decline, the per-status primary button, and COMPLETED. This file covers going
 * offline, offer polling parameters, accept success/409/other failures and action clicks.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { DriverResponse, DriverServiceClientExt } from "../../domain/driver/contract";
import type { TripResponse, TripServiceClientExt } from "../../domain/trip/contract";
import { SessionIdentityProvider } from "../../identity/SessionIdentityProvider";
import { saveSession } from "../../identity/sessionStore";
import { mockProfiles } from "../../domain/seed/people";
import { ApiError } from "../../http/ApiError";
import { NoopSnapper } from "../../map/roadSnapper";
import { ToastProvider } from "../../shared/ui";
import { DriveScreen } from "./DriveScreen";
import { DriverContext } from "./DriverContext";

vi.mock("../../map/MapCanvas", () => ({ MapCanvas: () => <div data-testid="map" /> }));

const DRIVER_ID = "driver-1";
const DRIVER: DriverResponse = {
  id: DRIVER_ID,
  userId: mockProfiles.driver[0]!.userId,
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

const FARES = [{ vehicleType: "CAR", amount: 45000, currency: "VND", distanceKm: 3.5, durationMin: 12 }];

function tripStubs(items: TripResponse[], overrides: Record<string, unknown> = {}) {
  const stubs = {
    listTrips: vi.fn().mockResolvedValue({ items, total: items.length, limit: 20, offset: 0 }),
    estimateFares: vi.fn().mockResolvedValue(FARES),
    acceptTrip: vi.fn(),
    getTrip: vi.fn(),
    arriveTrip: vi.fn(),
    startTrip: vi.fn(),
    completeTrip: vi.fn(),
    ...overrides,
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

function renderDrive(trips: TripServiceClientExt, client: DriverServiceClientExt) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const geolocation = {
    watchPosition: () => 1,
    clearWatch: () => undefined,
    getCurrentPosition: () => undefined,
  } as unknown as Geolocation;
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <SessionIdentityProvider>
            <DriverContext.Provider value={DRIVER}>
              <DriveScreen
                client={client}
                tripClient={trips}
                snapper={new NoopSnapper()}
                geolocation={geolocation}
                intervalMs={60_000}
              />
            </DriverContext.Provider>
          </SessionIdentityProvider>
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

async function goOnline() {
  const toggle = screen.getByRole("switch", { name: "Online" });
  fireEvent.click(toggle);
  await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));
}

beforeEach(() => {
  localStorage.clear();
  saveSession(localStorage, { role: "driver", id: DRIVER.userId });
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("DriveScreen online/offline (Req 10.1)", () => {
  it("goes online, shows the waiting prompt, then offline again via goOffline", async () => {
    const trips = tripStubs([]);
    const client = driverStubs();
    renderDrive(trips, client);

    await goOnline();
    expect(client.goOnline).toHaveBeenCalledWith(DRIVER_ID);
    expect(await screen.findByText("New trip offers will appear here.")).toBeInTheDocument();
    expect(screen.getByText("You're online")).toBeInTheDocument();

    const toggle = screen.getByRole("switch", { name: "Online" });
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "false"));
    expect(client.goOffline).toHaveBeenCalledWith(DRIVER_ID);
    expect(screen.getByText("Go online to start receiving trip offers.")).toBeInTheDocument();
  });

  it("reverts to offline and shows a toast when goOnline fails", async () => {
    const client = driverStubs();
    client.goOnline = vi.fn().mockRejectedValue(ApiError.unavailable("Service down"));
    renderDrive(tripStubs([]), client);

    const toggle = screen.getByRole("switch", { name: "Online" });
    fireEvent.click(toggle);

    expect(await screen.findByText(/Service down|unavailable/i)).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-checked", "false");
  });
});

describe("DriveScreen offers (Req 10.4, 10.5)", () => {
  it("lists SEARCHING trips once online", async () => {
    const trips = tripStubs([makeTrip()]);
    renderDrive(trips, driverStubs());
    await goOnline();

    expect(await screen.findByLabelText("Trip offer")).toBeInTheDocument();
    expect(trips.listTrips).toHaveBeenCalledWith({ status: "SEARCHING" });
  });

  it("shows a fallback when no fare matches the ride type", async () => {
    const trips = tripStubs([makeTrip({ rideType: "MOTORBIKE" })]);
    renderDrive(trips, driverStubs());
    await goOnline();

    expect(await screen.findByText("Fare estimate unavailable.")).toBeInTheDocument();
  });

  it("shows coordinates when an offer has no address", async () => {
    const trips = tripStubs([makeTrip({ pickupAddress: null })]);
    renderDrive(trips, driverStubs());
    await goOnline();

    expect(await screen.findByText("10.7725, 106.6980")).toBeInTheDocument();
  });
});

describe("DriveScreen accept (Req 10.5, 10.6)", () => {
  it("on 409 shows the 'taken' toast, removes the offer, and does not show a trip", async () => {
    const trips = tripStubs([makeTrip()], { acceptTrip: vi.fn().mockRejectedValue(ApiError.conflict()) });
    renderDrive(trips, driverStubs());
    await goOnline();

    fireEvent.click(await screen.findByRole("button", { name: "Accept" }));

    expect(await screen.findByText("Another driver took this trip.")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByLabelText("Trip offer")).not.toBeInTheDocument());
    expect(screen.queryByRole("heading", { name: "Current trip" })).not.toBeInTheDocument();
    expect(trips.acceptTrip).toHaveBeenCalledWith("trip-1", DRIVER_ID);
  });

  it("on a non-409 failure keeps the offer and does not claim another driver took it", async () => {
    const trips = tripStubs([makeTrip()], {
      acceptTrip: vi.fn().mockRejectedValue(ApiError.unavailable("Trip service unavailable")),
    });
    renderDrive(trips, driverStubs());
    await goOnline();

    fireEvent.click(await screen.findByRole("button", { name: "Accept" }));

    await waitFor(() => expect(trips.acceptTrip).toHaveBeenCalled());
    expect(screen.queryByText("Another driver took this trip.")).not.toBeInTheDocument();
    expect(await screen.findByLabelText("Trip offer")).toBeInTheDocument();
  });

  it("on success shows the accepted trip in place of the offers", async () => {
    const accepted = makeTrip({ status: "DRIVER_ASSIGNED", driverId: DRIVER_ID });
    const trips = tripStubs([makeTrip()], {
      acceptTrip: vi.fn().mockResolvedValue(accepted),
      getTrip: vi.fn().mockResolvedValue(accepted),
    });
    renderDrive(trips, driverStubs());
    await goOnline();

    fireEvent.click(await screen.findByRole("button", { name: "Accept" }));

    expect(await screen.findByRole("heading", { name: "Current trip" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Trip offer")).not.toBeInTheDocument();
  });
});

describe("DriveScreen lifecycle actions (Req 10.7)", () => {
  async function acceptWith(status: TripResponse["status"], trips: ReturnType<typeof tripStubs>) {
    renderDrive(trips, driverStubs());
    await goOnline();
    fireEvent.click(await screen.findByRole("button", { name: "Accept" }));
    await screen.findByRole("heading", { name: "Current trip" });
    return status;
  }

  it("arrive → start → complete advance the button and call the matching endpoints", async () => {
    const assigned = makeTrip({ status: "DRIVER_ASSIGNED", driverId: DRIVER_ID });
    const arrived = { ...assigned, status: "DRIVER_ARRIVED" as const };
    const started = { ...assigned, status: "IN_PROGRESS" as const };
    const done = { ...assigned, status: "COMPLETED" as const };
    const trips = tripStubs([makeTrip()], {
      acceptTrip: vi.fn().mockResolvedValue(assigned),
      getTrip: vi.fn().mockResolvedValue(assigned),
      arriveTrip: vi.fn().mockResolvedValue(arrived),
      startTrip: vi.fn().mockResolvedValue(started),
      completeTrip: vi.fn().mockResolvedValue(done),
    });
    await acceptWith("DRIVER_ASSIGNED", trips);

    fireEvent.click(await screen.findByRole("button", { name: "I have arrived" }));
    expect(await screen.findByRole("button", { name: "Start trip" })).toBeInTheDocument();
    expect(trips.arriveTrip).toHaveBeenCalledWith("trip-1");

    fireEvent.click(screen.getByRole("button", { name: "Start trip" }));
    expect(await screen.findByRole("button", { name: "Complete trip" })).toBeInTheDocument();
    expect(trips.startTrip).toHaveBeenCalledWith("trip-1");

    fireEvent.click(screen.getByRole("button", { name: "Complete trip" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Current trip" })).not.toBeInTheDocument());
    expect(trips.completeTrip).toHaveBeenCalledWith("trip-1");
  });

  it("keeps the button and shows an error toast when an action fails", async () => {
    const assigned = makeTrip({ status: "DRIVER_ASSIGNED", driverId: DRIVER_ID });
    const trips = tripStubs([makeTrip()], {
      acceptTrip: vi.fn().mockResolvedValue(assigned),
      getTrip: vi.fn().mockResolvedValue(assigned),
      arriveTrip: vi.fn().mockRejectedValue(ApiError.unavailable("Cannot reach trip service")),
    });
    await acceptWith("DRIVER_ASSIGNED", trips);

    fireEvent.click(await screen.findByRole("button", { name: "I have arrived" }));

    await waitFor(() => expect(trips.arriveTrip).toHaveBeenCalledWith("trip-1"));
    expect(await screen.findByText(/Cannot reach trip service|unavailable/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "I have arrived" })).toBeInTheDocument();
  });
});
