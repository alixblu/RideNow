/**
 * Vehicle Live_Client — maps the `VehicleServiceClient` contract onto driver-service
 * HTTP endpoints through the shared `httpRequest` wrapper (Req 6.1, 6.4, 6.5).
 *
 * Every call delegates to `httpRequest`, so URL resolution (gateway vs Path_Prefix_Map),
 * principal attachment, and error normalization all happen in one place — this module
 * only builds the documented path, method, and (for creates) the JSON body. Because
 * vehicles are a driver-service resource, the paths hang off `/api/drivers` and
 * `/api/vehicles`, both of which the Path_Prefix_Map routes to the driver-service origin.
 */
import { httpRequest } from "../../http/httpClient";
import type {
  CreateVehicleRequest,
  VehicleResponse,
  VehicleServiceClient,
} from "./contract";

/**
 * Build the Live_Client. The returned object implements `VehicleServiceClient`, so the
 * factory and screens cannot tell it apart from the Mock_Client.
 */
export function createVehicleLiveClient(): VehicleServiceClient {
  return {
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

    getVehicle(id: string): Promise<VehicleResponse> {
      return httpRequest<VehicleResponse>(
        `/api/vehicles/${encodeURIComponent(id)}`,
      );
    },
  };
}
