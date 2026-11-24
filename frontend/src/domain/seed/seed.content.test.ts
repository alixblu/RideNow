import { afterEach, describe, expect, it, vi } from "vitest";
import { createAdminLiveClient } from "../admin/liveClient";
import { createDriverLiveClient } from "../driver/liveClient";
import { createTripLiveClient } from "../trip/liveClient";
import { generateAdminRows } from "./adminRows";
import { mockProfiles } from "./people";
import { PRESET_LOCATIONS } from "./places";
import { generateSeedHistory } from "./history";
import { SEED_NOW } from "./people";

// Requirements 7.4, 7.5, 7.6, 7.10

const VN = { latMin: 8.0, latMax: 23.5, lngMin: 102.0, lngMax: 110.0 };
const inVietnam = (lat: number, lng: number) =>
  lat >= VN.latMin && lat <= VN.latMax && lng >= VN.lngMin && lng <= VN.lngMax;

describe("live clients delegate new methods without fetch", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("trip, driver and admin new methods never call fetch", async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error("fetch must not be called")));
    vi.stubGlobal("fetch", fetchSpy);

    const trip = createTripLiveClient();
    const driver = createDriverLiveClient();
    const admin = createAdminLiveClient();
    const rider = mockProfiles.rider[0]!;
    const drv = mockProfiles.driver[0]!;

    const fares = await trip.estimateFares({
      pickupLat: 10.7725,
      pickupLng: 106.698,
      destinationLat: 10.8188,
      destinationLng: 106.6519,
    });
    expect(fares.length).toBeGreaterThan(0);

    const history = await trip.listTripHistory({ role: "rider", userId: rider.userId });
    expect(history.length).toBeGreaterThan(0);

    await trip.rateTrip(history[0]!.trip.id, 5);
    await trip.getEarnings(drv.userId);
    await driver.getDriverRating(drv.userId);

    await admin.getOverview();
    await admin.listTripRows();
    await admin.listDriverRows();
    await admin.listRiderRows();
    await admin.listPaymentRows();

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("seed content", () => {
  it("has at least 3 profiles per role", () => {
    for (const role of ["rider", "driver", "admin"] as const) {
      expect(mockProfiles[role].length).toBeGreaterThanOrEqual(3);
      for (const p of mockProfiles[role]) expect(p.role).toBe(role);
    }
  });

  it("has at least 25 admin rows per table", () => {
    const rows = generateAdminRows();
    expect(rows.trips.length).toBeGreaterThanOrEqual(25);
    expect(rows.drivers.length).toBeGreaterThanOrEqual(25);
    expect(rows.riders.length).toBeGreaterThanOrEqual(25);
    expect(rows.payments.length).toBeGreaterThanOrEqual(25);
  });

  it("keeps preset locations within Vietnam bounds", () => {
    expect(PRESET_LOCATIONS.length).toBeGreaterThan(0);
    for (const p of PRESET_LOCATIONS) expect(inVietnam(p.lat, p.lng)).toBe(true);
  });

  it("keeps seeded trip coordinates within Vietnam bounds", () => {
    const history = generateSeedHistory();
    const all = Object.values(history.rider).flat();
    expect(all.length).toBeGreaterThan(0);
    for (const e of all) {
      expect(inVietnam(e.trip.pickupLat, e.trip.pickupLng)).toBe(true);
      expect(inVietnam(e.trip.destinationLat, e.trip.destinationLng)).toBe(true);
    }
    expect(SEED_NOW.getTime()).toBeGreaterThan(0);
  });
});
