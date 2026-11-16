/**
 * useDriverLocationStream — the rider's side of the SSE contract
 * (docs/REALTIME.md section 5, realtime-gateway/README.md).
 *
 *  1. Only while the trip is DRIVER_ASSIGNED / DRIVER_ARRIVED / IN_PROGRESS.
 *  2. First the REST snapshot (`getLiveState(driverId)`), then the `EventSource`.
 *  3. `location` events feed `onPoint`; `trip-ended` closes the stream and calls `onEnded`.
 *  4. A refused stream (400/403/410) never opens: the browser closes it for good
 *     (readyState CLOSED after `error`), so we stop and call `onEnded` to recheck REST.
 *     An error on an open stream is a dropped connection: the browser retries by itself.
 *  5. Closes on a terminal status or unmount.
 */
import { useEffect, useRef, useState } from "react";
import type { TripResponse } from "../domain/trip";
import type { TripStatus } from "../shared/enums";

export const TRACKING_STATUSES: readonly TripStatus[] = ["DRIVER_ASSIGNED", "DRIVER_ARRIVED", "IN_PROGRESS"];

export interface LocationPoint {
  driverId: string;
  tripId: string;
  lat: number;
  lng: number;
  recordedAt: string;
}

/** The subset of `EventSource` the hook uses, so tests can supply a fake. */
export interface EventSourceLike {
  readyState: number;
  addEventListener(type: string, listener: (event: MessageEvent) => void): void;
  onerror: ((event: Event) => void) | null;
  close(): void;
}

export interface UseDriverLocationStreamOptions {
  /** Absolute stream URL for the trip and passenger. */
  streamUrl: (tripId: string, passengerId: string) => string;
  /** REST snapshot of the driver's position; null when unknown. */
  getSnapshot: (driverId: string) => Promise<{ lat: number | null; lng: number | null; recordedAt: string | null } | null>;
  onPoint: (point: LocationPoint) => void;
  /** The stream ended (trip-ended, or refused): the caller should refetch the trip. */
  onEnded?: (() => void) | undefined;
  createEventSource?: (url: string) => EventSourceLike;
}

const CLOSED = 2;

export type StreamState = "idle" | "connecting" | "open" | "ended";

export function isTracking(status: TripStatus): boolean {
  return TRACKING_STATUSES.includes(status);
}

export function useDriverLocationStream(
  trip: TripResponse | null,
  options: UseDriverLocationStreamOptions,
): StreamState {
  const [state, setState] = useState<StreamState>("idle");
  const opts = useRef(options);
  opts.current = options;

  const tripId = trip?.id ?? null;
  const passengerId = trip?.passengerId ?? null;
  const driverId = trip?.driverId ?? null;
  const tracking = trip !== null && driverId !== null && isTracking(trip.status);

  useEffect(() => {
    if (!tracking || tripId === null || passengerId === null || driverId === null) {
      setState("idle");
      return undefined;
    }
    let cancelled = false;
    let source: EventSourceLike | null = null;
    setState("connecting");

    void (async () => {
      const snapshot = await opts.current.getSnapshot(driverId).catch(() => null);
      if (cancelled) {
        return;
      }
      if (snapshot && snapshot.lat !== null && snapshot.lng !== null) {
        opts.current.onPoint({
          driverId,
          tripId,
          lat: snapshot.lat,
          lng: snapshot.lng,
          recordedAt: snapshot.recordedAt ?? new Date().toISOString(),
        });
      }
      const create = opts.current.createEventSource ?? ((url: string) => new EventSource(url));
      const es = create(opts.current.streamUrl(tripId, passengerId));
      source = es;
      es.addEventListener("open", () => {
        if (!cancelled) setState("open");
      });
      es.addEventListener("location", (event) => {
        try {
          opts.current.onPoint(JSON.parse(event.data) as LocationPoint);
        } catch {
          // ignore a malformed event
        }
      });
      es.addEventListener("trip-ended", () => {
        es.close();
        if (!cancelled) {
          setState("ended");
          opts.current.onEnded?.();
        }
      });
      es.onerror = () => {
        if (es.readyState === CLOSED && !cancelled) {
          // Refused (400/403/410): the browser will not retry, and neither do we.
          es.close();
          setState("ended");
          opts.current.onEnded?.();
        }
      };
    })();

    return () => {
      cancelled = true;
      source?.close();
    };
  }, [tracking, tripId, passengerId, driverId]);

  return state;
}
