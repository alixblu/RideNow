/**
 * Smooth car marker (docs/REALTIME.md section 6).
 *
 * Positions arrive about once a second, with jitter. Instead of jumping to each one,
 * the marker renders about 1s in the past and interpolates between the two buffered
 * points around that moment.
 *
 *  - Points are ordered by `recordedAt`; an out-of-order or repeated point is dropped.
 *  - A move over 500 m jumps straight there (for example after a reconnect gap).
 *  - With no point for 10s (by arrival time) the car is stale.
 *  - Heading eases toward the travel bearing, turning the short way round.
 *  - `recordedAt` is driver-service's clock, so it is never compared with the local
 *    clock directly: the offset between the two is estimated from arrivals.
 *
 * {@link SmoothTrack} is the pure math (driven by explicit times, easy to test);
 * {@link createSmoothMarker} runs it on `requestAnimationFrame` against a marker.
 */

export interface TrackPoint {
  lat: number;
  lng: number;
  /** ISO-8601 or epoch ms, driver-service clock. */
  recordedAt: string | number;
}

export interface TrackSample {
  lat: number;
  lng: number;
  /** Degrees clockwise from north, eased. */
  heading: number;
  stale: boolean;
}

export const RENDER_DELAY_MS = 1000;
export const JUMP_METERS = 500;
export const STALE_AFTER_MS = 10_000;
/** Fraction of the remaining turn applied per second of animation. */
const HEADING_EASE_PER_SECOND = 4;
const MAX_BUFFER = 20;

interface Buffered {
  lat: number;
  lng: number;
  t: number; // recordedAt, ms, driver-service clock
}

export class SmoothTrack {
  private buffer: Buffered[] = [];
  private lastArrival: number | null = null;
  /** local clock - remote clock, the smallest seen (closest to the real offset plus latency). */
  private offset: number | null = null;
  private heading = 0;
  private lastSampleAt: number | null = null;

  /** Adds a point. Returns false if it was dropped as out of order. */
  push(point: TrackPoint, arrivedAt: number): boolean {
    const t = typeof point.recordedAt === "number" ? point.recordedAt : Date.parse(point.recordedAt);
    if (Number.isNaN(t)) {
      return false;
    }
    const last = this.buffer[this.buffer.length - 1];
    if (last && t <= last.t) {
      return false;
    }
    const offset = arrivedAt - t;
    this.offset = this.offset === null ? offset : Math.min(this.offset, offset);
    this.lastArrival = arrivedAt;
    const next = { lat: point.lat, lng: point.lng, t };
    if (last && distanceMeters(last, next) > JUMP_METERS) {
      // Too far to animate believably: jump.
      this.buffer = [next];
      return true;
    }
    this.buffer.push(next);
    if (this.buffer.length > MAX_BUFFER) {
      this.buffer.shift();
    }
    return true;
  }

  /** The marker state at local time `now`, or null before the first point. */
  sample(now: number): TrackSample | null {
    if (this.buffer.length === 0 || this.offset === null) {
      return null;
    }
    const renderAt = now - this.offset - RENDER_DELAY_MS;
    const { lat, lng, bearing } = this.positionAt(renderAt);
    const dt = this.lastSampleAt === null ? 0 : Math.max(0, now - this.lastSampleAt) / 1000;
    this.lastSampleAt = now;
    if (bearing !== null) {
      const ease = Math.min(1, HEADING_EASE_PER_SECOND * dt);
      this.heading = normalize(this.heading + shortestTurn(this.heading, bearing) * (dt === 0 ? 1 : ease));
    }
    const stale = this.lastArrival !== null && now - this.lastArrival > STALE_AFTER_MS;
    return { lat, lng, heading: this.heading, stale };
  }

  private positionAt(t: number): { lat: number; lng: number; bearing: number | null } {
    const b = this.buffer;
    const first = b[0]!;
    const second = b[1];
    if (second === undefined || t <= first.t) {
      return { lat: first.lat, lng: first.lng, bearing: second ? bearingDegrees(first, second) : null };
    }
    const lastPoint = b[b.length - 1]!;
    if (t >= lastPoint.t) {
      // Ran out of points: hold the newest position rather than extrapolating.
      return { lat: lastPoint.lat, lng: lastPoint.lng, bearing: bearingDegrees(b[b.length - 2]!, lastPoint) };
    }
    for (let i = 1; i < b.length; i += 1) {
      const a = b[i - 1]!;
      const c = b[i]!;
      if (t <= c.t) {
        const f = (t - a.t) / (c.t - a.t);
        return {
          lat: a.lat + (c.lat - a.lat) * f,
          lng: a.lng + (c.lng - a.lng) * f,
          bearing: bearingDegrees(a, c),
        };
      }
    }
    return { lat: lastPoint.lat, lng: lastPoint.lng, bearing: null };
  }
}
/** Signed degrees to turn from `from` to `to` the short way, in (-180, 180]. */
export function shortestTurn(from: number, to: number): number {
  const d = ((to - from) % 360 + 540) % 360 - 180;
  return d === -180 ? 180 : d;
}

function normalize(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLng = (b.lng - a.lng) * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function bearingDegrees(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = Math.PI / 180;
  const y = Math.sin((b.lng - a.lng) * toRad) * Math.cos(b.lat * toRad);
  const x =
    Math.cos(a.lat * toRad) * Math.sin(b.lat * toRad) -
    Math.sin(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.cos((b.lng - a.lng) * toRad);
  return normalize(Math.atan2(y, x) / toRad);
}

/** What {@link createSmoothMarker} needs from the map; Leaflet satisfies it with a thin adapter. */
export interface MarkerTarget {
  setPosition(lat: number, lng: number, heading: number, stale: boolean): void;
  /** True if the point is inside the inner part of the view (not near the edge). */
  isWellInView(lat: number, lng: number): boolean;
  panTo(lat: number, lng: number): void;
}

export interface SmoothMarker {
  push(point: TrackPoint): void;
  stop(): void;
}

/** Runs a {@link SmoothTrack} on `requestAnimationFrame` and drives the marker. */
export function createSmoothMarker(
  target: MarkerTarget,
  clock: { now(): number; raf(cb: () => void): number; cancel(id: number): void } = {
    now: () => Date.now(),
    raf: (cb) => requestAnimationFrame(cb),
    cancel: (id) => cancelAnimationFrame(id),
  },
): SmoothMarker {
  const track = new SmoothTrack();
  let frame: number | null = null;
  let stopped = false;

  const loop = () => {
    if (stopped) {
      return;
    }
    const s = track.sample(clock.now());
    if (s) {
      target.setPosition(s.lat, s.lng, s.heading, s.stale);
      // Pan only when the car nears the edge, not on every frame.
      if (!target.isWellInView(s.lat, s.lng)) {
        target.panTo(s.lat, s.lng);
      }
    }
    frame = clock.raf(loop);
  };
  frame = clock.raf(loop);

  return {
    push(point) {
      track.push(point, clock.now());
    },
    stop() {
      stopped = true;
      if (frame !== null) {
        clock.cancel(frame);
      }
    },
  };
}
