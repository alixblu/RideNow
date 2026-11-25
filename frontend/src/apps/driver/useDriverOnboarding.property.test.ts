// Feature: frontend-booking-and-password-login, Property 24: Onboarding never repeats a step that already succeeded
// **Validates: Requirements 9.4**
import { describe, it, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";
import fc from "fast-check";
import type { DriverResponse } from "../../domain/driver/contract";
import { useDriverOnboarding } from "./useDriverOnboarding";

describe("Property 24: Onboarding never repeats a step that already succeeded", () => {
  it("calls each step at most once after it succeeds, across any failure schedule", async () => {
    await fc.assert(
      fc.asyncProperty(
        // Each attempt decides whether each step (if it runs) fails.
        fc.array(fc.record({ createFails: fc.boolean(), vehicleFails: fc.boolean() }), {
          minLength: 1,
          maxLength: 8,
        }),
        fc.uuid(),
        fc.string({ minLength: 1 }),
        async (schedule, userId, license) => {
          let attempt = 0;
          let createCalls = 0;
          let vehicleCalls = 0;
          let createSucceeded = 0;
          let vehicleSucceeded = 0;
          const client = {
            createDriver: async () => {
              createCalls++;
              if (schedule[attempt]?.createFails) throw new Error("create failed");
              createSucceeded++;
              return { id: "driver-1", userId } as DriverResponse;
            },
            addVehicle: async () => {
              vehicleCalls++;
              if (schedule[attempt]?.vehicleFails) throw new Error("vehicle failed");
              vehicleSucceeded++;
              return undefined as never;
            },
          };
          const { result, unmount } = renderHook(() => useDriverOnboarding(userId, client));
          const form = {
            licenseNumber: license,
            vehicle: { plateNumber: "59A-12345", vehicleType: "MOTORBIKE" as const },
          };

          for (attempt = 0; attempt < schedule.length; attempt++) {
            const createDoneBefore = createSucceeded > 0;
            const vehicleDoneBefore = vehicleSucceeded > 0;
            const createBefore = createCalls;
            const vehicleBefore = vehicleCalls;
            await act(async () => {
              await result.current.submit(form);
            });
            if (createDoneBefore) expect(createCalls).toBe(createBefore);
            if (vehicleDoneBefore) expect(vehicleCalls).toBe(vehicleBefore);
          }
          expect(createSucceeded).toBeLessThanOrEqual(1);
          expect(vehicleSucceeded).toBeLessThanOrEqual(1);
          unmount();
        },
      ),
      { numRuns: 100 },
    );
  });
});
