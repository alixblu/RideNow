/**
 * VehicleDetailView.property.test.tsx — Property 8: Vehicle rendering is complete.
 *
 * Feature: ridenow-frontend, Property 8: Vehicle rendering is complete.
 * Validates: Requirements 6.4, 6.5.
 *
 * VehicleDetailView is a pure presentational component taking a single
 * `VehicleResponse` and rendering every contract field: id, driverId, plate number,
 * Vehicle_Type, the nullable brand/model/color (shown as "—" when null), the active
 * state as Yes/No, and the ISO-8601 timestamps (Req 6.5). The vehicle list reuses the
 * same fields (Req 6.4), so a complete single-vehicle render establishes that no
 * contract field is dropped.
 *
 * The property: for ANY well-formed `VehicleResponse`, rendering the detail view must
 * display the plate number, the vehicle type, each of brand/model/color (the literal
 * value when present, "—" when null), and the active state as "Yes"/"No". Each must be
 * present in the rendered DOM.
 *
 * To keep assertions unambiguous across random inputs, generated field values use a
 * per-field prefix so, e.g., a random brand can never coincide with the plate number or
 * the "—" placeholder. Null is modeled explicitly for the three nullable fields so both
 * the value path and the "—" path are exercised. A minimal check also confirms the list
 * row (VehiclesScreen reuses the same fields) is not needed here — the detail view is
 * the core requirement — but we additionally assert id/driverId/timestamps render so the
 * "complete" claim is exercised end to end.
 */
import { cleanup, render, within } from "@testing-library/react";
import type { BoundFunctions, queries } from "@testing-library/react";
import { afterEach, describe, it, expect } from "vitest";
import fc from "fast-check";

import { VehicleDetailView } from "./VehicleDetailView";
import type { VehicleResponse } from "../../domain/vehicle";
import { VEHICLE_TYPE_VALUES } from "../../shared/enums";

afterEach(() => {
  cleanup();
});

/**
 * Non-empty string generator, prefixed so each field's value is unique and never "—".
 *
 * Testing Library normalizes DOM text (collapses and trims surrounding whitespace)
 * before matching, so a generated value may not round-trip through `getByText` if it
 * leans on leading/trailing/repeated whitespace. We therefore restrict the random body
 * to non-whitespace printable ASCII — this stays a faithful arbitrary string field while
 * keeping the rendered text matchable verbatim.
 */
function prefixedNonEmpty(prefix: string): fc.Arbitrary<string> {
  return fc
    .string({ minLength: 1, maxLength: 12 })
    .map((s) => prefix + s.replace(/[^\x21-\x7e]/g, "a"));
}

/** A nullable descriptive field: either an explicit null or a prefixed non-empty value. */
function nullableField(prefix: string): fc.Arbitrary<string | null> {
  return fc.option(prefixedNonEmpty(prefix), { nil: null });
}

/** ISO-8601 timestamp string generator (mirrors Jackson's `Instant` serialization). */
const isoTimestamp: fc.Arbitrary<string> = fc
  .date({ min: new Date("2000-01-01T00:00:00.000Z"), max: new Date("2100-01-01T00:00:00.000Z") })
  .map((d) => d.toISOString());

const vehicleResponseArb: fc.Arbitrary<VehicleResponse> = fc.record({
  id: prefixedNonEmpty("id-"),
  driverId: prefixedNonEmpty("drv-"),
  plateNumber: prefixedNonEmpty("plate-"),
  vehicleType: fc.constantFrom(...VEHICLE_TYPE_VALUES),
  brand: nullableField("brand-"),
  model: nullableField("model-"),
  color: nullableField("color-"),
  active: fc.boolean(),
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp,
});

/** Expected rendered text for a nullable field: the value, or "—" when null. */
function expectedNullable(value: string | null): string {
  return value === null || value === "" ? "—" : value;
}

/**
 * Assert the given text appears at least once in the view. `getAllByText` throws when
 * there are zero matches, so a non-empty result proves the text is present — this stays
 * robust even when several fields render the same text (e.g. two null fields both show
 * "—", or identical timestamps) where the single-match `getByText` would throw.
 */
function expectPresent(view: BoundFunctions<typeof queries>, text: string): void {
  expect(view.getAllByText(text).length).toBeGreaterThan(0);
}

describe("Feature: ridenow-frontend, Property 8: Vehicle rendering is complete", () => {
  it("renders every VehicleResponse field (plate, type, brand/model/color or —, active Yes/No)", () => {
    fc.assert(
      fc.property(vehicleResponseArb, (vehicle) => {
        const { container } = render(<VehicleDetailView vehicle={vehicle} />);
        const view = within(container);

        // Core identifiers and plate number (Req 6.5).
        expectPresent(view, vehicle.id);
        expectPresent(view, vehicle.driverId);
        expectPresent(view, vehicle.plateNumber);

        // Vehicle_Type (restricted enum) is displayed (Req 6.4, 6.5).
        expectPresent(view, vehicle.vehicleType);

        // Nullable descriptive fields: literal value when present, "—" when null.
        expectPresent(view, expectedNullable(vehicle.brand));
        expectPresent(view, expectedNullable(vehicle.model));
        expectPresent(view, expectedNullable(vehicle.color));

        // Active state rendered as Yes/No (Req 6.4, 6.5).
        expectPresent(view, vehicle.active ? "Yes" : "No");

        // Timestamps round out the "complete" contract render.
        expectPresent(view, vehicle.createdAt);
        expectPresent(view, vehicle.updatedAt);

        cleanup();
      }),
      { numRuns: 40 },
    );
  });
});
