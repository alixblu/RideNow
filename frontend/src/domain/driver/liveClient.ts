/**
 * Driver Live_Client — the real-HTTP implementation of `DriverServiceClient`.
 *
 * Every operation maps one-to-one to a driver-service endpoint (design: "Endpoint
 * mapping (driver-service, prefix-resolved)") and goes through `httpRequest`, so URL
 * resolution (gateway vs Path_Prefix_Map), principal attachment, and error
 * normalization stay centralized in the http layer. This client only knows paths,
 * methods, and bodies — never how a URL is resolved or how an error becomes an
 * `ApiError`.
 *
 * Paths use the documented `/api/drivers` and `/api/vehicles` prefixes that the
 * Path_Prefix_Map routes to driver-service. Path segments that carry caller-supplied
 * identifiers are URL-encoded so an id can be placed into the path safely.
 */
import { httpRequest } from "../../http/httpClient";
import type { DriverStatus } from "../../shared/enums";
import type { Page } from "../../shared/page";
import type { CreateVehicleRequest, VehicleResponse } from "../vehicle/contract";
import type {
  CreateDriverRequest,
  DriverResponse,
  DriverServiceClient,
  ListDriversParams,
} from "./contract";

/**
 * Build the driver-service `Live_Client`.
 *
 * Returned as a factory (not a singleton) to match the client-factory pattern: the
 * generic `resolveClient` only invokes this thunk when the driver domain is configured
 * `live`, so a mock-configured driver domain never constructs it.
 */
export function createDriverLiveClient(): DriverServiceClient {
  return {
    createDriver(req: CreateDriverRequest): Promise<DriverResponse> {
      return httpRequest<DriverResponse>("/api/drivers", {
        method: "POST",
        body: req,
      });
    },

    getDriver(id: string): Promise<DriverResponse> {
      return httpRequest<DriverResponse>(`/api/drivers/${encodeURIComponent(id)}`);
    },

    listDrivers(params: ListDriversParams): Promise<Page<DriverResponse>> {
      const query = new URLSearchParams();
      if (params.limit !== undefined) {
        query.set("limit", String(params.limit));
      }
      if (params.offset !== undefined) {
        query.set("offset", String(params.offset));
      }
      if (params.status !== undefined) {
        query.set("status", params.status);
      }
      const qs = query.toString();
      return httpRequest<Page<DriverResponse>>(
        `/api/drivers${qs.length > 0 ? `?${qs}` : ""}`,
      );
    },

    addVehicle(
      driverId: string,
      req: CreateVehicleRequest,
    ): Promise<VehicleResponse> {
      return httpRequest<VehicleResponse>(
        `/api/drivers/${encodeURIComponent(driverId)}/vehicles`,
        { method: "POST", body: req },
      );
    },

    listVehicles(driverId: string): Promise<VehicleResponse[]> {
      return httpRequest<VehicleResponse[]>(
        `/api/drivers/${encodeURIComponent(driverId)}/vehicles`,
      );
    },

    changeStatus(driverId: string, status: DriverStatus): Promise<DriverResponse> {
      // Status is passed as a query param on the path (matches the controller's
      // `@RequestParam DriverStatus status`).
      return httpRequest<DriverResponse>(
        `/api/drivers/${encodeURIComponent(driverId)}/status?status=${encodeURIComponent(
          status,
        )}`,
        { method: "PATCH" },
      );
    },

    getVehicle(id: string): Promise<VehicleResponse> {
      return httpRequest<VehicleResponse>(`/api/vehicles/${encodeURIComponent(id)}`);
    },
  };
}
