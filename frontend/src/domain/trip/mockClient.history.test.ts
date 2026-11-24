// Feature: production-grade-frontend, Property 11: Seeded history shape
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { createTripMockClient } from "./mockClient";
import { mockProfiles } from "../seed/people";

const DAY_MS = 24 * 60 * 60 * 1000;

const seededUsers = [
  ...mockProfiles.rider.map((p) => ({ role: "rider" as const, userId: p.userId })),
  ...mockProfiles.driver.map((p) => ({ role: "driver" as const, userId: p.userId })),
];

describe("Property 11: Seeded history shape", () => {
  /** **Validates: Requirements 7.3** */
  it("every seeded rider and driver has >= 10 entries, both COMPLETED and CANCELLED, spanning >= 30 days", async () => {
    const client = createTripMockClient();
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...seededUsers), async (user) => {
        const history = await client.listTripHistory(user);
        expect(history.length).toBeGreaterThanOrEqual(10);

        const statuses = history.map((h) => h.trip.status);
        expect(statuses).toContain("COMPLETED");
        expect(statuses).toContain("CANCELLED");

        const times = history.map((h) => new Date(h.trip.requestedAt).getTime());
        expect(Math.max(...times) - Math.min(...times)).toBeGreaterThanOrEqual(30 * DAY_MS);
      }),
      { numRuns: 100 },
    );
  });
});
