/**
 * Unit tests for Rider booking and tracking end states.
 * Requirements: 6.5, 6.6, 7.4, 7.6, 7.7, 7.8, 7.9, 7.10, 12.4.
 *
 * Complements rider.journey.test.tsx: covers the cancel dialog, cancel failure,
 * cancelled reason, completed fare and payment status, the 5-minute no-driver
 * state and the reconnect notice.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";
import type { ReactElement } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FareEstimate } from "../../domain/trip/contract";
import type { TripResponse } from "../../domain/trip";
import { ApiError } from "../../http/ApiError";

const { estimateFares, requestTrip, getTrip, cancelTrip, listTrips, search, getPaymentForTrip } = vi.hoisted(() => ({
  estimateFares: vi.fn(),
  requestTrip: vi.fn(),
  getTrip: vi.fn(),
  cancelTrip: vi.fn(),
  listTrips: vi.fn(),
  search: vi.fn(),
  getPaymentForTrip: vi.fn(),
}));

vi.mock("../../domain/trip", () => ({
  resolveTripClient: () => ({ estimateFares, requestTrip, getTrip, cancelTrip, listTrips }),
}));
vi.mock("../../domain/payment", () => ({
  resolvePaymentClient: () => ({ getPaymentForTrip }),
}));
vi.mock("../../config/appConfig", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../config/appConfig")>();
  return { ...actual, appConfig: { ...actual.appConfig, geocoderUrl: "http://geocoder.test" } };
});
vi.mock("../../geocoding/nominatimGeocoder", () => ({
  createNominatimGeocoder: () => ({ search, reverse: vi.fn() }),
}));
vi.mock("../../map/MapCanvas", () => ({
  // Reports a reconnecting stream whenever a trip is being tracked.
  MapCanvas: ({ trip, onStreamState }: { trip?: unknown; onStreamState?: (s: "reconnecting") => void }) => {
    useEffect(() => {
      if (trip) onStreamState?.("reconnecting");
    }, [trip, onStreamState]);
    return <div data-testid="map-stub" />;
  },
}));

import { RiderApp } from "./RiderApp";
import { isNoDriverTimeout, NO_DRIVER_TIMEOUT_MS } from "./tripView";
import { SessionIdentityProvider } from "../../identity/SessionIdentityProvider";
import { mockProfiles } from "../../domain/seed/people";
import { useCurrentIdentity } from "../../identity/useCurrentIdentity";

const RIDER = mockProfiles.rider[0]!;
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
    requestedAt: new Date().toISOString(),
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

function renderRider() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={["/rider"]}>
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

async function pickPlace(label: string, place: { address: string; lat: number; lng: number }) {
  search.mockResolvedValueOnce([place]);
  fireEvent.change(await screen.findByLabelText(label), { target: { value: place.address } });
  fireEvent.mouseDown(await screen.findByRole("option", { name: place.address }, { timeout: 3000 }));
}

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

describe("isNoDriverTimeout (Req 7.10)", () => {
  const requestedAt = "2025-01-01T00:00:00.000Z";
  const t0 = Date.parse(requestedAt);

  it("is false before 5 minutes and true from 5 minutes while searching", () => {
    expect(isNoDriverTimeout({ status: "SEARCHING", requestedAt }, t0 + NO_DRIVER_TIMEOUT_MS - 1)).toBe(false);
    expect(isNoDriverTimeout({ status: "SEARCHING", requestedAt }, t0 + NO_DRIVER_TIMEOUT_MS)).toBe(true);
  });

  it("is false once a driver is assigned", () => {
    expect(isNoDriverTimeout({ status: "DRIVER_ASSIGNED", requestedAt }, t0 + 2 * NO_DRIVER_TIMEOUT_MS)).toBe(false);
  });
});

describe("Rider trip request", () => {
  it("shows the searching state with the estimated fare after a successful request (Req 6.5)", async () => {
    const trip = makeTrip({ estimatedFare: 27500 });
    requestTrip.mockResolvedValue(trip);
    getTrip.mockResolvedValue(trip);
    renderRider();
    await bookRide();

    expect(await screen.findByText("Searching for a nearby driver…")).toBeInTheDocument();
    expect(await screen.findByTestId("trip-announcer")).toBeInTheDocument();
  });

  it("shows an alert, keeps the places and re-enables Confirm when the request is rejected (Req 6.6)", async () => {
    requestTrip.mockRejectedValue(ApiError.validation("bad"));
    renderRider();
    await bookRide();

    expect(await screen.findByRole("alert")).toHaveTextContent(/check the details/i);
    expect(screen.getByLabelText("Pickup")).toHaveValue(PICKUP.address);
    expect(screen.getByLabelText("Where to?")).toHaveValue(DEST.address);
    expect(screen.getByRole("button", { name: "Confirm Motorbike" })).toBeEnabled();
  });
});

describe("Rider cancellation", () => {
  it("asks for confirmation and does not cancel when the rider keeps the ride (Req 7.6)", async () => {
    requestTrip.mockResolvedValue(makeTrip());
    getTrip.mockResolvedValue(makeTrip());
    renderRider();
    await bookRide();

    fireEvent.click(await screen.findByRole("button", { name: "Cancel ride" }));
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Keep ride" }));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(cancelTrip).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Cancel ride" })).toBeInTheDocument();
  });

  it("shows the error and keeps the trip on screen when cancelling fails (Req 7.7)", async () => {
    requestTrip.mockResolvedValue(makeTrip());
    getTrip.mockResolvedValue(makeTrip());
    cancelTrip.mockRejectedValue(ApiError.conflict("nope"));
    renderRider();
    await bookRide();

    fireEvent.click(await screen.findByRole("button", { name: "Cancel ride" }));
    fireEvent.click(await screen.findByRole("button", { name: "Yes, cancel" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/no longer possible/i);
    expect(screen.getByText("Searching for a nearby driver…")).toBeInTheDocument();
    expect(screen.queryByText("Your ride was cancelled.")).toBeNull();
  });
});

describe("Rider end states", () => {
  it("shows the cancellation reason and returns to an empty form (Req 7.9)", async () => {
    const cancelled = makeTrip({ status: "CANCELLED", cancellationReason: "Driver unavailable" });
    requestTrip.mockResolvedValue(cancelled);
    getTrip.mockResolvedValue(cancelled);
    renderRider();
    await bookRide();

    expect(await screen.findByTestId("cancellation-reason")).toHaveTextContent("Driver unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Book another ride" }));
    expect(await screen.findByLabelText("Where to?")).toHaveValue("");
  });

  it("omits the reason when none is stored (Req 7.9)", async () => {
    const cancelled = makeTrip({ status: "CANCELLED", cancellationReason: null });
    requestTrip.mockResolvedValue(cancelled);
    getTrip.mockResolvedValue(cancelled);
    renderRider();
    await bookRide();

    expect(await screen.findByText("Your ride was cancelled.")).toBeInTheDocument();
    expect(screen.queryByTestId("cancellation-reason")).toBeNull();
  });

  it("shows the final fare and payment status, then returns to an empty form (Req 7.8)", async () => {
    const done = makeTrip({ status: "COMPLETED", finalFare: 31000 });
    requestTrip.mockResolvedValue(done);
    getTrip.mockResolvedValue(done);
    getPaymentForTrip.mockResolvedValue({ status: "COMPLETED" });
    renderRider();
    await bookRide();

    expect(await screen.findByText(/31[.,\s]?000/)).toBeInTheDocument();
    expect(await screen.findByTestId("payment-status")).toHaveTextContent("Payment: Completed");
    expect(getPaymentForTrip).toHaveBeenCalledWith("trip-1");

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(await screen.findByLabelText("Where to?")).toHaveValue("");
  });

  it("falls back to a neutral payment line when the payment lookup fails (Req 7.8)", async () => {
    const done = makeTrip({ status: "COMPLETED", finalFare: 31000 });
    requestTrip.mockResolvedValue(done);
    getTrip.mockResolvedValue(done);
    getPaymentForTrip.mockRejectedValue(ApiError.notFound());
    renderRider();
    await bookRide();

    expect(await screen.findByText("Payment status unavailable")).toBeInTheDocument();
  });
});

describe("Rider no-driver timeout and live stream notice", () => {
  it("shows the no-driver message with try-again and cancel controls after 5 minutes (Req 7.10)", async () => {
    const stale = makeTrip({ requestedAt: new Date(Date.now() - NO_DRIVER_TIMEOUT_MS - 1000).toISOString() });
    requestTrip.mockResolvedValue(stale);
    getTrip.mockResolvedValue(stale);
    renderRider();
    await bookRide();

    expect(await screen.findByText(/no driver was found/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel ride" })).toBeInTheDocument();
    expect(screen.queryByText("Searching for a nearby driver…")).toBeNull();
  });

  it("does not show the no-driver message for a fresh search (Req 7.10)", async () => {
    requestTrip.mockResolvedValue(makeTrip());
    getTrip.mockResolvedValue(makeTrip());
    renderRider();
    await bookRide();

    expect(await screen.findByText("Searching for a nearby driver…")).toBeInTheDocument();
    expect(screen.queryByText(/no driver was found/i)).toBeNull();
  });

  it("shows the reconnect notice while the live stream is reconnecting (Req 7.4)", async () => {
    const trip = makeTrip({ status: "DRIVER_ASSIGNED", driverId: "driver-1" });
    requestTrip.mockResolvedValue(trip);
    getTrip.mockResolvedValue(trip);
    renderRider();
    await bookRide();

    expect(await screen.findByText("Reconnecting to driver location")).toBeInTheDocument();
  });
});
