/**
 * SimulationControl — start, pause and stop buttons plus the Simulation_Badge
 * (requirements 11.1, 11.2, 11.14, 11.15). Disabled without an Assigned_Trip.
 */
import { Badge, Button } from "../../../shared/ui";
import type { UseSimulatorResult } from "./useSimulator";

export interface SimulationControlProps {
  simulator: UseSimulatorResult;
  /** True while the driver has an Assigned_Trip; otherwise every action is disabled. */
  hasAssignedTrip: boolean;
}

export function SimulationControl({ simulator, hasAssignedTrip }: SimulationControlProps) {
  const { running, paused, badgeVisible, noticeVisible } = simulator;
  const active = running || paused;
  return (
    <section aria-label="Simulation" className="flex flex-col gap-2">
      {badgeVisible ? (
        <Badge tone="warning">Simulated location</Badge>
      ) : null}
      <div className="flex gap-2">
        <Button
          size="md"
          variant="secondary"
          disabled={!hasAssignedTrip || running}
          onClick={simulator.startOrResume}
        >
          {paused ? "Resume simulation" : "Start simulation"}
        </Button>
        <Button size="md" variant="secondary" disabled={!hasAssignedTrip || !running} onClick={simulator.pause}>
          Pause
        </Button>
        <Button size="md" variant="ghost" disabled={!active} onClick={simulator.stop}>
          Stop
        </Button>
      </div>
      {noticeVisible ? (
        <p role="alert" className="text-sm text-danger">
          Simulated locations are not reaching the server. Retrying.
        </p>
      ) : null}
    </section>
  );
}
