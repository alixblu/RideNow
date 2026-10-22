/**
 * Unit tests for the rider RIDE JOURNEY.
 *
 * Tag: Feature: ridenow-frontend, rider ride journey
 *
 * The rider area is a single stateful journey wired to the real trip + payment
 * Service_Clients. These tests drive that journey against stubbed clients (via vi.mock)
 * with a rider identity set through the DevIdentityProvider, mirroring the rider test
 * harness pattern. They cover:
 *   - requesting a ride shows the SEARCHING status;
 *   - a polled status change to DRIVER_ASSIGNED appears;
 *   - cancelling a ride reflects CANCELLED;
 *   - the fare panel renders amount/currency/method/status and a FAILED reason;
 *   - getPaymentForTrip NOT_FOUND shows the quiet "No fare yet" state (no error banner);
 *   - "Your rides" lists trips and opening a row shows that trip's journey.
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
import type { TripResponse, Page } from "../../domain/trip";
import type { PaymentResponse } from "../../domain/payment";
import { ApiError } from "../../http/ApiError";

// Declared via vi.hoisted so they are initialized before the hoisted vi.mock factories
// run (a plain top-level const would not yet exist when the factory executes).
const {
  requestTrip,
  getTrip,
  cancelTrip,
  listTrips,
  getPaymentForTrip,
} = vi.hoisted(() => ({
  requestTrip: vi.fn<(req: unknown) => Promise<TripResponse>>(),
  getTrip: vi.fn<(id: string) => Promise<TripResponse>>(),
  cancelTrip: vi.fn<(id: string) => Promise<TripResponse>>(),
  listTrips: vi.fn<(params: unknown) => Promise<Page<TripResponse>>>(),
  getPaymentForTrip: vi.fn<(tripId: string) => Promise<PaymentResponse>>(),
}));

vi.mock("../../domain/trip", () => ({
  resolveTripClient: () => ({ requestTrip, getTrip, cancelTrip, listTrips }),
}));
vi.mock("../../domain/payment", () => ({
  resolvePaymentClient: () => ({ getPaymentForTrip }),
}));

import { RiderApp } from "./RiderApp";
import { DevIdentityProvider } from "../../identity/DevIdentityProvider";
import { useCurrentIdentity } from "../../identity/useCurrentIdentity";

const RIDER_ID = "rider-1";

/** A full TripResponse with sensible defaults, overridable per test. */
function makeTrip(overrides: Partial<TripResponse> = {}): TripResponse {
  return {
    id: "trip-1",
    passengerId: RIDER_ID,
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

function page(items: TripResponse[]): Page<TripResponse> {
  return { items, total: items.length, limit: 50, offset: 0 };
}

/** Sets a rider identity, then renders children once it exists. */
function RiderHarness({ children }: { children: ReactElement }) {
  const identity = useCurrentIdentity();
  const hasIdentity = identity.current("rider") !== null;
  useEffect(() => {
    if (!hasIdentity) {
      identity.set({ role: "rider", id: RIDER_ID });
    }
  }, [hasIdentity, identity]);
  return hasIdentity ? children : null;
}

function renderRider() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <DevIdentityProvider>
          <RiderHarness>
            <RiderApp />
          </RiderHarness>
        </DevIdentityProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("Feature: ridenow-frontend, rider ride journey", () => {
  it("keeps the 'Request a trip' heading on the initial journey step", async () => {
    renderRider();
    expect(
      await screen.findByRole("heading", { name: "Request a trip" }),
    ).toBeInTheDocument();
    // The in-area nav keeps its accessible name.
    expect(
      screen.getByRole("navigation", { name: "Rider screens" }),
    ).toBeInTheDocument();
  });

  it("requesting a ride shows the SEARCHING status (Req 9.1)", async () => {
    requestTrip.mockResolvedValue(makeTrip({ status: "SEARCHING" }));
    getTrip.mockResolvedValue(makeTrip({ status: "SEARCHING" }));
    getPaymentForTrip.mockRejectedValue(ApiError.notFound());

    renderRider();

    fireEvent.submit(await screen.findByRole("form", { name: "Request a trip" }));

    await waitFor(() => {
      expect(screen.getByText("Searching")).toBeInTheDocument();
    });
    expect(screen.getByText(/searching for a nearby driver/i)).toBeInTheDocument();
    expect(requestTrip).toHaveBeenCalledWith(
      expect.objectContaining({ passengerId: RIDER_ID, rideType: "MOTORBIKE" }),
    );
  });

  it("surfaces a polled status change to DRIVER_ASSIGNED (Req 9.2)", async () => {
    requestTrip.mockResolvedValue(makeTrip({ status: "SEARCHING" }));
    // First read: still searching. Subsequent polls: a driver has been assigned.
    getTrip
      .mockResolvedValueOnce(makeTrip({ status: "SEARCHING" }))
      .mockResolvedValue(
        makeTrip({
          status: "DRIVER_ASSIGNED",
          driverId: "driver-9",
          vehicleId: "vehicle-3",
          acceptedAt: "2024-01-01T00:05:00.000Z",
        }),
      );
    getPaymentForTrip.mockRejectedValue(ApiError.notFound());

    renderRider();

    fireEvent.submit(await screen.findByRole("form", { name: "Request a trip" }));

    // The seeded SEARCHING status shows first.
    await waitFor(() => expect(screen.getByText("Searching")).toBeInTheDocument());

    // The 3s refetchInterval polls getTrip again; the next read is DRIVER_ASSIGNED.
    await waitFor(
      () => {
        // "Driver assigned" appears in both the status pill and the timeline row.
        expect(screen.getAllByText("Driver assigned").length).toBeGreaterThan(0);
      },
      { timeout: 6000 },
    );
    expect(screen.getByText("driver-9")).toBeInTheDocument();
    expect(screen.getByText("vehicle-3")).toBeInTheDocument();
  });

  it("cancelling a ride reflects CANCELLED (Req 9.4)", async () => {
    requestTrip.mockResolvedValue(makeTrip({ status: "SEARCHING" }));
    getTrip.mockResolvedValue(makeTrip({ status: "SEARCHING" }));
    cancelTrip.mockResolvedValue(
      makeTrip({ status: "CANCELLED", cancelledAt: "2024-01-01T00:10:00.000Z" }),
    );
    getPaymentForTrip.mockRejectedValue(ApiError.notFound());

    renderRider();

    fireEvent.submit(await screen.findByRole("form", { name: "Request a trip" }));
    await waitFor(() => expect(screen.getByText("Searching")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /cancel ride/i }));

    await waitFor(() => {
      // "Cancelled" appears in both the status pill and the timeline row.
      expect(screen.getAllByText("Cancelled").length).toBeGreaterThan(0);
    });
    // Cancel is no longer offered once terminal.
    expect(screen.queryByRole("button", { name: /cancel ride/i })).not.toBeInTheDocument();
  });

  it("renders fare fields and a FAILED reason (Req 11.1, 11.3)", async () => {
    requestTrip.mockResolvedValue(makeTrip({ status: "IN_PROGRESS" }));
    getTrip.mockResolvedValue(makeTrip({ status: "IN_PROGRESS" }));
    getPaymentForTrip.mockResolvedValue({
      id: "pay-1",
      tripId: "trip-1",
      amount: 120000,
      currency: "VND",
      method: "SIMULATED_CARD",
      status: "FAILED",
      idempotencyKey: "idem-trip-1",
      failureReason: "Payment declined by the card issuer.",
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
      paidAt: null,
      failedAt: "2024-01-01T00:00:00.000Z",
    });

    renderRider();

    fireEvent.submit(await screen.findByRole("form", { name: "Request a trip" }));

    await waitFor(() => {
      expect(screen.getByText("SIMULATED_CARD")).toBeInTheDocument();
    });
    expect(screen.getByText((120000).toLocaleString())).toBeInTheDocument();
    expect(screen.getByText("VND")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(
      screen.getByText("Payment declined by the card issuer."),
    ).toBeInTheDocument();
  });

  it("shows a quiet 'No fare yet' state when no payment exists (NOT_FOUND)", async () => {
    requestTrip.mockResolvedValue(makeTrip({ status: "SEARCHING" }));
    getTrip.mockResolvedValue(makeTrip({ status: "SEARCHING" }));
    getPaymentForTrip.mockRejectedValue(ApiError.notFound());

    renderRider();

    fireEvent.submit(await screen.findByRole("form", { name: "Request a trip" }));

    await waitFor(() => {
      expect(screen.getByText(/no fare yet/i)).toBeInTheDocument();
    });
    // The missing-payment state is quiet: no error banner anywhere.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("lists 'Your rides' and opens a selected ride's journey", async () => {
    listTrips.mockResolvedValue(
      page([
        makeTrip({ id: "trip-7", status: "COMPLETED" }),
        makeTrip({ id: "trip-8", status: "CANCELLED" }),
      ]),
    );
    getTrip.mockResolvedValue(makeTrip({ id: "trip-7", status: "COMPLETED" }));
    getPaymentForTrip.mockRejectedValue(ApiError.notFound());

    renderRider();

    // Switch to the "Your rides" screen.
    fireEvent.click(await screen.findByRole("button", { name: "Your rides" }));

    const list = await screen.findByRole("list", { name: "Your rides" });
    const rows = within(list).getAllByRole("button");
    expect(rows).toHaveLength(2);

    // Opening the first ride shows its journey (its trip id is fetched + shown).
    const firstRow = rows[0];
    if (firstRow === undefined) {
      throw new Error("expected at least one ride row");
    }
    fireEvent.click(firstRow);

    await waitFor(() => {
      expect(screen.getByText(/trip trip-7/i)).toBeInTheDocument();
    });
    expect(getTrip).toHaveBeenCalledWith("trip-7");
  });

  it("shows the empty state when the rider has no rides", async () => {
    listTrips.mockResolvedValue(page([]));

    renderRider();

    fireEvent.click(await screen.findByRole("button", { name: "Your rides" }));

    await waitFor(() => {
      expect(screen.getByText(/you have no rides yet/i)).toBeInTheDocument();
    });
    expect(screen.queryByRole("list", { name: "Your rides" })).not.toBeInTheDocument();
  });
});
