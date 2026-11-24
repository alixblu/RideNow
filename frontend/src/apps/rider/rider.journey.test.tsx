/**
 * Component tests for Rider_App: HomeScreen booking flow, ActivityScreen and bottom nav.
 * Requirements: 4.2, 4.4, 4.6, 4.7, 4.8.
 *
 * The trip and driver Service_Clients are stubbed; the map is replaced by a stub because
 * Leaflet needs a real layout engine.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";
import type { ReactElement } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FareEstimate, HistoryEntry } from "../../domain/trip/contract";
import type { TripResponse } from "../../domain/trip";
import type { TripStatus } from "../../shared/enums";

const { estimateFares, requestTrip, getTrip, cancelTrip, rateTrip, listTripHistory, getDriverRating } =
  vi.hoisted(() => ({
    estimateFares: vi.fn(),
    requestTrip: vi.fn(),
    getTrip: vi.fn(),
    cancelTrip: vi.fn(),
    rateTrip: vi.fn(),
    listTripHistory: vi.fn(),
    getDriverRating: vi.fn(),
  }));

vi.mock("../../domain/trip", () => ({
  resolveTripClient: () => ({ estimateFares, requestTrip, getTrip, cancelTrip, rateTrip, listTripHistory }),
}));
vi.mock("../../domain/driver", () => ({
  resolveDriverClient: () => ({ getDriverRating }),
}));
vi.mock("../../map/MapCanvas", () => ({
  MapCanvas: () => <div data-testid="map-stub" />,
}));

import { RiderApp } from "./RiderApp";
import { PRESET_LOCATIONS } from "../../domain/seed/places";
import { SessionIdentityProvider } from "../../identity/SessionIdentityProvider";
import { mockProfiles } from "../../identity/mockProfiles";
import { useCurrentIdentity } from "../../identity/useCurrentIdentity";

const RIDER = mockProfiles.rider[0]!;
const DRIVER = mockProfiles.driver[0]!;
const PICKUP = PRESET_LOCATIONS[0]!;
const DEST = PRESET_LOCATIONS[1]!;

const ESTIMATES: FareEstimate[] = [
  { vehicleType: "MOTORBIKE", amount: 25000, currency: "VND", distanceKm: 3.2, durationMin: 9 },
  { vehicleType: "CAR", amount: 60000, currency: "VND", distanceKm: 3.2, durationMin: 9 },
];

function makeTrip(overrides: Partial<TripResponse> = {}): TripResponse {
  return {
    id: "trip-1",
    passengerId: RIDER.userId,
    driverId: null,
    vehicleId: null,
    rideType: "MOTORBIKE",
    pickupLat: PICKUP.lat,
    pickupLng: PICKUP.lng,
    pickupAddress: PICKUP.label,
    destinationLat: DEST.lat,
    destinationLng: DEST.lng,
    destinationAddress: DEST.label,
    status: "SEARCHING",
    estimatedFare: 25000,
    finalFare: null,
    cancellationReason: null,
    version: 0,
    requestedAt: "2025-01-01T00:00:00.000Z",
    acceptedAt: null,
    arrivedAt: null,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeEntry(id: string, requestedAt: string, counterpartName: string): HistoryEntry {
  return {
    trip: makeTrip({ id, requestedAt, status: "COMPLETED", finalFare: 30000 }),
    counterpartName,
    counterpartRating: 4.8,
    vehicleLabel: null,
    paymentStatus: "PAID",
    rating: null,
  };
}

function SignedInRider({ children }: { children: ReactElement }) {
  const identity = useCurrentIdentity();
  const ready = identity.current("rider") !== null;
  useEffect(() => {
    if (!ready) identity.signIn({ role: "rider", id: RIDER.userId });
  }, [ready, identity]);
  return ready ? children : null;
}

function renderRider(path = "/rider") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={queryClient}>
        <SessionIdentityProvider>
          <SignedInRider>
            <Routes>
              <Route path="/rider/*" element={<RiderApp />} />
            </Routes>
          </SignedInRider>
        </SessionIdentityProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/** Pick pickup/destination and press confirm. */
async function bookRide() {
  fireEvent.change(await screen.findByLabelText("Where to?"), { target: { value: DEST.id } });
  await screen.findByRole("list", { name: "Fare quotes" });
  fireEvent.click(screen.getByRole("button", { name: "Confirm Motorbike" }));
}

beforeEach(() => {
  localStorage.clear();
  estimateFares.mockResolvedValue(ESTIMATES);
  getDriverRating.mockResolvedValue({ average: 4.9, count: 10 });
  listTripHistory.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Rider HomeScreen booking flow", () => {
  it("shows a quote per vehicle type and enters the searching state on confirm (Req 4.2, 4.4)", async () => {
    requestTrip.mockResolvedValue(makeTrip({ status: "SEARCHING" }));
    getTrip.mockResolvedValue(makeTrip({ status: "SEARCHING" }));
    renderRider();

    fireEvent.change(await screen.findByLabelText("Where to?"), { target: { value: DEST.id } });
    const quotes = await screen.findByRole("list", { name: "Fare quotes" });
    expect(within(quotes).getAllByRole("listitem")).toHaveLength(2);
    expect(quotes.textContent).toContain("Motorbike");
    expect(quotes.textContent).toContain("Car");

    fireEvent.click(screen.getByRole("button", { name: "Confirm Motorbike" }));

    expect(await screen.findByText(/searching for a nearby driver/i)).toBeInTheDocument();
    expect(requestTrip).toHaveBeenCalledWith(
      expect.objectContaining({ passengerId: RIDER.userId, rideType: "MOTORBIKE", paymentMethod: "CASH" }),
    );
  });

  it("keeps Confirm disabled until a destination is chosen", async () => {
    renderRider();
    const confirm = await screen.findByRole("button", { name: "Confirm Motorbike" });
    expect(confirm).toBeDisabled();
  });

  it.each<[TripStatus, boolean]>([
    ["SEARCHING", true],
    ["DRIVER_ASSIGNED", true],
    ["DRIVER_ARRIVED", true],
    ["IN_PROGRESS", false],
  ])("cancel button visibility for %s is %s (Req 4.6)", async (status, visible) => {
    const trip = makeTrip({ status, driverId: status === "SEARCHING" ? null : DRIVER.userId });
    requestTrip.mockResolvedValue(trip);
    getTrip.mockResolvedValue(trip);
    renderRider();
    await bookRide();

    if (visible) {
      expect(await screen.findByRole("button", { name: "Cancel ride" })).toBeInTheDocument();
    } else {
      expect(await screen.findByLabelText("Driver")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Cancel ride" })).toBeNull();
    }
  });

  it("cancelling a searching ride shows the cancelled state", async () => {
    requestTrip.mockResolvedValue(makeTrip());
    getTrip.mockResolvedValue(makeTrip());
    cancelTrip.mockResolvedValue(makeTrip({ status: "CANCELLED" }));
    renderRider();
    await bookRide();

    fireEvent.click(await screen.findByRole("button", { name: "Cancel ride" }));

    expect(await screen.findByText("Your ride was cancelled.")).toBeInTheDocument();
    expect(cancelTrip).toHaveBeenCalledWith("trip-1");
  });

  it("completion shows the summary and submits a 1 to 5 star rating (Req 4.7)", async () => {
    const done = makeTrip({ status: "COMPLETED", driverId: DRIVER.userId, finalFare: 27000 });
    requestTrip.mockResolvedValue(done);
    getTrip.mockResolvedValue(done);
    rateTrip.mockResolvedValue(undefined);
    renderRider();
    await bookRide();

    const group = await screen.findByRole("group", { name: "Rate your ride" });
    expect(within(group).getAllByRole("button")).toHaveLength(5);

    fireEvent.click(within(group).getByRole("button", { name: "4 stars" }));

    await waitFor(() => expect(rateTrip).toHaveBeenCalledWith("trip-1", 4));
    expect(await screen.findByText("Thanks for rating.")).toBeInTheDocument();
  });
});

describe("Rider ActivityScreen", () => {
  it("lists trips newest first (Req 4.8)", async () => {
    listTripHistory.mockResolvedValue([
      makeEntry("old", "2025-01-01T08:00:00.000Z", "Oldest Driver"),
      makeEntry("new", "2025-03-01T08:00:00.000Z", "Newest Driver"),
      makeEntry("mid", "2025-02-01T08:00:00.000Z", "Middle Driver"),
    ]);
    renderRider("/rider/activity");

    const list = await screen.findByRole("list", { name: "Trip history" });
    const hrefs = within(list)
      .getAllByRole("link")
      .map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["/rider/activity/new", "/rider/activity/mid", "/rider/activity/old"]);
  });

  it("shows an empty state with a link to book a ride", async () => {
    renderRider("/rider/activity");
    expect(await screen.findByText(/no rides yet/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Book a ride" })).toHaveAttribute("href", "/rider");
  });
});

describe("Rider bottom navigation and Account", () => {
  it("links Home, Activity and Account", async () => {
    renderRider();
    const nav = await screen.findByRole("navigation", { name: "Rider" });
    expect(within(nav).getByRole("link", { name: "Home" })).toHaveAttribute("href", "/rider");
    expect(within(nav).getByRole("link", { name: "Activity" })).toHaveAttribute("href", "/rider/activity");
    expect(within(nav).getByRole("link", { name: "Account" })).toHaveAttribute("href", "/rider/account");
  });

  it("navigates to Activity and Account from the nav", async () => {
    renderRider();
    const nav = await screen.findByRole("navigation", { name: "Rider" });

    fireEvent.click(within(nav).getByRole("link", { name: "Activity" }));
    expect(await screen.findByRole("heading", { name: "Activity" })).toBeInTheDocument();

    fireEvent.click(within(nav).getByRole("link", { name: "Account" }));
    expect(await screen.findByRole("heading", { name: "Account" })).toBeInTheDocument();
    expect(screen.getByText(RIDER.name)).toBeInTheDocument();
  });
});
