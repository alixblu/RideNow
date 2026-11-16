/**
 * useLocationSender — while the driver is online, posts a position every
 * `intervalMs` (1-2s) to driver-service, from one of two sources:
 *
 *  - "gps": the browser's Geolocation (`watchPosition`); the latest fix is sent.
 *    Permission denied => `onDenied`, and nothing is sent.
 *  - "simulate": walks the given route one step per tick, then holds the last point.
 *
 * Stops when `online` turns false, the source changes, or the component unmounts.
 */
import { useEffect, useRef } from "react";
import type { LatLng } from "../../map/roadSnapper";

export type LocationSource = "gps" | "simulate";

export interface UseLocationSenderOptions {
  online: boolean;
  source: LocationSource;
  /** The points the simulation walks along; ignored for "gps". */
  route: LatLng[];
  send: (point: LatLng) => void;
  onDenied?: (() => void) | undefined;
  intervalMs?: number | undefined;
  geolocation?: Geolocation | undefined;
}

const PERMISSION_DENIED = 1;

export function useLocationSender({
  online,
  source,
  route,
  send,
  onDenied,
  intervalMs = 1500,
  geolocation = typeof navigator !== "undefined" ? navigator.geolocation : undefined,
}: UseLocationSenderOptions): void {
  const sendRef = useRef(send);
  sendRef.current = send;
  const deniedRef = useRef(onDenied);
  deniedRef.current = onDenied;
  const routeRef = useRef(route);
  const step = useRef(0);

  // A new route restarts the walk from its first point.
  useEffect(() => {
    routeRef.current = route;
    step.current = 0;
  }, [route]);

  useEffect(() => {
    if (!online) {
      return undefined;
    }
    if (source === "simulate") {
      const tick = () => {
        const points = routeRef.current;
        if (points.length === 0) {
          return;
        }
        const i = Math.min(step.current, points.length - 1);
        sendRef.current(points[i]!);
        step.current = i + 1;
      };
      tick();
      const timer = setInterval(tick, intervalMs);
      return () => clearInterval(timer);
    }

    if (!geolocation) {
      deniedRef.current?.();
      return undefined;
    }
    let latest: LatLng | null = null;
    const watchId = geolocation.watchPosition(
      (position) => {
        latest = { lat: position.coords.latitude, lng: position.coords.longitude };
      },
      (error) => {
        if (error.code === PERMISSION_DENIED) {
          deniedRef.current?.();
        }
      },
      { enableHighAccuracy: true, maximumAge: 1000 },
    );
    const timer = setInterval(() => {
      if (latest) {
        sendRef.current(latest);
      }
    }, intervalMs);
    return () => {
      clearInterval(timer);
      geolocation.clearWatch(watchId);
    };
  }, [online, source, intervalMs, geolocation]);
}

/** Splits a polyline so consecutive points are at most `stepMeters` apart. */
export function densify(points: LatLng[], stepMeters = 25): LatLng[] {
  if (points.length < 2) {
    return points;
  }
  const out: LatLng[] = [points[0]!];
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const meters = approxMeters(a, b);
    const parts = Math.max(1, Math.ceil(meters / stepMeters));
    for (let k = 1; k <= parts; k += 1) {
      out.push({ lat: a.lat + ((b.lat - a.lat) * k) / parts, lng: a.lng + ((b.lng - a.lng) * k) / parts });
    }
  }
  return out;
}

function approxMeters(a: LatLng, b: LatLng): number {
  const dLat = (b.lat - a.lat) * 111_320;
  const dLng = (b.lng - a.lng) * 111_320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
}
