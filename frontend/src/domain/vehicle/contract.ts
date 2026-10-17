/**
 * Vehicle domain contract (LIVE — driver-service owns vehicles, Req 6.1).
 *
 * Vehicles are a driver-service resource, so these types mirror the inspected Java
 * records exactly (`CreateVehicleRequest`, `VehicleResponse`) and the endpoints hang
 * off the driver-service origin (`/api/drivers/{driverId}/vehicles`, `/api/vehicles/{id}`).
 * The vehicle domain is modeled as its own Service_Client so screens and the client
 * factory treat it as an independent, swappable boundary (Req 4.1) even though it shares
 * driver-service's backend.
 *
 * These are the canonical definitions other frontend code imports. Field names and types
 * match the Java records: `CreateVehicleRequest` has a required plate number and vehicle
 * type with three optional free-text fields; `VehicleResponse` adds the server-owned
 * identifiers, the nullable descriptive fields, the active flag, and ISO-8601 timestamps
 * (Jackson serializes `Instant` as ISO-8601, `UUID` as a string).
 */
import type { VehicleType } from "../../shared/enums";

/**
 * Request body for adding a vehicle to a driver.
 *
 * Mirrors the Java `CreateVehicleRequest` record: `plateNumber` and `vehicleType` are
 * required (the backend enforces `@NotBlank` / `@NotNull`); `brand`, `model`, and
 * `color` are optional free-text fields and are therefore marked optional here.
 */
export interface CreateVehicleRequest {
  plateNumber: string;
  vehicleType: VehicleType;
  brand?: string;
  model?: string;
  color?: string;
}

/**
 * Vehicle as returned by driver-service.
 *
 * Mirrors the Java `VehicleResponse` record. `id` and `driverId` are UUID strings;
 * `brand`, `model`, and `color` are nullable (explicitly `null` when absent rather than
 * omitted); `active` is the enabled flag; `createdAt` / `updatedAt` are ISO-8601 strings.
 */
export interface VehicleResponse {
  id: string;
  driverId: string;
  plateNumber: string;
  vehicleType: VehicleType;
  brand: string | null;
  model: string | null;
  color: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * The vehicle Service_Client. Live and Mock implement this identical interface, so
 * screens are implementation-agnostic (Req 4.1, 4.3).
 *
 * Endpoint mapping (driver-service, prefix-resolved):
 *   - addVehicle   → POST /api/drivers/{driverId}/vehicles  (201 VehicleResponse)
 *   - listVehicles → GET  /api/drivers/{driverId}/vehicles  (VehicleResponse[])
 *   - getVehicle   → GET  /api/vehicles/{id}                (VehicleResponse, 404 if missing)
 */
export interface VehicleServiceClient {
  /** Add a vehicle to the given driver. */
  addVehicle(driverId: string, req: CreateVehicleRequest): Promise<VehicleResponse>;
  /** List all vehicles owned by the given driver. */
  listVehicles(driverId: string): Promise<VehicleResponse[]>;
  /** Fetch a single vehicle by id; 404 surfaces as `ApiError.notFound`. */
  getVehicle(id: string): Promise<VehicleResponse>;
}
