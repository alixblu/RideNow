/**
 * Trip Live_Client — the real-HTTP implementation of `TripServiceClient`.
 *
 * Every operation maps one-to-one to a trip-service endpoint and goes through
 * `httpRequest`, so URL resolution (gateway vs Path_Prefix_Map), principal attachment,
 * and error normalization stay centralized in the http layer. This client only knows
 * paths, methods, and bodies — never how a URL is resolved or how an error becomes an
 * `ApiError`.
 *
 * Paths use the documented `/api/trips` prefix that the Path_Prefix_Map routes to
 * trip-service. Caller-supplied identifiers and query values are URL-encoded.
 */
import { httpRequest } from "../../http/httpClient";
import type { Page } from "../../shared/page";
import type {
  CreateTripRequest,
  ListTripsParams,
  TripResponse,
  TripServiceClientExt,
} from "./contract";
import { createTripMockClient } from "./mockClient";

const TRIPS_PATH = "/api/trips";

/** Build a query string from the list params, omitting undefined values. */
function buildTripsQuery(params: ListTripsParams): string {
  const query = new URLSearchParams();
  if (params.passengerId !== undefined) {
    query.set("passengerId", params.passengerId);
  }
  if (params.status !== undefined) {
    query.set("status", params.status);
  }
  if (params.limit !== undefined) {
    query.set("limit", String(params.limit));
  }
  if (params.offset !== undefined) {
    query.set("offset", String(params.offset));
  }
  const qs = query.toString();
  return qs.length > 0 ? `?${qs}` : "";
}

/**
 * Build the trip-service `Live_Client`.
 *
 * Returned as a factory (not a singleton) to match the client-factory pattern: the
 * generic `resolveClient` only invokes this thunk when the trip domain is configured
 * `live`.
 */
export function createTripLiveClient(): TripServiceClientExt {
  // No backend endpoint for estimates, history, ratings or earnings: delegate to the mock.
  const mock = createTripMockClient();
  return {
    estimateFares: (req) => mock.estimateFares(req),
    listTripHistory: (params) => mock.listTripHistory(params),
    rateTrip: (tripId, stars) => mock.rateTrip(tripId, stars),
    getEarnings: (driverId) => mock.getEarnings(driverId),
    requestTrip(req: CreateTripRequest): Promise<TripResponse> {
      // The body carries the optional pickupAddress/destinationAddress when present.
      const body: CreateTripRequest = { ...req };
      if (req.pickupAddress === undefined) delete body.pickupAddress;
      if (req.destinationAddress === undefined) delete body.destinationAddress;
      return httpRequest<TripResponse>(TRIPS_PATH, { method: "POST", body });
    },

    getTrip(id: string): Promise<TripResponse> {
      return httpRequest<TripResponse>(`${TRIPS_PATH}/${encodeURIComponent(id)}`);
    },

    cancelTrip(id: string): Promise<TripResponse> {
      return httpRequest<TripResponse>(
        `${TRIPS_PATH}/${encodeURIComponent(id)}/cancel`,
        { method: "POST" },
      );
    },

    acceptTrip(id: string, driverId: string): Promise<TripResponse> {
      return httpRequest<TripResponse>(
        `${TRIPS_PATH}/${encodeURIComponent(id)}/accept?driverId=${encodeURIComponent(
          driverId,
        )}`,
        { method: "POST" },
      );
    },

    arriveTrip(id: string): Promise<TripResponse> {
      return httpRequest<TripResponse>(`${TRIPS_PATH}/${encodeURIComponent(id)}/arrive`, {
        method: "POST",
      });
    },
    startTrip(id: string): Promise<TripResponse> {
      return httpRequest<TripResponse>(`${TRIPS_PATH}/${encodeURIComponent(id)}/start`, {
        method: "POST",
      });
    },
    completeTrip(id: string): Promise<TripResponse> {
      return httpRequest<TripResponse>(`${TRIPS_PATH}/${encodeURIComponent(id)}/complete`, {
        method: "POST",
      });
    },
    listTrips(params: ListTripsParams): Promise<Page<TripResponse>> {
      return httpRequest<Page<TripResponse>>(`${TRIPS_PATH}${buildTripsQuery(params)}`);
    },
  };
}
