/**
 * Dev-server proxy table. Without a target, each path prefix goes to the local
 * service that owns it. With a target (e.g. the ALB URL), every prefix goes there.
 */
export interface ProxyEntry {
  target: string;
  changeOrigin: boolean;
}

export const LOCAL_PROXY: Record<string, string> = {
  "/api/auth": "http://localhost:8081",
  "/api/drivers": "http://localhost:8080",
  "/api/vehicles": "http://localhost:8080",
  "/api/users": "http://localhost:8081",
  "/api/trips": "http://localhost:8082",
  "/api/trip-offers": "http://localhost:8082",
  "/api/payments": "http://localhost:8083",
  "/api/notifications": "http://localhost:8084",
  "/live": "http://localhost:8086",
};

export function buildProxy(target?: string): Record<string, ProxyEntry> {
  const override = target?.trim().replace(/\/+$/, "");
  const result: Record<string, ProxyEntry> = {};
  for (const [prefix, local] of Object.entries(LOCAL_PROXY)) {
    result[prefix] = { target: override || local, changeOrigin: Boolean(override) };
  }
  return result;
}
