// Feature: production-grade-frontend, Property 8: Estimate display completeness
// **Validates: Requirements 4.3**
import { describe, it, expect, afterEach } from "vitest";
import fc from "fast-check";
import { cleanup, render, within } from "@testing-library/react";
import { QuoteList } from "./HomeScreen";
import { estimateFare } from "../../domain/fare/estimateFare";
import { formatDistance, formatDuration, formatVnd } from "../../shared/format";
import type { VehicleType } from "../../shared/enums";

const TYPES: VehicleType[] = ["MOTORBIKE", "CAR"];
const LABEL: Record<VehicleType, string> = { MOTORBIKE: "Motorbike", CAR: "Car" };

const latArb = fc.double({ min: 8.5, max: 23.4, noNaN: true });
const lngArb = fc.double({ min: 102.1, max: 109.5, noNaN: true });

describe("Property 8: Estimate display completeness", () => {
  afterEach(cleanup);

  it("renders one entry per vehicle type with its formatted price, duration and distance", () => {
    fc.assert(
      fc.property(latArb, lngArb, latArb, lngArb, fc.constantFrom(...TYPES), (pLat, pLng, dLat, dLng, selected) => {
        const req = { pickupLat: pLat, pickupLng: pLng, destinationLat: dLat, destinationLng: dLng };
        const estimates = TYPES.map((t) => estimateFare(req, t));
        const { getByRole, unmount } = render(<QuoteList estimates={estimates} selected={selected} onSelect={() => {}} />);

        const items = within(getByRole("list", { name: "Fare quotes" })).getAllByRole("listitem");
        expect(items).toHaveLength(TYPES.length);

        estimates.forEach((estimate, i) => {
          const text = items[i]?.textContent ?? "";
          expect(text).toContain(LABEL[estimate.vehicleType]);
          expect(text).toContain(formatVnd(estimate.amount));
          expect(text).toContain(formatDuration(estimate.durationMin));
          expect(text).toContain(formatDistance(estimate.distanceKm));
        });
        unmount();
      }),
      { numRuns: 100 },
    );
  });
});
