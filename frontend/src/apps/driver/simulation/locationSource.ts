/**
 * Pure location-source selection for the Drive screen (requirements 10.9, 11.6).
 *
 * The single `useLocationSender` instance uses "simulate" while the Simulator is
 * running or paused, and "gps" otherwise.
 */
import type { SimState } from "./simulationMachine";
import type { LocationSource } from "../useLocationSender";

export function selectLocationSource(simState: SimState): LocationSource {
  return simState === "running" || simState === "paused" ? "simulate" : "gps";
}
