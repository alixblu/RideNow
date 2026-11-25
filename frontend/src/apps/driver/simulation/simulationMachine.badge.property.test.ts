import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  isBadgeVisible,
  initialSimulatorState,
  type SimState,
  type SimulatorState,
} from "./simulationMachine";

// Feature: frontend-booking-and-password-login, Property 29: The Simulation_Badge is visible exactly while running or paused
describe("Property 29: Simulation_Badge visibility", () => {
  /** **Validates: Requirements 11.15** */
  it("is visible exactly when the state is running or paused", () => {
    const simState = fc.constantFrom<SimState>("stopped", "running", "paused");
    fc.assert(
      fc.property(
        simState,
        fc.nat(50),
        fc.nat(10),
        (state, index, failures) => {
          const current: SimulatorState = {
            ...initialSimulatorState,
            state,
            index,
            consecutiveFailures: failures,
          };
          const expected = state === "running" || state === "paused";
          expect(isBadgeVisible(current)).toBe(expected);
          expect(isBadgeVisible(state)).toBe(expected);
        },
      ),
      { numRuns: 100 },
    );
  });
});
