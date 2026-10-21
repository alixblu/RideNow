/**
 * Driver Mock_Client — an in-memory implementation of `DriverServiceClient` whose
 * methods return objects satisfying the exact same `DriverResponse` / `VehicleResponse`
 * types as the Live_Client, so a mock-backed screen renders identically and shows no
 * mock marker (Req 4.2, 4.4).
 *
 * Drivers live in a per-instance `Map` keyed by driver id. Creating a driver fills in
 * the server-owned fields the backend would set: a generated UUID id, `status`
 * defaulting to `ACTIVE`, a null `averageRating` (no trips rated yet), `totalTrips` 0,
 * and ISO-8601 timestamps.
 *
 * Vehicles are a driver-service resource, so rather than duplicate a vehicle store this
 * client composes a single `createVehicleMockClient()` instance and delegates
 * `addVehicle` / `listVehicles` / `getVehicle` to it. That keeps one shared store, so a
 * vehicle added through the driver client is visible when listed or fetched back.
 */
import { ApiError } from "../../http/ApiError";
import type { DriverStatus } from "../../shared/enums";
import type { Page } from "../../shared/page";
import type { CreateVehicleRequest, VehicleResponse } from "../vehicle/contract";
import { createVehicleMockClient } from "../vehicle/mockClient";
import type {
  CreateDriverRequest,
  DriverResponse,
  DriverServiceClient,
  ListDriversParams,
} from "./contract";

/** Default/maximum window sizes for listDrivers, mirroring the backend semantics. */
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

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
 * Build a fresh Mock_Client with its own in-memory driver store and its own composed
 * vehicle Mock_Client. Each call is isolated, which keeps tests deterministic.
 */
export function createDriverMockClient(): DriverServiceClient {
  const store = new Map<string, DriverResponse>();
  // One shared vehicle mock instance so the driver's vehicle operations read and write
  // the same underlying store.
  const vehicles = createVehicleMockClient();

  return {
    createDriver(req: CreateDriverRequest): Promise<DriverResponse> {
      const now = new Date().toISOString();
      const driver: DriverResponse = {
        id: newId(),
        userId: req.userId,
        licenseNumber: req.licenseNumber,
        status: "ACTIVE",
        averageRating: null,
        totalTrips: 0,
        createdAt: now,
        updatedAt: now,
      };
      store.set(driver.id, driver);
      return Promise.resolve(driver);
    },

    getDriver(id: string): Promise<DriverResponse> {
      const driver = store.get(id);
      if (!driver) {
        return Promise.reject(ApiError.notFound());
      }
      return Promise.resolve(driver);
    },

    listDrivers(params: ListDriversParams): Promise<Page<DriverResponse>> {
      const limit = Math.min(Math.max(params.limit ?? DEFAULT_LIMIT, 0), MAX_LIMIT);
      const offset = Math.max(params.offset ?? 0, 0);

      const matched = [...store.values()]
        .filter((driver) =>
          params.status === undefined ? true : driver.status === params.status,
        )
        // Most recently created first.
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

      const items = matched.slice(offset, offset + limit);
      return Promise.resolve({ items, total: matched.length, limit, offset });
    },

    changeStatus(driverId: string, status: DriverStatus): Promise<DriverResponse> {
      const existing = store.get(driverId);
      if (!existing) {
        return Promise.reject(ApiError.notFound());
      }
      const updated: DriverResponse = {
        ...existing,
        status,
        updatedAt: new Date().toISOString(),
      };
      store.set(updated.id, updated);
      return Promise.resolve(updated);
    },

    addVehicle(
      driverId: string,
      req: CreateVehicleRequest,
    ): Promise<VehicleResponse> {
      return vehicles.addVehicle(driverId, req);
    },

    listVehicles(driverId: string): Promise<VehicleResponse[]> {
      return vehicles.listVehicles(driverId);
    },

    getVehicle(id: string): Promise<VehicleResponse> {
      return vehicles.getVehicle(id);
    },
  };
}
