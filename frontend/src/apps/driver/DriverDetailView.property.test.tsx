/**
 * Property test for Property 7: Driver detail renders all contract fields (Req 5.3).
 *
 * Tag: Feature: ridenow-frontend, Property 7: Driver detail renders all contract fields
 *
 * Validates: Requirements 5.3.
 *
 * For ANY `DriverResponse`, rendering the presentational `<DriverDetailView>` must
 * surface every contract field in the DOM: id, userId, licenseNumber, status,
 * averageRating (with `null` displayed as the em-dash placeholder "—"), totalTrips,
 * createdAt, and updatedAt.
 *
 * We generate a wide space of driver objects (non-empty string ids/license, a status
 * drawn from the allowed Driver_Status values, a number-or-null averageRating, a
 * non-negative integer totalTrips, and ISO-8601 timestamp strings), render the view
 * with a no-op status handler, and assert each field's rendered value is present in
 * the container's text content. Using `container.textContent` keeps the assertion
 * robust even when two generated field values happen to coincide. `cleanup()` runs
 * between cases so each render is isolated.
 */
import { render, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import fc from "fast-check";
import { DriverDetailView } from "./DriverDetailView";
import { DRIVER_STATUS_VALUES } from "../../shared/enums";
import type { DriverResponse } from "../../domain/driver";

// A non-empty string for ids and the license number.
const nonEmptyString = fc.string({ minLength: 1 }).filter((s) => s.length > 0);

// ISO-8601 timestamp string, matching how Jackson serializes `Instant`.
const isoString = fc
  .date({ min: new Date("2000-01-01T00:00:00.000Z"), max: new Date("2100-01-01T00:00:00.000Z") })
  .map((d) => d.toISOString());

const driverArb: fc.Arbitrary<DriverResponse> = fc.record({
  id: nonEmptyString,
  userId: nonEmptyString,
  licenseNumber: nonEmptyString,
  status: fc.constantFrom(...DRIVER_STATUS_VALUES),
  averageRating: fc.option(
    fc.double({ min: 0, max: 5, noNaN: true, noDefaultInfinity: true }),
    { nil: null },
  ),
  totalTrips: fc.nat(),
  createdAt: isoString,
  updatedAt: isoString,
});

afterEach(() => {
  cleanup();
});

describe("Feature: ridenow-frontend, Property 7: Driver detail renders all contract fields", () => {
  it("renders every DriverResponse field (null averageRating shown as '—')", () => {
    fc.assert(
      fc.property(driverArb, (driver) => {
        cleanup();
        const { container } = render(
          <DriverDetailView driver={driver} onChangeStatus={() => {}} />,
        );

        const text = container.textContent ?? "";

        // String identity + license fields.
        expect(text).toContain(driver.id);
        expect(text).toContain(driver.userId);
        expect(text).toContain(driver.licenseNumber);

        // Status (one of the allowed Driver_Status values).
        expect(text).toContain(driver.status);

        // Average rating: null is rendered as the em-dash placeholder.
        if (driver.averageRating === null) {
          expect(text).toContain("—");
        } else {
          expect(text).toContain(String(driver.averageRating));
        }

        // Numeric total trips.
        expect(text).toContain(String(driver.totalTrips));

        // ISO timestamps.
        expect(text).toContain(driver.createdAt);
        expect(text).toContain(driver.updatedAt);
      }),
      { numRuns: 40 },
    );
  });
});
