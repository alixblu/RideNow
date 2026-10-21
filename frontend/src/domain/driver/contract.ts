/**
 * Driver domain contract — the single documented shape both the Live_Client and the
 * Mock_Client implement (Req 4.1, 4.3). Screens depend only on this interface and
 * these types, never on which implementation is active, so swapping live/mock never
 * touches a screen.
 *
 * Request/response types mirror the inspected driver-service Java records exactly
 * (design: "Typed models and DTOs"):
 *   - CreateDriverRequest  ← CreateDriverRequest (record: userId UUID, licenseNumber)
 *   - DriverResponse       ← DriverResponse (record: id, userId, licenseNumber,
 *                            status, averageRating BigDecimal, totalTrips long,
 *                            createdAt/updatedAt Instant)
 * All IDs are UUID strings; timestamps are ISO-8601 strings (Jackson serializes
 * `Instant` as ISO-8601); `averageRating` is a nullable JSON number (BigDecimal) per
 * the DBML.
 *
 * Vehicle request/response types are owned by the vehicle domain (task 9.1) in
 * `../vehicle/contract`; driver's add/list/get-vehicle operations reference them so
 * the two live clients speak the same vehicle shapes (driver-service owns vehicles).
 */
import type { DriverStatus } from "../../shared/enums";
import type { Page } from "../../shared/page";
import type { CreateVehicleRequest, VehicleResponse } from "../vehicle/contract";

// ---------------------------------------------------------------------------
// Request types — only the facts a client supplies; the server owns the rest.
// ---------------------------------------------------------------------------

/** Body for `POST /api/drivers` (mirrors the Java `CreateDriverRequest` record). */
export interface CreateDriverRequest {
  userId: string;
  licenseNumber: string;
}

// ---------------------------------------------------------------------------
// Response types — field names and types match the Java records exactly.
// ---------------------------------------------------------------------------

/** A driver profile returned by driver-service (mirrors the `DriverResponse` record). */
export interface DriverResponse {
  id: string;
  userId: string;
  licenseNumber: string;
  status: DriverStatus;
  /** BigDecimal → JSON number, nullable per DBML. */
  averageRating: number | null;
  /** long. */
  totalTrips: number;
  /** Instant → ISO-8601 string. */
  createdAt: string;
  /** Instant → ISO-8601 string. */
  updatedAt: string;
}

/** Query parameters for listing drivers (`GET /api/drivers`). */
export interface ListDriversParams {
  limit?: number;
  offset?: number;
  status?: DriverStatus;
}

// ---------------------------------------------------------------------------
// Service_Client contract — identical for Live_Client and Mock_Client.
// ---------------------------------------------------------------------------

export interface DriverServiceClient {
  /** `POST /api/drivers` → 201 `DriverResponse`. */
  createDriver(req: CreateDriverRequest): Promise<DriverResponse>;
  /** `GET /api/drivers` → `Page<DriverResponse>` (filtered/paginated). */
  listDrivers(params: ListDriversParams): Promise<Page<DriverResponse>>;
  /** `GET /api/drivers/{id}` → `DriverResponse` (404 → ApiError.notFound). */
  getDriver(id: string): Promise<DriverResponse>;
  /** `POST /api/drivers/{driverId}/vehicles` → 201 `VehicleResponse`. */
  addVehicle(driverId: string, req: CreateVehicleRequest): Promise<VehicleResponse>;
  /** `GET /api/drivers/{driverId}/vehicles` → `VehicleResponse[]`. */
  listVehicles(driverId: string): Promise<VehicleResponse[]>;
  /** `PATCH /api/drivers/{driverId}/status?status=...` → `DriverResponse`. */
  changeStatus(driverId: string, status: DriverStatus): Promise<DriverResponse>;
  /** `GET /api/vehicles/{id}` → `VehicleResponse`. */
  getVehicle(id: string): Promise<VehicleResponse>;
}
