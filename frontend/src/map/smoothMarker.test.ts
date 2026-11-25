import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  MAX_GLIDE_MS,
  createGlideMarker,
  glideDuration,
  JUMP_METERS,
  RENDER_DELAY_MS,
  STALE_AFTER_MS,
  SmoothTrack,
  createSmoothMarker,
  distanceMeters,
  shortestTurn,
} from "./smoothMarker";

// ~11 m per 0.0001 degree of latitude.
const P0 = { lat: 10.0, lng: 106.0 };
const P1 = { lat: 10.0001, lng: 106.0 };
const P2 = { lat: 10.0002, lng: 106.0 };

/** The remote clock runs 5s ahead of ours: the track must not care. */
const SKEW = 5000;

describe("shortestTurn", () => {
  it("turns the short way round", () => {
    expect(shortestTurn(350, 10)).toBe(20);
    expect(shortestTurn(10, 350)).toBe(-20);
    expect(shortestTurn(0, 180)).toBe(180);
    expect(shortestTurn(90, 90)).toBe(0);
  });
});

describe("SmoothTrack", () => {
  it("renders ~1s behind and interpolates between the surrounding points", () => {
    const track = new SmoothTrack();
    track.push({ ...P0, recordedAt: 1_000 + SKEW }, 1_000);
    track.push({ ...P1, recordedAt: 2_000 + SKEW }, 2_000);

    // At local 2500 the render time is 1500 (remote 6500): halfway between P0 and P1.
    const s = track.sample(2_000 + RENDER_DELAY_MS / 2)!;
    expect(s.lat).toBeCloseTo(10.00005, 7);
    expect(s.lng).toBeCloseTo(106.0, 7);
    expect(s.stale).toBe(false);
  });

  it("holds the newest point instead of extrapolating past it", () => {
    const track = new SmoothTrack();
    track.push({ ...P0, recordedAt: 1_000 }, 1_000);
    track.push({ ...P1, recordedAt: 2_000 }, 2_000);

    const s = track.sample(9_000)!;
    expect(s.lat).toBeCloseTo(P1.lat, 7);
  });

  it("drops out-of-order and repeated points", () => {
    const track = new SmoothTrack();
    expect(track.push({ ...P0, recordedAt: 2_000 }, 2_000)).toBe(true);
    expect(track.push({ ...P1, recordedAt: 1_000 }, 2_100)).toBe(false);
    expect(track.push({ ...P1, recordedAt: 2_000 }, 2_200)).toBe(false);
    expect(track.push({ ...P1, recordedAt: 3_000 }, 3_000)).toBe(true);
  });

  it("jumps straight to a point more than 500 m away", () => {
    const far = { lat: 10.01, lng: 106.0 }; // ~1.1 km north
    expect(distanceMeters(P0, far)).toBeGreaterThan(JUMP_METERS);
    const track = new SmoothTrack();
    track.push({ ...P0, recordedAt: 1_000 }, 1_000);
    track.push({ ...far, recordedAt: 2_000 }, 2_000);

    // Even at a render time between the two, the marker is already at the far point.
    const s = track.sample(2_500)!;
    expect(s.lat).toBeCloseTo(far.lat, 7);
  });

  it("is stale after 10s without a point (by arrival time)", () => {
    const track = new SmoothTrack();
    track.push({ ...P0, recordedAt: 1_000 + SKEW }, 1_000);

    expect(track.sample(1_000 + STALE_AFTER_MS - 1)!.stale).toBe(false);
    expect(track.sample(1_000 + STALE_AFTER_MS + 1)!.stale).toBe(true);
  });

  it("eases the heading toward the travel direction", () => {
    const track = new SmoothTrack();
    // East, east, then a turn north.
    track.push({ lat: 10, lng: 106.0, recordedAt: 1_000 }, 1_000);
    track.push({ lat: 10, lng: 106.0001, recordedAt: 2_000 }, 2_000);
    track.push({ lat: 10, lng: 106.0002, recordedAt: 3_000 }, 3_000);
    track.push({ lat: 10.0001, lng: 106.0002, recordedAt: 4_000 }, 4_000);

    // Render time 2500 and 2990: on the eastbound segment.
    expect(track.sample(3_500)!.heading).toBeCloseTo(90, 0);
    expect(track.sample(3_990)!.heading).toBeCloseTo(90, 0);

    // 26 ms later the render time is on the northbound segment: the heading has
    // started to turn toward 0, but not all the way.
    const partway = track.sample(4_016)!.heading;
    expect(partway).toBeLessThan(90);
    expect(partway).toBeGreaterThan(45);

    // Given time, it settles on north, turning the short way (never through 180).
    let h = partway;
    for (let now = 4_032; now <= 6_000; now += 16) {
      h = track.sample(now)!.heading;
      expect(h).toBeLessThanOrEqual(90);
    }
    expect(h).toBeCloseTo(0, 0);
  });
  it("returns null before the first point", () => {
    expect(new SmoothTrack().sample(1_000)).toBeNull();
  });
});

describe("createSmoothMarker", () => {
  it("draws on animation frames and pans only when the car leaves the inner view", () => {
    let now = 0;
    const frames: (() => void)[] = [];
    const clock = {
      now: () => now,
      raf: (cb: () => void) => frames.push(cb),
      cancel: () => {},
    };
    const positions: number[] = [];
    let pans = 0;
    let inView = true;
    const marker = createSmoothMarker(
      {
        setPosition: (lat) => positions.push(lat),
        isWellInView: () => inView,
        panTo: () => {
          pans += 1;
        },
      },
      clock,
    );
    const step = (ms: number) => {
      now += ms;
      frames.shift()?.();
    };

    marker.push({ ...P0, recordedAt: 0 });
    now = 1_000;
    marker.push({ ...P1, recordedAt: 1_000 });
    now = 2_000;
    marker.push({ ...P2, recordedAt: 2_000 });

    step(0);
    step(500);
    expect(positions.length).toBe(2);
    expect(positions[1]!).toBeGreaterThan(positions[0]!);
    expect(pans).toBe(0);

    inView = false;
    step(16);
    expect(pans).toBe(1);

    marker.stop();
    step(16);
    expect(positions.length).toBe(3);
  });
});

// **Validates: Requirements 7.12**
describe("glide duration cap", () => {
  it("equals min(gap, 1500 ms) for every gap", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 600_000 }), (gap) => {
        const d = glideDuration(gap);
        expect(d).toBe(Math.min(gap, MAX_GLIDE_MS));
        expect(d).toBeLessThanOrEqual(1500);
      }),
      { numRuns: 100 },
    );
  });

  it("a marker never takes longer than 1500 ms to reach a new event", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 60_000 }), (gap) => {
        let now = 0;
        const frames: (() => void)[] = [];
        const lats: number[] = [];
        const marker = createGlideMarker(
          { setPosition: (lat) => lats.push(lat), isWellInView: () => true, panTo: () => {} },
          {
            reducedMotion: () => false,
            clock: { now: () => now, raf: (cb) => frames.push(cb), cancel: () => {} },
          },
        );
        marker.push({ ...P0, recordedAt: 0 });
        now = gap;
        marker.push({ ...P1, recordedAt: gap });
        now = gap + MAX_GLIDE_MS;
        while (frames.length > 0) frames.shift()!();
        expect(lats[lats.length - 1]).toBeCloseTo(P1.lat, 9);
        marker.stop();
      }),
      { numRuns: 100 },
    );
  });
});
