import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { createMatchingMockClient } from "./mockClient";

/**
 * Property 17: Resolved match yields an assigned driver and DRIVER_ASSIGNED.
 *
 * Validates: Requirements 10.2.
 *
 * The matching Mock_Client models resolution via a per-tripId call count: the
 * first read of a trip's match state is still SEARCHING with no assigned driver,
 * and every subsequent read resolves to DRIVER_ASSIGNED with a populated
 * assigned-driver summary. This property checks that once matching resolves the
 * result's status is exactly DRIVER_ASSIGNED, its assignedDriver is non-null, and
 * that driver carries non-empty driverId, vehicleId, and summary. It also asserts
 * the key invariant for both observations: whenever status === "DRIVER_ASSIGNED",
 * assignedDriver is non-null.
 *
 * Tag: Feature: ridenow-frontend, Property 17: Resolved match yields an assigned driver and DRIVER_ASSIGNED
 */

// A tripId is any non-empty string.
const tripIdArb: fc.Arbitrary<string> = fc.string({ minLength: 1 });

describe("Feature: ridenow-frontend, Property 17: Resolved match yields an assigned driver and DRIVER_ASSIGNED", () => {
  it("once matching resolves, status is DRIVER_ASSIGNED with a fully populated assigned driver", async () => {
    await fc.assert(
      fc.asyncProperty(tripIdArb, async (tripId) => {
        // Fresh client per run so the per-tripId call count starts clean.
        const client = createMatchingMockClient();

        // First call: matching still in progress — SEARCHING with no driver.
        const first = await client.getMatchState(tripId);
        expect(first.tripId).toBe(tripId);
        expect(first.status).toBe("SEARCHING");
        expect(first.assignedDriver).toBeNull();

        // The invariant must already hold on the first observation.
        if (first.status === "DRIVER_ASSIGNED") {
          expect(first.assignedDriver).not.toBeNull();
        }

        // Subsequent call: matching has resolved.
        const resolved = await client.getMatchState(tripId);
        expect(resolved.tripId).toBe(tripId);
        expect(resolved.status).toBe("DRIVER_ASSIGNED");

        // DRIVER_ASSIGNED implies a non-null, fully populated assigned driver.
        expect(resolved.assignedDriver).not.toBeNull();
        const driver = resolved.assignedDriver!;
        expect(driver.driverId.length).toBeGreaterThan(0);
        expect(driver.vehicleId.length).toBeGreaterThan(0);
        expect(driver.summary.length).toBeGreaterThan(0);

        // Key invariant restated explicitly for the resolved observation.
        if (resolved.status === "DRIVER_ASSIGNED") {
          expect(resolved.assignedDriver).not.toBeNull();
        }
      }),
      { numRuns: 100 },
    );
  });
});
