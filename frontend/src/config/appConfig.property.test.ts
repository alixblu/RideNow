import { describe, it } from "vitest";
import fc from "fast-check";
import { buildConfig } from "./appConfig";

/**
 * Feature: frontend-booking-and-password-login
 * Property 11: Configuration parsing resolves documented defaults for every new variable
 * **Validates: Requirements 4.1, 4.4, 11.8**
 */

type Env = Parameters<typeof buildConfig>[0];

const blank = fc.stringMatching(/^[ \t]{0,4}$/);
const urlCore = fc.webUrl();
const padding = fc.stringMatching(/^[ \t]{0,3}$/);

/** A variable that is absent, blank, or set to a padded value. */
function variable<T>(value: fc.Arbitrary<T>) {
  return fc.oneof(
    fc.constant({ kind: "absent" as const }),
    blank.map((raw) => ({ kind: "blank" as const, raw })),
    fc
      .tuple(padding, value, padding)
      .map(([l, v, r]) => ({ kind: "set" as const, value: v, l, r })),
  );
}

describe("Property 11: configuration parsing defaults", () => {
  it("resolves geocoderUrl, osrmUrl and simSpeedKmh for every set/blank/absent combination", () => {
    const speed = fc.double({ min: 0.1, max: 500, noNaN: true });
    fc.assert(
      fc.property(variable(urlCore), variable(urlCore), variable(speed), (geo, osrm, sim) => {
        const env: Record<string, unknown> = {};
        if (geo.kind === "blank") env.VITE_GEOCODER_URL = geo.raw;
        if (geo.kind === "set") env.VITE_GEOCODER_URL = `${geo.l}${geo.value}${geo.r}`;
        if (osrm.kind === "blank") env.VITE_OSRM_URL = osrm.raw;
        if (osrm.kind === "set") env.VITE_OSRM_URL = `${osrm.l}${osrm.value}${osrm.r}`;
        if (sim.kind === "blank") env.VITE_SIM_SPEED_KMH = sim.raw;
        if (sim.kind === "set") env.VITE_SIM_SPEED_KMH = `${sim.l}${sim.value}${sim.r}`;

        const cfg = buildConfig(env as unknown as Env);

        const geoOk = cfg.geocoderUrl === (geo.kind === "set" ? geo.value : null);
        const osrmOk = cfg.osrmUrl === (osrm.kind === "set" ? osrm.value : null);
        const simOk = cfg.simSpeedKmh === (sim.kind === "set" ? Number(sim.value) : 30);
        return geoOk && osrmOk && simOk;
      }),
      { numRuns: 100 },
    );
  });
});
