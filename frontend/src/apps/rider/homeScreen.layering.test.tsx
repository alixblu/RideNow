/**
 * Regression test for the Home screen layering fix.
 * Requirements: 1.2, 2.3, 3.1, 3.2, 3.3.
 *
 * Renders HomeScreen with the real MapCanvas (Leaflet is not mocked) and checks that the
 * booking controls are mounted inside the Booking_Sheet (z-10) while the Map_Wrapper
 * creates its own stacking context (`isolate`).
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import fc from "fast-check";
import { useEffect } from "react";
import type { ReactElement } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DriverResponse, DriverServiceClientExt } from "../../domain/driver/contract";
import type { TripResponse, TripServiceClientExt } from "../../domain/trip/contract";
import { saveSession } from "../../identity/sessionStore";
import { NoopSnapper } from "../../map/roadSnapper";
import { ToastProvider } from "../../shared/ui";
import { DriveScreen } from "../driver/DriveScreen";
import { DriverContext } from "../driver/DriverContext";
import { TripDetailScreen } from "./TripDetailScreen";

const { estimateFares, requestTrip, getTrip, cancelTrip, listTrips, search } = vi.hoisted(() => ({
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

import { HomeScreen } from "./HomeScreen";
import { SessionIdentityProvider } from "../../identity/SessionIdentityProvider";
import { mockProfiles } from "../../domain/seed/people";
import { useCurrentIdentity } from "../../identity/useCurrentIdentity";

const RIDER = mockProfiles.rider[0]!;

function SignedInRider({ children }: { children: ReactElement }) {
  const identity = useCurrentIdentity();
  const ready = identity.current("rider") !== null;
  useEffect(() => {
    if (!ready) identity.signIn({ role: "rider", id: RIDER.userId });
  }, [ready, identity]);
  return ready ? children : null;
}

function renderHome() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={["/rider"]}>
      <QueryClientProvider client={queryClient}>
        <SessionIdentityProvider>
          <SignedInRider>
            <HomeScreen />
          </SignedInRider>
        </SessionIdentityProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  estimateFares.mockResolvedValue([]);
  listTrips.mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("HomeScreen layering", () => {
  it("mounts the booking inputs inside a z-10 Booking_Sheet", async () => {
    const { container } = renderHome();

    const pickup = await screen.findByLabelText("Pickup");
    const destination = await screen.findByLabelText("Where to?");
    expect(container.querySelector("#home-pickup")).not.toBeNull();
    expect(container.querySelector("#home-destination")).not.toBeNull();

    const sheet = container.querySelector("section");
    expect(sheet).not.toBeNull();
    expect(sheet!.contains(pickup)).toBe(true);
    expect(sheet!.contains(destination)).toBe(true);
    expect(sheet!.classList.contains("z-10")).toBe(true);
  });

  it("isolates the Map_Wrapper stacking context", async () => {
    renderHome();
    await screen.findByLabelText("Pickup");
    expect(screen.getByTestId("trip-map").classList.contains("isolate")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Property 1: Map_Wrapper always isolates its stacking context
// ---------------------------------------------------------------------------

type Caller = "HomeScreen" | "DriveScreen" | "TripDetailScreen";
type RenderState = "no-route" | "route-no-trip" | "active-trip";

const PICKUP = { address: "Ben Thanh Market", lat: 10.7725, lng: 106.698 };
const DEST = { address: "Notre-Dame Cathedral", lat: 10.7797, lng: 106.699 };
const ESTIMATES = [
  { vehicleType: "MOTORBIKE", amount: 25000, currency: "VND", distanceKm: 3.2, durationMin: 9 },
  { vehicleType: "CAR", amount: 60000, currency: "VND", distanceKm: 3.2, durationMin: 9 },
];
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

const ASSIGNED = makeTrip({ status: "DRIVER_ASSIGNED", driverId: DRIVER_ID });

async function pickPlace(label: string, place: { address: string; lat: number; lng: number }) {
  search.mockResolvedValueOnce([place]);
  fireEvent.change(await screen.findByLabelText(label), { target: { value: place.address } });
  fireEvent.mouseDown(await screen.findByRole("option", { name: place.address }, { timeout: 3000 }));
}

async function renderHomeState(state: RenderState) {
  if (state === "active-trip") {
    listTrips.mockResolvedValue({ items: [ASSIGNED], total: 1, limit: 20, offset: 0 });
    getTrip.mockResolvedValue(ASSIGNED);
  }
  estimateFares.mockResolvedValue(ESTIMATES);
  renderHome();
  await screen.findByLabelText(state === "active-trip" ? "Driver" : "Pickup", {}, { timeout: 3000 });
  if (state === "route-no-trip") {
    await pickPlace("Pickup", PICKUP);
    await pickPlace("Where to?", DEST);
    await screen.findByRole("list", { name: "Fare quotes" }, { timeout: 3000 });
  }
}

async function renderDriveState(state: RenderState) {
  localStorage.clear();
  saveSession(localStorage, { role: "driver", id: DRIVER.userId });
  const trips = {
    listTrips: vi.fn().mockResolvedValue({ items: [makeTrip()], total: 1, limit: 20, offset: 0 }),
    estimateFares: vi.fn().mockResolvedValue(ESTIMATES),
    acceptTrip: vi.fn().mockResolvedValue(ASSIGNED),
    getTrip: vi.fn().mockResolvedValue(ASSIGNED),
    arriveTrip: vi.fn(),
    startTrip: vi.fn(),
    completeTrip: vi.fn(),
  } as unknown as TripServiceClientExt;
  const client = {
    goOnline: vi.fn().mockResolvedValue(undefined),
    goOffline: vi.fn().mockResolvedValue(undefined),
    updateLocation: vi.fn().mockResolvedValue(undefined),
  } as unknown as DriverServiceClientExt;
  const geolocation = {
    watchPosition: () => 1,
    clearWatch: () => undefined,
    getCurrentPosition: () => undefined,
  } as unknown as Geolocation;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
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
  const toggle = await screen.findByRole("switch", { name: "Online" });
  if (state === "no-route") return;
  fireEvent.click(toggle);
  await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));
  const accept = await screen.findByRole("button", { name: "Accept" }, { timeout: 3000 });
  if (state === "active-trip") {
    fireEvent.click(accept);
    await screen.findByRole("heading", { name: "Current trip" }, { timeout: 3000 });
  }
}

async function renderDetailState(state: RenderState) {
  getTrip.mockResolvedValue(state === "active-trip" ? ASSIGNED : makeTrip({ status: "COMPLETED" }));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter initialEntries={["/rider/activity/trip-1"]}>
      <QueryClientProvider client={queryClient}>
        <Routes>
          <Route path="/rider/activity/:tripId" element={<TripDetailScreen />} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
  await screen.findByTestId("trip-map", {}, { timeout: 3000 });
}

/** The Trip detail screen only mounts its map once a trip (and so a route) is loaded. */
const COMBOS: ReadonlyArray<readonly [Caller, RenderState]> = [
  ["HomeScreen", "no-route"],
  ["HomeScreen", "route-no-trip"],
  ["HomeScreen", "active-trip"],
  ["DriveScreen", "no-route"],
  ["DriveScreen", "route-no-trip"],
  ["DriveScreen", "active-trip"],
  ["TripDetailScreen", "route-no-trip"],
  ["TripDetailScreen", "active-trip"],
];

describe("Property 1: Map_Wrapper always isolates its stacking context", () => {
  // Feature: rider-home-booking-ui, Property 1: Map_Wrapper always isolates its stacking context
  // **Validates: Requirements 2.1, 2.2, 2.4, 3.1**
  beforeEach(() => {
    vi.stubGlobal(
      "EventSource",
      class {
        readyState = 0;
        addEventListener() {}
        close() {}
      },
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("the single trip-map root has `isolate` for every caller and render state", async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...COMBOS), async ([caller, state]) => {
        try {
          localStorage.clear();
          if (caller === "HomeScreen") await renderHomeState(state);
          else if (caller === "DriveScreen") await renderDriveState(state);
          else await renderDetailState(state);

          const maps = screen.getAllByTestId("trip-map");
          expect(maps).toHaveLength(1);
          expect(maps[0]!.classList.contains("isolate")).toBe(true);
        } finally {
          cleanup();
          vi.clearAllMocks();
          listTrips.mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 });
        }
      }),
      { numRuns: COMBOS.length * 2 },
    );
  }, 120_000);
});

// ---------------------------------------------------------------------------
// Property 2: Booking controls stay reachable inside the sheet regardless of booking phase
// ---------------------------------------------------------------------------

type BookingPhase =
  | "empty"
  | "pickup-only"
  | "destination-only"
  | "both-loading"
  | "both-loaded"
  | "both-error";

const BOOKING_PHASES: readonly BookingPhase[] = [
  "empty",
  "pickup-only",
  "destination-only",
  "both-loading",
  "both-loaded",
  "both-error",
];

describe("Property 2: Booking controls stay reachable inside the sheet regardless of booking phase", () => {
  // Feature: rider-home-booking-ui, Property 2: Booking controls stay reachable inside the sheet regardless of booking phase
  // **Validates: Requirements 1.2, 2.3, 3.2**
  it("both AddressInputs live inside the z-10 Booking_Sheet for every pre-trip phase", async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...BOOKING_PHASES), async (phase) => {
        try {
          localStorage.clear();
          if (phase === "both-loading") estimateFares.mockReturnValue(new Promise(() => {}));
          else if (phase === "both-error") estimateFares.mockRejectedValue(new Error("quote failed"));
          else estimateFares.mockResolvedValue(ESTIMATES);

          const { container } = renderHome();
          await screen.findByLabelText("Pickup", {}, { timeout: 3000 });

          if (phase === "pickup-only" || phase.startsWith("both")) await pickPlace("Pickup", PICKUP);
          if (phase === "destination-only" || phase.startsWith("both")) {
            await pickPlace("Where to?", DEST);
          }
          if (phase === "both-loaded") {
            await screen.findByRole("list", { name: "Fare quotes" }, { timeout: 3000 });
          }

          const sheet = container.querySelector("section");
          expect(sheet).not.toBeNull();
          expect(sheet!.classList.contains("z-10")).toBe(true);
          const pickup = container.querySelector("#home-pickup");
          const destination = container.querySelector("#home-destination");
          expect(pickup).not.toBeNull();
          expect(destination).not.toBeNull();
          expect(sheet!.contains(pickup)).toBe(true);
          expect(sheet!.contains(destination)).toBe(true);
        } finally {
          cleanup();
          vi.clearAllMocks();
          listTrips.mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 });
        }
      }),
      { numRuns: BOOKING_PHASES.length * 2 },
    );
  }, 120_000);
});
