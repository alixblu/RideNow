import { describe, it, expect } from "vitest";
import {
  appConfig,
  buildConfig,
  type AppConfig,
  type DomainKey,
} from "./appConfig";

// Task 2.2 — unit tests for config parsing and defaults (Req 3.1, 3.4).
// `buildConfig(env)` is the pure core behind the `appConfig` singleton, so we
// test parsing/defaults deterministically with crafted env objects and verify
// the singleton reflects the same contract against the current env.

/** Build a minimal env source; extra VITE_* keys are merged over the base. */
function env(overrides: Record<string, string> = {}): ImportMetaEnv {
  return {
    MODE: "test",
    BASE_URL: "/",
    PROD: false,
    DEV: true,
    SSR: false,
    ...overrides,
  } as unknown as ImportMetaEnv;
}

const LIVE_DOMAINS: DomainKey[] = ["driver", "vehicle", "user"];
const STUBBED_DOMAINS: DomainKey[] = [
  "trip",
  "matching",
  "payment",
  "notification",
];
const ALL_DOMAINS: DomainKey[] = [...LIVE_DOMAINS, ...STUBBED_DOMAINS];

describe("buildConfig — API base URL parsing (Req 3.1)", () => {
  it("returns null when VITE_API_BASE_URL is unset (no gateway)", () => {
    expect(buildConfig(env()).apiBaseUrl).toBeNull();
  });

  it("reads the configured gateway origin verbatim", () => {
    const config = buildConfig(
      env({ VITE_API_BASE_URL: "https://gateway.example.com" }),
    );
    expect(config.apiBaseUrl).toBe("https://gateway.example.com");
  });

  it("trims surrounding whitespace from the base URL", () => {
    const config = buildConfig(
      env({ VITE_API_BASE_URL: "  https://gw.example.com  " }),
    );
    expect(config.apiBaseUrl).toBe("https://gw.example.com");
  });

  it("treats a blank or whitespace-only base URL as no gateway", () => {
    expect(buildConfig(env({ VITE_API_BASE_URL: "   " })).apiBaseUrl).toBeNull();
    expect(buildConfig(env({ VITE_API_BASE_URL: "" })).apiBaseUrl).toBeNull();
  });

  it("reads the base URL from the provided env source only (read once per build)", () => {
    // buildConfig takes env as an argument and does not read any ambient source,
    // so two builds from the same env produce the same base URL every time.
    const source = env({ VITE_API_BASE_URL: "https://only.example.com" });
    const first = buildConfig(source).apiBaseUrl;
    const second = buildConfig(source).apiBaseUrl;
    expect(first).toBe("https://only.example.com");
    expect(second).toBe(first);
  });
});

describe("buildConfig — per-domain mode defaults (Req 3.4)", () => {
  it("defaults LIVE domains (driver, vehicle, user) to 'live'", () => {
    const config = buildConfig(env());
    for (const domain of LIVE_DOMAINS) {
      expect(config.clients[domain].mode).toBe("live");
    }
  });

  it("defaults STUBBED domains (trip, matching, payment, notification) to 'mock'", () => {
    const config = buildConfig(env());
    for (const domain of STUBBED_DOMAINS) {
      expect(config.clients[domain].mode).toBe("mock");
    }
  });

  it("includes exactly one entry per known domain", () => {
    const config = buildConfig(env());
    expect(Object.keys(config.clients).sort()).toEqual([...ALL_DOMAINS].sort());
  });

  it("applies a recognized VITE_CLIENT_<DOMAIN> override", () => {
    const config = buildConfig(
      env({ VITE_CLIENT_DRIVER: "mock", VITE_CLIENT_TRIP: "live" }),
    );
    expect(config.clients.driver.mode).toBe("mock");
    expect(config.clients.trip.mode).toBe("live");
  });

  it("ignores an unrecognized override and keeps the domain default", () => {
    const config = buildConfig(
      env({ VITE_CLIENT_DRIVER: "bogus", VITE_CLIENT_PAYMENT: "" }),
    );
    expect(config.clients.driver.mode).toBe("live");
    expect(config.clients.payment.mode).toBe("mock");
  });
});

describe("appConfig singleton", () => {
  it("exposes an apiBaseUrl that is either a string or null", () => {
    const value: AppConfig["apiBaseUrl"] = appConfig.apiBaseUrl;
    expect(value === null || typeof value === "string").toBe(true);
  });

  it("carries a valid mode for every known domain", () => {
    for (const domain of ALL_DOMAINS) {
      expect(["live", "mock"]).toContain(appConfig.clients[domain].mode);
    }
  });
});
