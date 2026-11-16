import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { createDriverMockClient } from "../../domain/driver/mockClient";
import type { DriverServiceClient } from "../../domain/driver";
import { createTripMockClient } from "../../domain/trip/mockClient";
import type { TripServiceClient } from "../../domain/trip";
import { NoopSnapper } from "../../map/roadSnapper";
import { ToastProvider } from "../../shared/ui";
import { TripDesk } from "./TripDesk";
import { densify } from "./useLocationSender";

function renderWith(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>{ui}</ToastProvider>
    </QueryClientProvider>,
  );
}

async function tick(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function deniedGeolocation(): Geolocation {
  return {
    watchPosition: (_ok: PositionCallback, fail?: PositionErrorCallback | null) => {
      fail?.({ code: 1, message: "denied", PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 });
      return 1;
    },
    clearWatch: vi.fn(),
    getCurrentPosition: vi.fn(),
  } as unknown as Geolocation;
}

function grantedGeolocation(lat: number, lng: number): Geolocation & { clearWatch: ReturnType<typeof vi.fn> } {
  return {
    watchPosition: (ok: PositionCallback) => {
      ok({ coords: { latitude: lat, longitude: lng } } as GeolocationPosition);
      return 7;
    },
    clearWatch: vi.fn(),
    getCurrentPosition: vi.fn(),
  } as unknown as Geolocation & { clearWatch: ReturnType<typeof vi.fn> };
}

let client: DriverServiceClient;
let tripClient: TripServiceClient;
let driverId: string;

beforeEach(async () => {
  vi.useFakeTimers();
  client = createDriverMockClient();
  tripClient = createTripMockClient();
  const driver = await client.createDriver({ userId: crypto.randomUUID(), licenseNumber: "B2-0001" });
  driverId = driver.id;
  await client.addVehicle(driverId, { plateNumber: "59A-12345", vehicleType: "MOTORBIKE" });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("densify", () => {
  it("splits long segments into short steps", () => {
    const points = densify([{ lat: 10, lng: 106 }, { lat: 10.001, lng: 106 }], 25); // ~111 m
    expect(points.length).toBeGreaterThanOrEqual(5);
    expect(points[points.length - 1]).toEqual({ lat: 10.001, lng: 106 });
  });
});

describe("TripDesk", () => {
  it("goes online and offline with the toggle", async () => {
    const goOnline = vi.spyOn(client, "goOnline");
    const goOffline = vi.spyOn(client, "goOffline");
    renderWith(<TripDesk driverId={driverId} client={client} tripClient={tripClient} snapper={new NoopSnapper()} geolocation={grantedGeolocation(10, 106)} />);

    fireEvent.click(screen.getByRole("button", { name: "Go online" }));
    await tick();
    expect(goOnline).toHaveBeenCalledWith(driverId);
    expect(screen.getByRole("button", { name: "Go offline" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Go offline" }));
    await tick();
    expect(goOffline).toHaveBeenCalledWith(driverId);
    expect(screen.getByRole("button", { name: "Go online" })).toBeInTheDocument();
  });

  it("sends the device location while online and stops when offline", async () => {
    const update = vi.spyOn(client, "updateLocation");
    const geo = grantedGeolocation(10.77, 106.7);
    renderWith(<TripDesk driverId={driverId} client={client} tripClient={tripClient} snapper={new NoopSnapper()} geolocation={geo} intervalMs={1500} />);

    await tick(5000);
    expect(update).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Go online" }));
    await tick();
    await tick(1500);
    await tick(1500);
    expect(update).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenLastCalledWith(driverId, 10.77, 106.7);

    fireEvent.click(screen.getByRole("button", { name: "Go offline" }));
    await tick();
    const sent = update.mock.calls.length;
    await tick(6000);
    expect(update.mock.calls.length).toBe(sent);
    expect(geo.clearWatch).toHaveBeenCalledWith(7);
  });

  it("stops sending on unmount", async () => {
    const update = vi.spyOn(client, "updateLocation");
    const { unmount } = renderWith(
      <TripDesk driverId={driverId} client={client} tripClient={tripClient} snapper={new NoopSnapper()} geolocation={grantedGeolocation(10, 106)} intervalMs={1000} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Go online" }));
    await tick();
    await tick(1000);
    const sent = update.mock.calls.length;
    expect(sent).toBeGreaterThan(0);

    unmount();
    await tick(5000);
    expect(update.mock.calls.length).toBe(sent);
  });

  it("explains a denied location permission and offers simulation", async () => {
    const update = vi.spyOn(client, "updateLocation");
    renderWith(<TripDesk driverId={driverId} client={client} tripClient={tripClient} snapper={new NoopSnapper()} geolocation={deniedGeolocation()} intervalMs={1000} />);

    fireEvent.click(screen.getByRole("button", { name: "Go online" }));
    await tick();

    expect(screen.getByRole("alert")).toHaveTextContent("Location permission was denied");
    await tick(3000);
    expect(update).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Simulate drive instead" }));
    await tick();
    await tick(1000);
    expect(update).toHaveBeenCalled();
  });

  it("shows the action for each status and walks the trip to completion", async () => {
    const trip = await tripClient.requestTrip({
      passengerId: crypto.randomUUID(),
      rideType: "MOTORBIKE",
      pickupLat: 10.7725,
      pickupLng: 106.698,
      destinationLat: 10.7626,
      destinationLng: 106.6602,
      paymentMethod: "CASH",
    });
    renderWith(<TripDesk driverId={driverId} client={client} tripClient={tripClient} snapper={new NoopSnapper()} geolocation={grantedGeolocation(10, 106)} />);
    await tick();
    expect(screen.getByText("Accept a ride to start a trip.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /accept/i }));
    await tick();
    await tick();
    expect(await tripClient.getTrip(trip.id)).toMatchObject({ status: "DRIVER_ASSIGNED", driverId });

    fireEvent.click(screen.getByRole("button", { name: "Arrived at pickup" }));
    await tick();
    expect(screen.queryByRole("button", { name: "Arrived at pickup" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Start trip" }));
    await tick();

    fireEvent.click(screen.getByRole("button", { name: "Complete trip" }));
    await tick();
    expect((await tripClient.getTrip(trip.id)).status).toBe("COMPLETED");
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
  });
});
