import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { computeOverview, createAdminMockClient } from "./mockClient";
import { generateAdminRows, type AdminRows } from "../seed/adminRows";
import { SEED_NOW } from "../seed/people";

// Feature: production-grade-frontend, Property 16: Overview aggregates match rows

/** Independent derivation of the Overview figures from the rows. */
function expected(rows: AdminRows) {
  const dayOf = (d: Date) => new Date(d.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
  const today = dayOf(SEED_NOW);
  let activeTrips = 0;
  let completedToday = 0;
  let revenueToday = 0;
  for (const t of rows.trips) {
    if (t.status !== "COMPLETED" && t.status !== "CANCELLED") activeTrips += 1;
    if (t.status === "COMPLETED" && dayOf(new Date(t.requestedAt)) === today) {
      completedToday += 1;
      revenueToday += t.fare ?? 0;
    }
  }
  let onlineDrivers = 0;
  for (const d of rows.drivers) if (d.online && d.status === "ACTIVE") onlineDrivers += 1;
  return { activeTrips, onlineDrivers, completedToday, revenueToday };
}

describe("Property 16: Overview aggregates match rows", () => {
  /**
   * **Validates: Requirements 6.2**
   */
  it("each overview value equals the count or sum computed from the rows", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 31 - 1 }), (seed) => {
        const rows = generateAdminRows(seed);
        expect(computeOverview(rows)).toEqual(expected(rows));
      }),
      { numRuns: 100 },
    );
  });

  it("the mock client overview agrees with its own row lists", async () => {
    const client = createAdminMockClient();
    const [overview, trips, drivers, riders, payments] = await Promise.all([
      client.getOverview(),
      client.listTripRows(),
      client.listDriverRows(),
      client.listRiderRows(),
      client.listPaymentRows(),
    ]);
    expect(overview).toEqual(expected({ trips, drivers, riders, payments }));
  });
});
