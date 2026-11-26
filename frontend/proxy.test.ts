import { describe, expect, it } from "vitest";
import { buildProxy } from "./proxy";

describe("buildProxy", () => {
  it("routes each prefix to its local service when no target is set", () => {
    const p = buildProxy(undefined);
    expect(p["/api/auth"]).toEqual({ target: "http://localhost:8081", changeOrigin: false });
    expect(p["/api/drivers"]?.target).toBe("http://localhost:8080");
    expect(p["/live"]?.target).toBe("http://localhost:8086");
  });

  it("treats a blank target as unset", () => {
    expect(buildProxy("  ")["/api/trips"]?.target).toBe("http://localhost:8082");
  });

  it("sends every prefix, including /api/auth and /live, to the target", () => {
    const p = buildProxy("http://alb.example.com/");
    for (const prefix of Object.keys(p)) {
      expect(p[prefix]).toEqual({ target: "http://alb.example.com", changeOrigin: true });
    }
    expect(p["/api/auth"]).toBeDefined();
    expect(p["/live"]).toBeDefined();
  });
});
