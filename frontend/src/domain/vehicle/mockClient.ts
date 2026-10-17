/**
 * Vehicle Mock_Client — an in-memory implementation of `VehicleServiceClient` whose
 * methods return objects satisfying the exact same `VehicleResponse` type as the
 * Live_Client, so a mock-backed screen renders identically and shows no mock marker
 * (Req 4.4, 4.5).
 *
 * The store is a per-instance `Map` keyed by vehicle id. Adding a vehicle fills in the
 * server-owned fields the backend would set: a generated UUID id, the owning driver id,
 * `active` defaulting to `true`, and ISO-8601 timestamps. The optional descriptive
 * fields (`brand`, `model`, `color`) are stored as explicit `null` when absent, matching
 * how Jackson serializes the nullable columns — never left `undefined`.
 */
import { ApiError } from "../../http/ApiError";
import type {
  CreateVehicleRequest,
  VehicleResponse,
  VehicleServiceClient,
} from "./contract";

/** Normalize an optional request field to the contract's explicit `string | null`. */
function orNull(value: string | undefined): string | null {
  return value !== undefined && value !== null ? value : null;
}

/** Best-effort UUID generation with a deterministic fallback for older runtimes. */
function newId(): string {
  const cryptoObj =
    typeof globalThis !== "undefined"
      ? (globalThis.crypto as Crypto | undefined)
      : undefined;
  if (cryptoObj && typeof cryptoObj.randomUUID === "function") {
    return cryptoObj.randomUUID();
  }
  // Fallback: RFC-4122-shaped identifier; sufficient for in-memory mock keys.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Build a fresh Mock_Client with its own in-memory store. Each call is isolated, which
 * keeps tests deterministic.
 */
export function createVehicleMockClient(): VehicleServiceClient {
  const store = new Map<string, VehicleResponse>();

  return {
    addVehicle(
      driverId: string,
      req: CreateVehicleRequest,
    ): Promise<VehicleResponse> {
      const now = new Date().toISOString();
      const vehicle: VehicleResponse = {
        id: newId(),
        driverId,
        plateNumber: req.plateNumber,
        vehicleType: req.vehicleType,
        brand: orNull(req.brand),
        model: orNull(req.model),
        color: orNull(req.color),
        active: true,
        createdAt: now,
        updatedAt: now,
      };
      store.set(vehicle.id, vehicle);
      return Promise.resolve(vehicle);
    },

    listVehicles(driverId: string): Promise<VehicleResponse[]> {
      const vehicles = Array.from(store.values()).filter(
        (v) => v.driverId === driverId,
      );
      return Promise.resolve(vehicles);
    },

    getVehicle(id: string): Promise<VehicleResponse> {
      const vehicle = store.get(id);
      if (!vehicle) {
        return Promise.reject(ApiError.notFound());
      }
      return Promise.resolve(vehicle);
    },
  };
}
