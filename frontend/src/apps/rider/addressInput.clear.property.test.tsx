// Feature: frontend-booking-and-password-login, Property 15: Editing an Address_Input's text after a selection clears its bound Place
// **Validates: Requirements 5.10**
import { useState } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import fc from "fast-check";
import { AddressInput } from "./AddressInput";
import type { Geocoder, Place } from "../../geocoding/contract";

const geocoder: Geocoder = {
  search: () => Promise.resolve([]),
  reverse: () => Promise.resolve(null),
};

afterEach(cleanup);

const placeArb = fc.record({
  address: fc.string({ minLength: 1, maxLength: 40 }),
  lat: fc.double({ min: -80, max: 80, noNaN: true }),
  lng: fc.double({ min: -180, max: 180, noNaN: true }),
});

describe("Property 15: editing text clears the bound Place", () => {
  it("calls onChange(null) on the first edit and stays null until a new selection", () => {
    fc.assert(
      fc.property(
        placeArb,
        fc.array(fc.string({ maxLength: 40 }), { minLength: 1, maxLength: 4 }),
        (place: Place, edits) => {
          const onChange = vi.fn();
          let bound: Place | null = null;
          function Harness() {
            const [value, setValue] = useState<Place | null>(place);
            bound = value;
            return (
              <AddressInput
                id="addr"
                label="Pickup"
                value={value}
                geocoder={geocoder}
                onChange={(p) => {
                  onChange(p);
                  setValue(p);
                }}
              />
            );
          }
          const { unmount } = render(<Harness />);
          const input = screen.getByRole("combobox") as HTMLInputElement;
          expect(input.value).toBe(place.address);

          // Edits are chained; each differs from the previous input text.
          let current = place.address;
          let changed = 0;
          for (const text of edits) {
            if (text === current) continue;
            fireEvent.change(input, { target: { value: text } });
            current = text;
            changed++;
          }
          if (changed > 0) {
            expect(onChange).toHaveBeenCalledTimes(1);
            expect(onChange).toHaveBeenCalledWith(null);
            expect(bound).toBeNull();
          } else {
            expect(onChange).not.toHaveBeenCalled();
          }
          unmount();
        },
      ),
      { numRuns: 100 },
    );
  });
});
