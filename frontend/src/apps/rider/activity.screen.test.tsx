/**
 * Unit tests for the rider ActivityScreen on a live trip-client stub.
 * Complements rider.journey.test.tsx (ordering, coordinate fallback, Load more, basic
 * error and empty states) with loading, scroll-triggered paging, paging end, load-more
 * failure, fare display and the no-seed-data guarantee.
 *
 * Requirements: 8.1, 8.5, 8.6, 8.7, 12.4.
 */
import { cleanup, fireEvent, render, screen, waitFor, within, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TripResponse } from "../../domain/trip/contract";

const { listTrips } = vi.hoisted(() => ({ listTrips: vi.fn() }));

vi.mock("../../domain/trip", () => ({
  resolveTripClient: () => ({ listTrips }),
}));

import { ActivityScreen } from "./ActivityScreen";
import { SessionIdentityProvider } from "../../identity/SessionIdentityProvider";
import { useCurrentIdentity } from "../../identity/useCurrentIdentity";

const RIDER_ID = "11111111-1111-1111-1111-111111111111";

function makeTrip(overrides: Partial<TripResponse> = {}): TripResponse {
  return {
    id: "trip-1",
    passengerId: RIDER_ID,
    driverId: null,
    vehicleId: null,
    rideType: "MOTORBIKE",
    pickupLat: 10.7725,
    pickupLng: 106.698,
    pickupAddress: "Ben Thanh Market",
    destinationLat: 10.7797,
    destinationLng: 106.699,
    destinationAddress: "Notre-Dame Cathedral",
    status: "COMPLETED",
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

const page = (ids: string[], total: number, offset = 0) => ({
  items: ids.map((id) => makeTrip({ id })),
  total,
  limit: 20,
  offset,
});

function SignedInRider({ children }: { children: ReactElement }) {
  const identity = useCurrentIdentity();
  const ready = identity.current("rider") !== null;
  useEffect(() => {
    if (!ready) identity.signIn({ role: "rider", id: RIDER_ID });
  }, [ready, identity]);
  return ready ? children : null;
}

function renderActivity() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <SessionIdentityProvider>
          <SignedInRider>
            <ActivityScreen />
          </SignedInRider>
        </SessionIdentityProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  listTrips.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ActivityScreen on a live trip client", () => {
  it("shows a loading indicator until the first page resolves", async () => {
    let resolve!: (v: unknown) => void;
    listTrips.mockReturnValue(new Promise((r) => (resolve = r)));
    renderActivity();

    expect(await screen.findByRole("status", { name: "Loading activity" })).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Trip history" })).not.toBeInTheDocument();

    await act(async () => resolve(page(["a"], 1)));
    expect(await screen.findByRole("list", { name: "Trip history" })).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "Loading activity" })).not.toBeInTheDocument();
  });

  it("shows only what the client returns, with final fare preferred over estimate (Req 8.1)", async () => {
    listTrips.mockResolvedValue({
      items: [
        makeTrip({ id: "done", finalFare: 30000, estimatedFare: 25000, requestedAt: "2025-02-01T00:00:00.000Z" }),
        makeTrip({ id: "est", finalFare: null, estimatedFare: 45000, status: "CANCELLED" }),
      ],
      total: 2,
      limit: 20,
      offset: 0,
    });
    renderActivity();

    const list = await screen.findByRole("list", { name: "Trip history" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(listTrips).toHaveBeenCalledTimes(1);
    const [first, second] = within(list).getAllByRole("listitem");
    expect(first!.textContent).toMatch(/30[.,]000/);
    expect(first!.textContent).not.toMatch(/25[.,]000/);
    expect(second!.textContent).toMatch(/45[.,]000/);
    expect(within(list).queryByText(/★|rating/i)).not.toBeInTheDocument();
  });

  it("hides Load more once every trip is loaded (Req 8.5)", async () => {
    listTrips.mockResolvedValue(page(["a", "b"], 2));
    renderActivity();
    await screen.findByRole("list", { name: "Trip history" });
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });

  it("loads the next page when the end sentinel scrolls into view (Req 8.5)", async () => {
    const observers: Array<(entries: Array<{ isIntersecting: boolean }>) => void> = [];
    class FakeObserver {
      constructor(cb: (entries: Array<{ isIntersecting: boolean }>) => void) {
        observers.push(cb);
      }
      observe() {}
      disconnect() {}
      unobserve() {}
    }
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    listTrips.mockResolvedValueOnce(page(["a"], 2)).mockResolvedValueOnce(page(["b"], 2, 1));
    renderActivity();

    await screen.findByRole("list", { name: "Trip history" });
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
    await waitFor(() => expect(observers.length).toBeGreaterThan(0));

    act(() => observers[observers.length - 1]!([{ isIntersecting: true }]));

    await waitFor(() => expect(listTrips).toHaveBeenCalledTimes(2));
    expect(listTrips).toHaveBeenLastCalledWith({ passengerId: RIDER_ID, limit: 20, offset: 1 });
    await waitFor(() =>
      expect(within(screen.getByRole("list", { name: "Trip history" })).getAllByRole("listitem")).toHaveLength(2),
    );
  });

  it("keeps loaded trips and offers retry when the next page fails (Req 8.7)", async () => {
    listTrips
      .mockResolvedValueOnce(page(["a"], 2))
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(page(["b"], 2, 1));
    renderActivity();

    fireEvent.click(await screen.findByRole("button", { name: "Load more" }));
    const retry = await screen.findByRole("button", { name: "Retry" });
    expect(within(screen.getByRole("list", { name: "Trip history" })).getAllByRole("listitem")).toHaveLength(1);

    fireEvent.click(retry);
    await waitFor(() =>
      expect(within(screen.getByRole("list", { name: "Trip history" })).getAllByRole("listitem")).toHaveLength(2),
    );
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("shows a friendly error without the raw failure and recovers on retry (Req 8.7)", async () => {
    listTrips.mockRejectedValueOnce(new Error("ECONNRESET stack trace")).mockResolvedValueOnce(page(["a"], 1));
    renderActivity();

    expect(await screen.findByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Trip history" })).not.toBeInTheDocument();
    expect(screen.queryByText(/no rides yet/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("list", { name: "Trip history" })).toBeInTheDocument();
    expect(listTrips).toHaveBeenCalledTimes(2);
  });

  it("shows the empty state, not an error, when the rider has no trips (Req 8.6)", async () => {
    listTrips.mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 });
    renderActivity();

    expect(await screen.findByText(/no rides yet/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Book a ride" })).toHaveAttribute("href", "/rider");
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Trip history" })).not.toBeInTheDocument();
  });
});
