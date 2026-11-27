// Shared motion tokens and a reduced-motion-aware duration helper (Req 7.1-7.3).
export const MOTION_DURATION = { press: 80, fast: 120, base: 200, slow: 360 } as const;

export const MOTION_EASE = "cubic-bezier(0.2, 0, 0, 1)";

/** True when the user asked for reduced motion. Safe where matchMedia is missing (SSR, jsdom). */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Returns 0 ms when reduced motion is preferred, else the given duration. */
export function motionDuration(ms: number): number {
  return prefersReducedMotion() ? 0 : ms;
}
