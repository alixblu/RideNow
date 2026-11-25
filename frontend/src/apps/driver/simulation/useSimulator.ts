/**
 * useSimulator — wires the pure `simulationMachine` to a 1 s timer, the road snapper
 * and the driver client (requirements 11.1-11.7, 11.11-11.16).
 *
 * Only the driver client is imported: locations go out through
 * `POST /api/drivers/{id}/location`, and no trip transition endpoint is reachable from
 * here (11.16). Status changes made by the driver's own buttons drive the legs:
 * pickup leg on DRIVER_ASSIGNED, hold at pickup, trip leg on IN_PROGRESS, and a stop
 * on COMPLETED or CANCELLED.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { DriverServiceClient } from "../../../domain/driver";
import type { LatLng, RoadSnapper } from "../../../map/roadSnapper";
import type { TripStatus } from "../../../shared/enums";
import { buildRoutedPath } from "./path";
import {
  advance,
  currentPoint,
  initialSimulatorState,
  isBadgeVisible,
  isNoticeVisible,
  pause,
  recordPostResult,
  resume,
  start,
  stop,
} from "./simulationMachine";
import type { SimLeg, SimulatorState } from "./simulationMachine";

/** Step_Interval: one point per second (11.7). */
export const STEP_INTERVAL_MS = 1000;

const ASSIGNED_STATUSES: readonly TripStatus[] = ["DRIVER_ASSIGNED", "DRIVER_ARRIVED", "IN_PROGRESS"];

/** True for the statuses that make up an Assigned_Trip. */
export function hasAssignedTrip(status: TripStatus | null | undefined): boolean {
  return status != null && ASSIGNED_STATUSES.includes(status);
}

export interface UseSimulatorOptions {
  driverClient: Pick<DriverServiceClient, "updateLocation">;
  driverId: string | null | undefined;
  /** Status of the driver's current trip; null when there is none. */
  tripStatus: TripStatus | null | undefined;
  pickup: LatLng | null | undefined;
  destination: LatLng | null | undefined;
  /** The driver's last known position, used as the start of the pickup leg. */
  lastKnownPosition?: LatLng | null | undefined;
  snapper?: RoadSnapper | null | undefined;
  speedKmh: number;
  stepIntervalMs?: number | undefined;
}

export interface UseSimulatorResult {
  state: SimulatorState;
  running: boolean;
  paused: boolean;
  /** True while running or paused: show the Simulation_Badge (11.15). */
  badgeVisible: boolean;
  /** True after 3 consecutive failed posts (11.14). */
  noticeVisible: boolean;
  /** Start from stopped, or resume from paused (11.3, 11.11). */
  startOrResume: () => void;
  pause: () => void;
  stop: () => void;
}

export function useSimulator(options: UseSimulatorOptions): UseSimulatorResult {
  const { tripStatus, stepIntervalMs = STEP_INTERVAL_MS } = options;
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const machine = useRef<SimulatorState>(initialSimulatorState);
  const [state, setState] = useState<SimulatorState>(initialSimulatorState);
  /** Bumped on every start/stop so stale async results are dropped. */
  const generation = useRef(0);
  const inFlight = useRef(false);
  const lastPosted = useRef<LatLng | null>(null);

  const commit = useCallback((next: SimulatorState) => {
    machine.current = next;
    setState(next);
  }, []);

  const beginLeg = useCallback(
    async (leg: SimLeg, keepPaused: boolean) => {
      const o = optionsRef.current;
      const target = leg === "pickup" ? o.pickup : o.destination;
      const from = leg === "pickup" ? (lastPosted.current ?? o.lastKnownPosition ?? o.pickup) : o.pickup;
      if (!target || !from) {
        return;
      }
      generation.current += 1;
      const mine = generation.current;
      const path = await buildRoutedPath(o.snapper, from, target, o.speedKmh, stepIntervalMs);
      if (mine !== generation.current) {
        return;
      }
      const started = start(machine.current, leg, path);
      commit(keepPaused ? pause(started) : started);
    },
    [commit, stepIntervalMs],
  );

  const stopNow = useCallback(() => {
    generation.current += 1;
    lastPosted.current = null;
    commit(stop(machine.current));
  }, [commit]);

  // Post the next point every Step_Interval while running (11.7).
  const running = state.state === "running";
  useEffect(() => {
    if (!running) {
      return undefined;
    }
    const tick = () => {
      const point = currentPoint(machine.current);
      const driverId = optionsRef.current.driverId;
      if (!point || !driverId || inFlight.current) {
        return;
      }
      inFlight.current = true;
      const mine = generation.current;
      optionsRef.current.driverClient
        .updateLocation(driverId, point.lat, point.lng)
        .then(
          () => true,
          () => false,
        )
        .then((ok) => {
          inFlight.current = false;
          if (mine !== generation.current || machine.current.state === "stopped") {
            return;
          }
          let next = recordPostResult(machine.current, ok);
          if (ok) {
            lastPosted.current = point;
            next = advance(next);
          }
          commit(next);
        });
    };
    tick();
    const timer = setInterval(tick, stepIntervalMs);
    return () => clearInterval(timer);
  }, [running, stepIntervalMs, commit]);

  // Follow the trip status: switch legs and force-stop (11.4, 11.5, 11.13, 11.2).
  useEffect(() => {
    if (machine.current.state === "stopped") {
      return;
    }
    if (!hasAssignedTrip(tripStatus)) {
      stopNow();
    } else if (tripStatus === "IN_PROGRESS" && machine.current.leg === "pickup") {
      void beginLeg("trip", machine.current.state === "paused");
    }
  }, [tripStatus, beginLeg, stopNow]);

  // Discard everything on unmount.
  useEffect(
    () => () => {
      generation.current += 1;
    },
    [],
  );

  const startOrResume = useCallback(() => {
    const current = machine.current;
    if (current.state === "paused") {
      commit(resume(current));
      return;
    }
    const status = optionsRef.current.tripStatus;
    if (current.state === "running" || !hasAssignedTrip(status)) {
      return;
    }
    void beginLeg(status === "IN_PROGRESS" ? "trip" : "pickup", false);
  }, [beginLeg, commit]);

  const pauseNow = useCallback(() => commit(pause(machine.current)), [commit]);

  return {
    state,
    running,
    paused: state.state === "paused",
    badgeVisible: isBadgeVisible(state),
    noticeVisible: isNoticeVisible(state),
    startOrResume,
    pause: pauseNow,
    stop: stopNow,
  };
}
