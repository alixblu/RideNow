import { describe, it, expect, vi } from "vitest";
import { NoopSnapper, OsrmSnapper, createRoadSnapper } from "./roadSnapper";

const A = { lat: 10.7769, lng: 106.7009 };
const B = { lat: 10.7626, lng: 106.6602 };

function okJson(body: unknown) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
}

describe("createRoadSnapper", () => {
  it("is a no-op without an OSRM URL", () => {
    expect(createRoadSnapper(null)).toBeInstanceOf(NoopSnapper);
    expect(createRoadSnapper("http://osrm.test")).toBeInstanceOf(OsrmSnapper);
  });
});

describe("NoopSnapper", () => {
  it("returns raw points and a straight line", async () => {
    const snapper = new NoopSnapper();
    expect(await snapper.snapTrace([A, B])).toEqual([A, B]);
    expect(await snapper.route(A, B)).toEqual([A, B]);
  });
});

describe("OsrmSnapper", () => {
  it("route calls OSRM route with lng,lat and returns the geometry as lat/lng", async () => {
    const fetchFn = vi.fn(() =>
      okJson({ code: "Ok", routes: [{ geometry: { coordinates: [[106.7, 10.77], [106.68, 10.77], [106.66, 10.76]] } }] }),
    );
    const snapper = new OsrmSnapper("http://osrm.test/", 2000, fetchFn);

    const points = await snapper.route(A, B);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const url = (fetchFn.mock.calls[0] as unknown as [string])[0];
    expect(url).toContain("http://osrm.test/route/v1/driving/106.700900,10.776900;106.660200,10.762600");
    expect(url).toContain("geometries=geojson");
    expect(points).toEqual([
      { lat: 10.77, lng: 106.7 },
      { lat: 10.77, lng: 106.68 },
      { lat: 10.76, lng: 106.66 },
    ]);
  });

  it("snapTrace calls OSRM match and joins the matchings", async () => {
    const fetchFn = vi.fn(() =>
      okJson({
        code: "Ok",
        matchings: [
          { geometry: { coordinates: [[106.70, 10.77], [106.69, 10.77]] } },
          { geometry: { coordinates: [[106.68, 10.76]] } },
        ],
      }),
    );
    const snapper = new OsrmSnapper("http://osrm.test", 2000, fetchFn);

    const snapped = await snapper.snapTrace([A, B, A]);

    expect((fetchFn.mock.calls[0] as unknown as [string])[0]).toContain("/match/v1/driving/");
    expect(snapped).toHaveLength(3);
  });

  it("falls back to raw points on an HTTP error or a non-Ok code", async () => {
    const failing = new OsrmSnapper("http://osrm.test", 2000, () =>
      Promise.resolve({ ok: false, json: () => Promise.resolve({}) }),
    );
    expect(await failing.snapTrace([A, B])).toEqual([A, B]);
    expect(await failing.route(A, B)).toEqual([A, B]);

    const noMatch = new OsrmSnapper("http://osrm.test", 2000, () => okJson({ code: "NoMatch" }));
    expect(await noMatch.snapTrace([A, B])).toEqual([A, B]);
  });

  it("falls back on a network error", async () => {
    const snapper = new OsrmSnapper("http://osrm.test", 2000, () => Promise.reject(new Error("offline")));
    expect(await snapper.route(A, B)).toEqual([A, B]);
  });

  it("falls back when OSRM does not answer within the timeout", async () => {
    vi.useFakeTimers();
    try {
      const hanging = (_url: string, init?: { signal?: AbortSignal }) =>
        new Promise<never>((_, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        });
      const snapper = new OsrmSnapper("http://osrm.test", 500, hanging);

      const pending = snapper.route(A, B);
      await vi.advanceTimersByTimeAsync(600);

      expect(await pending).toEqual([A, B]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not call OSRM for a trace shorter than two points", async () => {
    const fetchFn = vi.fn(() => okJson({}));
    const snapper = new OsrmSnapper("http://osrm.test", 2000, fetchFn);
    expect(await snapper.snapTrace([A])).toEqual([A]);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
