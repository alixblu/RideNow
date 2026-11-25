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
import type { FareEstimate } from "../../domain/trip/contract";
import type { TripResponse } from "../../domain/trip";
import type { TripStatus } from "../../shared/enums";

const { estimateFares, requestTrip, getTrip, cancelTrip, listTrips, search } =
  vi.hoisted(() => ({
    estimateFares: vi.fn(),
    requestTrip: vi.fn(),
    getTrip: vi.fn(),
    cancelTrip: vi.fn(),
    listTrips: vi.fn(),
    search: vi.fn(),
  }));

vi.mock("../../domain/trip", () => ({
  resolveTripClient: () => ({ estimateFares, requestTrip, getTrip, cancelTrip, listTrips }),
}));
vi.mock("../../config/appConfig", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../config/appConfig")>();
  return { ...actual, appConfig: { ...actual.appConfig, geocoderUrl: "http://geocoder.test" } };
});
vi.mock("../../geocoding/nominatimGeocoder", () => ({
  createNominatimGeocoder: () => ({ search, reverse: vi.fn() }),
}));
vi.mock("../../map/MapCanvas", () => ({
  MapCanvas: () => <div data-testid="map-stub" />,
}));

import { RiderApp } from "./RiderApp";
import { SessionIdentityProvider } from "../../identity/SessionIdentityProvider";
import { mockProfiles } from "../../domain/seed/people";
import { useCurrentIdentity } from "../../identity/useCurrentIdentity";

const RIDER = mockProfiles.rider[0]!;
const DRIVER = mockProfiles.driver[0]!;
const PICKUP = { address: "Ben Thanh Market", lat: 10.7725, lng: 106.698 };
const DEST = { address: "Notre-Dame Cathedral", lat: 10.7797, lng: 106.699 };

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
    pickupAddress: PICKUP.address,
    destinationLat: DEST.lat,
    destinationLng: DEST.lng,
    destinationAddress: DEST.address,
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

/** Type an address in the labelled field and choose the first suggestion. */
async function pickPlace(label: string, place: { address: string; lat: number; lng: number }) {
  search.mockResolvedValueOnce([place]);
  fireEvent.change(await screen.findByLabelText(label), { target: { value: place.address } });
  fireEvent.mouseDown(await screen.findByRole("option", { name: place.address }, { timeout: 3000 }));
}

/** Pick pickup/destination and press confirm. */
async function bookRide() {
  await pickPlace("Pickup", PICKUP);
  await pickPlace("Where to?", DEST);
  await screen.findByRole("list", { name: "Fare quotes" });
  fireEvent.click(screen.getByRole("button", { name: "Confirm Motorbike" }));
}

beforeEach(() => {
  localStorage.clear();
  estimateFares.mockResolvedValue(ESTIMATES);
  listTrips.mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 });
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

    await pickPlace("Pickup", PICKUP);
    await pickPlace("Where to?", DEST);
    const quotes = await screen.findByRole("list", { name: "Fare quotes" });
    expect(within(quotes).getAllByRole("listitem")).toHaveLength(2);
    expect(quotes.textContent).toContain("Motorbike");
    expect(quotes.textContent).toContain("Car");

    fireEvent.click(screen.getByRole("button", { name: "Confirm Motorbike" }));

    expect(await screen.findByText(/searching for a nearby driver/i)).toBeInTheDocument();
    expect(quotes.textContent).toContain("Estimated fare");
    expect(requestTrip).toHaveBeenCalledWith(
      expect.objectContaining({
        passengerId: RIDER.userId,
        rideType: "MOTORBIKE",
        paymentMethod: "CASH",
        pickupAddress: PICKUP.address,
        destinationAddress: DEST.address,
      }),
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
    fireEvent.click(await screen.findByRole("button", { name: "Yes, cancel" }));

    expect(await screen.findByText("Your ride was cancelled.")).toBeInTheDocument();
    expect(cancelTrip).toHaveBeenCalledWith("trip-1");
  });

  it("completion shows the summary without a star rating (Req 8.8)", async () => {
    const done = makeTrip({ status: "COMPLETED", driverId: DRIVER.userId, finalFare: 27000 });
    requestTrip.mockResolvedValue(done);
    getTrip.mockResolvedValue(done);
    renderRider();
    await bookRide();

    expect(await screen.findByRole("button", { name: "Done" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Rate your ride" })).toBeNull();
  });

  it("disables Confirm and explains when pickup and destination are under 100 m apart (Req 6.2)", async () => {
    renderRider();
    await pickPlace("Pickup", PICKUP);
    await pickPlace("Where to?", { address: "Next door", lat: PICKUP.lat + 0.0003, lng: PICKUP.lng });
    expect(await screen.findByText(/too close/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm Motorbike" })).toBeDisabled();
  });

  it("keeps the places and shows the backend error when the request fails (Req 6.6)", async () => {
    requestTrip.mockRejectedValue(new Error("boom"));
    renderRider();
    await bookRide();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByLabelText("Pickup")).toHaveValue(PICKUP.address);
    expect(screen.getByLabelText("Where to?")).toHaveValue(DEST.address);
  });

  it("resumes an in-progress trip on mount (Req 6.10)", async () => {
    const active = makeTrip({ status: "DRIVER_ASSIGNED", driverId: DRIVER.userId });
    listTrips.mockResolvedValue({ items: [makeTrip({ id: "old", status: "COMPLETED" }), active], total: 2, limit: 20, offset: 0 });
    getTrip.mockResolvedValue(active);
    renderRider();
    expect(await screen.findByLabelText("Driver")).toBeInTheDocument();
    expect(getTrip).toHaveBeenCalledWith("trip-1");
  });
});

describe("Rider ActivityScreen", () => {
  it("lists trips newest first (Req 8.2)", async () => {
    const t = (id: string, requestedAt: string) => makeTrip({ id, requestedAt, status: "COMPLETED", finalFare: 30000 });
    listTrips.mockResolvedValue({
      items: [t("old", "2025-01-01T08:00:00.000Z"), t("new", "2025-03-01T08:00:00.000Z"), t("mid", "2025-02-01T08:00:00.000Z")],
      total: 3,
      limit: 20,
      offset: 0,
    });
    renderRider("/rider/activity");

    const list = await screen.findByRole("list", { name: "Trip history" });
    const hrefs = within(list)
      .getAllByRole("link")
      .map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["/rider/activity/new", "/rider/activity/mid", "/rider/activity/old"]);
  });

  it("requests 20 trips for the signed-in rider and shows coordinates when an address is missing (Req 8.1, 8.3)", async () => {
    listTrips.mockResolvedValue({
      items: [makeTrip({ id: "x", pickupAddress: null, pickupLat: 10.123456, pickupLng: 106.1, status: "COMPLETED" })],
      total: 1,
      limit: 20,
      offset: 0,
    });
    renderRider("/rider/activity");
    expect(await screen.findByText(/10\.1235, 106\.1000/)).toBeInTheDocument();
    expect(listTrips).toHaveBeenCalledWith({ passengerId: RIDER.userId, limit: 20, offset: 0 });
  });

  it("loads the next page when more trips exist (Req 8.5)", async () => {
    const page = (id: string, offset: number) => ({ items: [makeTrip({ id })], total: 2, limit: 20, offset });
    listTrips.mockResolvedValueOnce(page("a", 0)).mockResolvedValueOnce(page("b", 1));
    renderRider("/rider/activity");
    fireEvent.click(await screen.findByRole("button", { name: "Load more" }));
    await waitFor(() => expect(listTrips).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 1 })));
    expect(await screen.findAllByRole("link", { name: /→/ })).toHaveLength(2);
  });

  it("shows an error with retry when loading fails (Req 8.7)", async () => {
    listTrips.mockRejectedValueOnce(new Error("boom"));
    renderRider("/rider/activity");
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    expect(await screen.findByText(/no rides yet/i)).toBeInTheDocument();
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
