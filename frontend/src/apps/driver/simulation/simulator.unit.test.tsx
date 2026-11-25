/**
 * Unit tests for the Simulator (useSimulator + SimulationControl).
 * Feature: frontend-booking-and-password-login
 * **Validates: Requirements 11.1, 11.2, 11.11, 11.12, 11.13, 12.4**
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { TripStatus } from "../../../shared/enums";
import { SimulationControl } from "./SimulationControl";
import { hasAssignedTrip, useSimulator } from "./useSimulator";

const PICKUP = { lat: 10.0, lng: 106.0 };
const DESTINATION = { lat: 10.1, lng: 106.1 };

function setup(initialStatus: TripStatus | null) {
  const updateLocation = vi.fn().mockResolvedValue(undefined);

  function Harness({ status }: { status: TripStatus | null }) {
    const simulator = useSimulator({
      driverClient: { updateLocation },
      driverId: "driver-1",
      tripStatus: status,
      pickup: PICKUP,
      destination: DESTINATION,
      lastKnownPosition: { lat: 9.9, lng: 105.9 },
      snapper: null,
      speedKmh: 3600,
      stepIntervalMs: 20,
    });
    return (
      <>
        <SimulationControl simulator={simulator} hasAssignedTrip={hasAssignedTrip(status)} />
        <output data-testid="state">{simulator.state.state}</output>
      </>
    );
  }

  const view = render(<Harness status={initialStatus} />);
  return {
    updateLocation,
    setStatus: (status: TripStatus | null) => view.rerender(<Harness status={status} />),
  };
}

const simState = () => screen.getByTestId("state").textContent;
const btn = (name: RegExp) => screen.getByRole("button", { name }) as HTMLButtonElement;

afterEach(cleanup);

describe("Simulator", () => {
  it("starts posting locations and shows the badge (11.1)", async () => {
    const { updateLocation } = setup("DRIVER_ASSIGNED");
    expect(btn(/start simulation/i).disabled).toBe(false);
    expect(screen.queryByText(/simulated location/i)).toBeNull();

    fireEvent.click(btn(/start simulation/i));

    await waitFor(() => expect(simState()).toBe("running"));
    await waitFor(() => expect(updateLocation).toHaveBeenCalled());
    expect(updateLocation.mock.calls[0]?.[0]).toBe("driver-1");
    expect(screen.getByText(/simulated location/i)).toBeTruthy();
  });

  it("pauses without posting and resumes from the same place (11.11)", async () => {
    const { updateLocation } = setup("DRIVER_ASSIGNED");
    fireEvent.click(btn(/start simulation/i));
    await waitFor(() => expect(updateLocation.mock.calls.length).toBeGreaterThan(1));

    fireEvent.click(btn(/^pause$/i));
    await waitFor(() => expect(simState()).toBe("paused"));
    const callsWhenPaused = updateLocation.mock.calls.length;
    await new Promise((r) => setTimeout(r, 100));
    expect(updateLocation.mock.calls.length).toBeLessThanOrEqual(callsWhenPaused + 1);
    expect(screen.getByText(/simulated location/i)).toBeTruthy();

    const settled = updateLocation.mock.calls.length;
    fireEvent.click(btn(/resume simulation/i));
    await waitFor(() => expect(simState()).toBe("running"));
    await waitFor(() => expect(updateLocation.mock.calls.length).toBeGreaterThan(settled));
  });

  it("stop returns to stopped and hides the badge (11.12)", async () => {
    const { updateLocation } = setup("DRIVER_ASSIGNED");
    fireEvent.click(btn(/start simulation/i));
    await waitFor(() => expect(updateLocation).toHaveBeenCalled());

    fireEvent.click(btn(/^stop$/i));

    await waitFor(() => expect(simState()).toBe("stopped"));
    expect(screen.queryByText(/simulated location/i)).toBeNull();
    expect(btn(/start simulation/i).disabled).toBe(false);
    expect(btn(/^stop$/i).disabled).toBe(true);
  });

  it.each<TripStatus>(["COMPLETED", "CANCELLED"])("stops automatically when the trip becomes %s (11.13)", async (final) => {
    const { updateLocation, setStatus } = setup("DRIVER_ASSIGNED");
    fireEvent.click(btn(/start simulation/i));
    await waitFor(() => expect(simState()).toBe("running"));
    await waitFor(() => expect(updateLocation).toHaveBeenCalled());

    setStatus(final);

    await waitFor(() => expect(simState()).toBe("stopped"));
    expect(screen.queryByText(/simulated location/i)).toBeNull();
    const calls = updateLocation.mock.calls.length;
    await new Promise((r) => setTimeout(r, 80));
    expect(updateLocation.mock.calls.length).toBeLessThanOrEqual(calls + 1);
  });

  it.each<[string, TripStatus | null]>([
    ["no trip", null],
    ["a REQUESTED trip", "REQUESTED"],
    ["a COMPLETED trip", "COMPLETED"],
    ["a CANCELLED trip", "CANCELLED"],
  ])("disables every action with %s (11.2, 12.4)", (_label, status) => {
    const { updateLocation } = setup(status);
    expect(btn(/start simulation/i).disabled).toBe(true);
    expect(btn(/^pause$/i).disabled).toBe(true);
    expect(btn(/^stop$/i).disabled).toBe(true);
    fireEvent.click(btn(/start simulation/i));
    expect(simState()).toBe("stopped");
    expect(updateLocation).not.toHaveBeenCalled();
  });

  it("hasAssignedTrip is true only for the assigned statuses", () => {
    expect(hasAssignedTrip("DRIVER_ASSIGNED")).toBe(true);
    expect(hasAssignedTrip("DRIVER_ARRIVED")).toBe(true);
    expect(hasAssignedTrip("IN_PROGRESS")).toBe(true);
    expect(hasAssignedTrip("COMPLETED")).toBe(false);
    expect(hasAssignedTrip(null)).toBe(false);
  });
});
