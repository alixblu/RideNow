import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { TripResponse } from "../domain/trip";
import type { TripStatus } from "../shared/enums";
import { useDriverLocationStream } from "./useDriverLocationStream";
import type { EventSourceLike, UseDriverLocationStreamOptions } from "./useDriverLocationStream";

class FakeEventSource implements EventSourceLike {
  static instances: FakeEventSource[] = [];
  readyState = 0;
  closed = false;
  onerror: ((event: Event) => void) | null = null;
  private listeners = new Map<string, ((event: MessageEvent) => void)[]>();

  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  emit(type: string, data?: unknown) {
    const event = { data: data === undefined ? "" : JSON.stringify(data) } as MessageEvent;
    this.listeners.get(type)?.forEach((l) => l(event));
  }

  fail(readyState: number) {
    this.readyState = readyState;
    this.onerror?.(new Event("error"));
  }

  close() {
    this.closed = true;
    this.readyState = 2;
  }
}

function trip(status: TripStatus, driverId: string | null = "d-1"): TripResponse {
  return {
    id: "t-1",
    passengerId: "p-1",
    driverId,
    vehicleId: null,
    rideType: "CAR",
    pickupLat: 10,
    pickupLng: 106,
    pickupAddress: null,
    destinationLat: 10.1,
    destinationLng: 106.1,
    destinationAddress: null,
    status,
    estimatedFare: null,
    finalFare: null,
    cancellationReason: null,
    version: 0,
    requestedAt: "2026-11-11T07:00:00Z",
    acceptedAt: null,
    arrivedAt: null,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    createdAt: "2026-11-11T07:00:00Z",
    updatedAt: "2026-11-11T07:00:00Z",
  };
}

function options(overrides: Partial<UseDriverLocationStreamOptions> = {}): UseDriverLocationStreamOptions {
  return {
    streamUrl: (t, p) => `http://gw.test/live/trips/${t}/location?userId=${p}`,
    getSnapshot: vi.fn(async () => ({ lat: 10.5, lng: 106.5, recordedAt: "2026-11-11T07:00:00Z" })),
    onPoint: vi.fn(),
    onEnded: vi.fn(),
    createEventSource: (url) => new FakeEventSource(url),
    ...overrides,
  };
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

afterEach(() => {
  cleanup();
  FakeEventSource.instances = [];
});

describe("useDriverLocationStream", () => {
  it("does not open a stream before a driver is assigned", async () => {
    const opts = options();
    renderHook(() => useDriverLocationStream(trip("SEARCHING", null), opts));
    await settle();
    expect(FakeEventSource.instances).toHaveLength(0);
    expect(opts.getSnapshot).not.toHaveBeenCalled();
  });

  it("draws the REST snapshot first, then opens the stream and forwards locations", async () => {
    const order: string[] = [];
    const opts = options({
      getSnapshot: vi.fn(async () => {
        order.push("snapshot");
        return { lat: 10.5, lng: 106.5, recordedAt: "2026-11-11T07:00:00Z" };
      }),
      createEventSource: (url) => {
        order.push("eventsource");
        return new FakeEventSource(url);
      },
    });

    renderHook(() => useDriverLocationStream(trip("DRIVER_ASSIGNED"), opts));
    await settle();

    expect(order).toEqual(["snapshot", "eventsource"]);
    expect(FakeEventSource.instances[0]!.url).toBe("http://gw.test/live/trips/t-1/location?userId=p-1");
    expect(opts.onPoint).toHaveBeenCalledWith(expect.objectContaining({ lat: 10.5, lng: 106.5 }));

    const point = { driverId: "d-1", tripId: "t-1", lat: 10.6, lng: 106.6, recordedAt: "2026-11-11T07:00:01Z" };
    act(() => FakeEventSource.instances[0]!.emit("location", point));
    expect(opts.onPoint).toHaveBeenLastCalledWith(point);
  });

  it("closes on trip-ended and reports the end", async () => {
    const opts = options();
    const { result } = renderHook(() => useDriverLocationStream(trip("IN_PROGRESS"), opts));
    await settle();

    act(() => FakeEventSource.instances[0]!.emit("trip-ended", { tripId: "t-1" }));

    expect(FakeEventSource.instances[0]!.closed).toBe(true);
    expect(opts.onEnded).toHaveBeenCalledTimes(1);
    expect(result.current).toBe("ended");
  });

  it("closes when the trip reaches a terminal status", async () => {
    const opts = options();
    const { rerender } = renderHook(({ t }) => useDriverLocationStream(t, opts), {
      initialProps: { t: trip("IN_PROGRESS") },
    });
    await settle();
    const es = FakeEventSource.instances[0]!;

    rerender({ t: trip("COMPLETED") });

    expect(es.closed).toBe(true);
  });

  it("closes on unmount", async () => {
    const { unmount } = renderHook(() => useDriverLocationStream(trip("DRIVER_ARRIVED"), options()));
    await settle();

    unmount();

    expect(FakeEventSource.instances[0]!.closed).toBe(true);
  });

  it("stops for good when the stream is refused (400/403/410), but not on a dropped connection", async () => {
    const opts = options();
    renderHook(() => useDriverLocationStream(trip("DRIVER_ASSIGNED"), opts));
    await settle();
    const es = FakeEventSource.instances[0]!;

    // A dropped connection: the browser is reconnecting (CONNECTING); leave it.
    act(() => es.fail(0));
    expect(es.closed).toBe(false);
    expect(opts.onEnded).not.toHaveBeenCalled();

    // Refused: the browser closed it (CLOSED); we stop and recheck the trip.
    act(() => es.fail(2));
    expect(opts.onEnded).toHaveBeenCalledTimes(1);
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it("still opens the stream when the snapshot fails", async () => {
    const opts = options({ getSnapshot: vi.fn(async () => Promise.reject(new Error("404"))) });
    renderHook(() => useDriverLocationStream(trip("DRIVER_ASSIGNED"), opts));
    await settle();

    expect(FakeEventSource.instances).toHaveLength(1);
    expect(opts.onPoint).not.toHaveBeenCalled();
  });
});
