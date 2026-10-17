/**
 * Property test for Property 5: Missing required fields block submission
 * (driver and vehicle forms). Task 11.4.
 *
 * Tag: Feature: ridenow-frontend, Property 5: Missing required fields block submission
 *
 * Validates: Requirements 5.2, 6.2, 8.2.
 *
 * Property 5 (as it applies to the driver create forms): for ANY create form where at
 * least one required field is omitted or blank, submission is prevented — a field-level
 * validation message (role="alert") is shown for each missing field, and NO backend
 * request is issued.
 *
 * Two targets, both of which take a `client: DriverServiceClient` prop and perform
 * client-side required-field validation before issuing a request:
 *
 *   - CreateDriverScreen: required fields are `userId` (id=create-driver-userId) and
 *     `licenseNumber` (id=create-driver-license). We generate every combination where at
 *     least one is blank — blank modeled as "" or whitespace, which the component treats
 *     as missing via `.trim()` — fill the inputs, submit, and assert `createDriver` was
 *     never called and a role="alert" message is shown per missing field (Req 5.2, 8.2).
 *
 *   - VehiclesScreen: the add-vehicle form only appears after a driver id is set, so we
 *     first type a driver id (id=vehicles-driver-id) and click "Use driver". Its required
 *     fields are `plateNumber` (id=add-vehicle-plate) and `vehicleType`
 *     (id=add-vehicle-type, a select whose empty "" option means "not chosen"). We
 *     generate every combination with at least one missing, submit, and assert
 *     `addVehicle` was never called and a role="alert" message is shown per missing field
 *     (Req 6.2).
 *
 * A fully-stubbed DriverServiceClient whose methods are vi.fn() records every call, so
 * "no backend request issued" is verified by asserting the relevant spy was never
 * invoked. No real fetch is involved. Each case renders under a fresh QueryClient,
 * `cleanup()` runs between cases, and the spies are reset each run so cases stay isolated.
 */
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, it, expect, vi } from "vitest";
import type { ReactElement } from "react";
import fc from "fast-check";
import type { DriverResponse, DriverServiceClient } from "../../domain/driver";
import type { VehicleResponse } from "../../domain/vehicle";
import { CreateDriverScreen } from "./CreateDriverScreen";
import { VehiclesScreen } from "./VehiclesScreen";

// ---------------------------------------------------------------------------
// Spy client: every operation is a vi.fn() so calls are recorded. The mutating
// operations resolve to a never-settling promise because a correctly-validating
// form must NEVER call them in these cases; if one is called the test fails on the
// "not called" assertion long before the promise would matter.
// ---------------------------------------------------------------------------
function makeSpyClient(): DriverServiceClient {
  return {
    createDriver: vi.fn((): Promise<DriverResponse> => new Promise(() => {})),
    getDriver: vi.fn((): Promise<DriverResponse> => new Promise(() => {})),
    addVehicle: vi.fn((): Promise<VehicleResponse> => new Promise(() => {})),
    listVehicles: vi.fn((): Promise<VehicleResponse[]> => Promise.resolve([])),
    changeStatus: vi.fn((): Promise<DriverResponse> => new Promise(() => {})),
    getVehicle: vi.fn((): Promise<VehicleResponse> => new Promise(() => {})),
  };
}

/** Render a screen under a fresh QueryClient (retries off keeps behavior deterministic). */
function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

// A value that is "present" for a required field: non-empty AND non-whitespace, so the
// component's `.trim() === ""` check treats it as supplied.
const filledArb = fc
  .string({ minLength: 1 })
  .map((s) => `x${s}`) // guarantee at least one non-whitespace char
  .filter((s) => s.trim().length > 0);

// A value that is "blank" for a required field: the empty string or pure whitespace,
// both of which the component treats as missing.
const blankArb = fc.constantFrom("", " ", "   ", "\t", "\n  ");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Feature: ridenow-frontend, Property 5: Missing required fields block submission", () => {
  // -------------------------------------------------------------------------
  // CreateDriverScreen — required: userId, licenseNumber (Req 5.2, 8.2).
  // -------------------------------------------------------------------------
  it("blocks create-driver submission and shows an error per missing field (Req 5.2, 8.2)", () => {
    // Pick which of the two fields are blank; keep only cases with >= 1 blank field.
    const caseArb = fc
      .record({
        userIdBlank: fc.boolean(),
        licenseBlank: fc.boolean(),
        userIdFilled: filledArb,
        licenseFilled: filledArb,
        userIdBlankValue: blankArb,
        licenseBlankValue: blankArb,
      })
      .filter((c) => c.userIdBlank || c.licenseBlank);

    fc.assert(
      fc.property(caseArb, (c) => {
        cleanup();
        vi.clearAllMocks();

        const client = makeSpyClient();
        const { container } = renderWithClient(
          <CreateDriverScreen client={client} />,
        );

        const userIdInput = container.querySelector("#create-driver-userId");
        const licenseInput = container.querySelector("#create-driver-license");
        if (!(userIdInput instanceof HTMLInputElement)) {
          throw new Error("userId input not found");
        }
        if (!(licenseInput instanceof HTMLInputElement)) {
          throw new Error("license input not found");
        }

        const userIdValue = c.userIdBlank ? c.userIdBlankValue : c.userIdFilled;
        const licenseValue = c.licenseBlank ? c.licenseBlankValue : c.licenseFilled;

        fireEvent.change(userIdInput, { target: { value: userIdValue } });
        fireEvent.change(licenseInput, { target: { value: licenseValue } });

        // Submit the form (the submit button lives inside the create-driver form).
        const form = userIdInput.closest("form");
        if (!(form instanceof HTMLFormElement)) {
          throw new Error("create-driver form not found");
        }
        fireEvent.submit(form);

        // No backend request was issued.
        expect(client.createDriver).not.toHaveBeenCalled();

        // A field-level error (role="alert") is shown for each missing field.
        const alerts = within(container).queryAllByRole("alert");
        const alertText = alerts.map((a) => a.textContent ?? "").join(" | ");
        const expectedMissing =
          Number(c.userIdBlank) + Number(c.licenseBlank);
        expect(alerts.length).toBe(expectedMissing);
        if (c.userIdBlank) {
          expect(alertText).toContain("User ID is required.");
        }
        if (c.licenseBlank) {
          expect(alertText).toContain("License number is required.");
        }
      }),
      { numRuns: 30 },
    );
  });

  // -------------------------------------------------------------------------
  // VehiclesScreen add-vehicle form — required: plateNumber, vehicleType (Req 6.2).
  // The form only renders after a driver id is set.
  // -------------------------------------------------------------------------
  it("blocks add-vehicle submission and shows an error per missing field (Req 6.2)", () => {
    const caseArb = fc
      .record({
        plateBlank: fc.boolean(),
        typeMissing: fc.boolean(),
        plateFilled: filledArb,
        plateBlankValue: blankArb,
      })
      .filter((c) => c.plateBlank || c.typeMissing);

    fc.assert(
      fc.property(caseArb, (c) => {
        cleanup();
        vi.clearAllMocks();

        const client = makeSpyClient();
        const { container } = renderWithClient(<VehiclesScreen client={client} />);

        // Set a driver id so the add-vehicle form appears.
        const driverIdInput = container.querySelector("#vehicles-driver-id");
        if (!(driverIdInput instanceof HTMLInputElement)) {
          throw new Error("driver id input not found");
        }
        fireEvent.change(driverIdInput, { target: { value: "driver-1" } });
        const driverForm = driverIdInput.closest("form");
        if (!(driverForm instanceof HTMLFormElement)) {
          throw new Error("driver-id form not found");
        }
        fireEvent.submit(driverForm);

        // The add-vehicle fields are now present.
        const plateInput = container.querySelector("#add-vehicle-plate");
        const typeSelect = container.querySelector("#add-vehicle-type");
        if (!(plateInput instanceof HTMLInputElement)) {
          throw new Error("plate input not found");
        }
        if (!(typeSelect instanceof HTMLSelectElement)) {
          throw new Error("vehicle type select not found");
        }

        // Plate: blank or a valid value. Type: leave on "" (missing) or pick CAR.
        const plateValue = c.plateBlank ? c.plateBlankValue : c.plateFilled;
        fireEvent.change(plateInput, { target: { value: plateValue } });
        if (!c.typeMissing) {
          fireEvent.change(typeSelect, { target: { value: "CAR" } });
        }

        // Submit the add-vehicle form.
        const addForm = plateInput.closest("form");
        if (!(addForm instanceof HTMLFormElement)) {
          throw new Error("add-vehicle form not found");
        }
        fireEvent.submit(addForm);

        // No backend request was issued.
        expect(client.addVehicle).not.toHaveBeenCalled();

        // A field-level error (role="alert") is shown for each missing field. Scope the
        // search to the add-vehicle form so the driver-id/lookup forms don't interfere.
        const alerts = within(addForm).queryAllByRole("alert");
        const alertText = alerts.map((a) => a.textContent ?? "").join(" | ");
        const expectedMissing = Number(c.plateBlank) + Number(c.typeMissing);
        expect(alerts.length).toBe(expectedMissing);
        if (c.plateBlank) {
          expect(alertText).toContain("Plate number is required.");
        }
        if (c.typeMissing) {
          expect(alertText).toContain("Vehicle type is required.");
        }
      }),
      { numRuns: 30 },
    );
  });
});
