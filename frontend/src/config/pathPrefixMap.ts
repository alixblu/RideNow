/**
 * Path_Prefix_Map — the local fallback that maps request path prefixes to
 * individual backend service origins when no gateway `API_Base_URL` is set
 * (Req 3.3, 3.4).
 *
 * LIVE entries point at the Spring Boot services that own the data:
 *   /api/drivers, /api/vehicles   -> driver-service  (owns drivers and vehicles)
 *   /api/users                    -> user-service
 *   /api/trips, /api/trip-offers  -> trip-service
 *   /api/payments                 -> payment-service
 *
 * The remaining entries are documented placeholders for services that do not
 * exist yet (matching, notifications). They map to `null`; the request layer
 * turns a matched-but-null origin into a normalized "service unavailable" error
 * so a domain configured live before its service exists fails cleanly instead of
 * hitting a wrong host.
 */
export const PATH_PREFIX_MAP: Record<string, string | null> = {
  "/api/drivers": "http://localhost:8080", // driver-service
  "/api/vehicles": "http://localhost:8080", // driver-service
  "/api/users": "http://localhost:8081", // user-service
  "/api/trips": "http://localhost:8082", // trip-service
  "/api/trip-offers": "http://localhost:8082", // trip-service
  "/api/payments": "http://localhost:8083", // payment-service
  // Documented placeholders — no service yet (Req 3.4). Live mode for these
  // will fail with a service-unavailable error at the request layer until an
  // origin is provided.
  "/api/matching": null, // matching-service (future)
  "/api/notifications": null, // notification-worker (future)
};
