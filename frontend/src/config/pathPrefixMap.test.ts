import { describe, it, expect } from "vitest";
import { PATH_PREFIX_MAP } from "./pathPrefixMap";

// Task 2.2 — unit tests for the Path_Prefix_Map LIVE entries and the documented
// placeholder entries (Req 3.4).

describe("PATH_PREFIX_MAP — LIVE service origins (Req 3.3)", () => {
  it("maps /api/drivers and /api/vehicles to the driver-service origin", () => {
    expect(PATH_PREFIX_MAP["/api/drivers"]).toBe("http://localhost:8080");
    expect(PATH_PREFIX_MAP["/api/vehicles"]).toBe("http://localhost:8080");
  });

  it("maps /api/users to the user-service origin", () => {
    expect(PATH_PREFIX_MAP["/api/users"]).toBe("http://localhost:8081");
  });

  it("maps /api/trips and /api/trip-offers to the trip-service origin", () => {
    expect(PATH_PREFIX_MAP["/api/trips"]).toBe("http://localhost:8082");
    expect(PATH_PREFIX_MAP["/api/trip-offers"]).toBe("http://localhost:8082");
  });

  it("maps /api/payments to the payment-service origin", () => {
    expect(PATH_PREFIX_MAP["/api/payments"]).toBe("http://localhost:8083");
  });
});

describe("PATH_PREFIX_MAP — documented placeholders (Req 3.4)", () => {
  const PLACEHOLDER_PREFIXES = ["/api/matching", "/api/notifications"] as const;

  it("defines a null placeholder entry for each future domain", () => {
    for (const prefix of PLACEHOLDER_PREFIXES) {
      expect(prefix in PATH_PREFIX_MAP).toBe(true);
      expect(PATH_PREFIX_MAP[prefix]).toBeNull();
    }
  });

  it("defines exactly the LIVE and placeholder prefixes and no others", () => {
    expect(Object.keys(PATH_PREFIX_MAP).sort()).toEqual(
      [
        "/api/drivers",
        "/api/vehicles",
        "/api/users",
        "/api/trips",
        "/api/trip-offers",
        "/api/payments",
        ...PLACEHOLDER_PREFIXES,
      ].sort(),
    );
  });
});
