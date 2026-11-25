/**
 * Pure state machine for the driver Simulator (requirements 11.11, 11.12, 11.14, 11.15).
 *
 * `path[index]` is the next point to post. The hook posts it, then calls
 * `recordPostResult`, and on success calls `advance`. A failed post leaves `index`
 * unchanged so the same point is retried on the next Step_Interval.
 */

import type { LatLng } from "../../../map/roadSnapper";

export type SimState = "stopped" | "running" | "paused";
export type SimLeg = "pickup" | "trip";

export interface SimulatorState {
  state: SimState;
  leg: SimLeg | null;
  path: LatLng[];
  index: number;
  consecutiveFailures: number;
}

/** Consecutive failed posts that make the notice visible (11.14). */
export const FAILURE_NOTICE_THRESHOLD = 3;

export const initialSimulatorState: SimulatorState = {
  state: "stopped",
  leg: null,
  path: [],
  index: 0,
  consecutiveFailures: 0,
};

/** Begin a leg from the first point of `path`. Works from any state. */
export function start(
  _current: SimulatorState,
  leg: SimLeg,
  path: LatLng[],
): SimulatorState {
  return { state: "running", leg, path, index: 0, consecutiveFailures: 0 };
}

/** Stop posting and keep the position. No effect unless running. */
export function pause(current: SimulatorState): SimulatorState {
  return current.state === "running" ? { ...current, state: "paused" } : current;
}

/** Continue from the kept position. No effect unless paused. */
export function resume(current: SimulatorState): SimulatorState {
  return current.state === "paused" ? { ...current, state: "running" } : current;
}

/** Stop posting and discard the Path. */
export function stop(_current: SimulatorState): SimulatorState {
  return initialSimulatorState;
}

/** Move to the next point after a successful post. No effect unless running. */
export function advance(current: SimulatorState): SimulatorState {
  if (current.state !== "running" || current.index >= current.path.length) {
    return current;
  }
  return { ...current, index: current.index + 1 };
}

/** Update the consecutive-failure count. Never changes `index`. */
export function recordPostResult(
  current: SimulatorState,
  ok: boolean,
): SimulatorState {
  return { ...current, consecutiveFailures: ok ? 0 : current.consecutiveFailures + 1 };
}

/** The point to post now, or null when not running or the Path is exhausted. */
export function currentPoint(current: SimulatorState): LatLng | null {
  if (current.state !== "running") {
    return null;
  }
  return current.path[current.index] ?? null;
}

/** True when every point of the current leg has been posted. */
export function isLegComplete(current: SimulatorState): boolean {
  return current.state !== "stopped" && current.index >= current.path.length;
}

/** The Simulation_Badge shows while running or paused (11.15). */
export function isBadgeVisible(current: SimulatorState | SimState): boolean {
  const state = typeof current === "string" ? current : current.state;
  return state === "running" || state === "paused";
}

/** The failure notice shows after 3 or more consecutive failures (11.14). */
export function isNoticeVisible(current: SimulatorState): boolean {
  return current.consecutiveFailures >= FAILURE_NOTICE_THRESHOLD;
}
