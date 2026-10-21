/**
 * Trip Mock_Client — the in-memory implementation of `TripServiceClient` (Req 9.1–9.4).
 *
 * It implements the exact same contract as the Live_Client, returning objects that
 * satisfy `TripResponse`, so rider screens render identically regardless of mode.
 *
 * State lives in a per-client `Map<string, TripResponse>` seeded empty, so each
 * resolved client is isolated and deterministic. `requestTrip` mints a UUID and stores
 * a SEARCHING trip echoing the request; `getTrip` reads it back or throws
 * `ApiError.notFound`; `acceptTrip` assigns a driver and moves it to DRIVER_ASSIGNED;
 * `cancelTrip` flips it to CANCELLED (conflict if already COMPLETED/CANCELLED);
 * `listTrips` filters, sorts, and windows the store into a `Page`.
 */
import { ApiError } from "../../http/ApiError";
import type { Page } from "../../shared/page";
import type {
  CreateTripRequest,
  ListTripsParams,
  TripResponse,
  TripServiceClient,
} from "./contract";

/** Default/maximum window sizes for listTrips, mirroring the backend list semantics. */
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * Build a trip `Mock_Client` backed by a fresh, empty in-memory store.
 *
 * Returned as a factory (not a singleton) to match the client-factory pattern and to
 * keep each resolved client's store isolated.
 */
export function createTripMockClient(): TripServiceClient {
  const store = new Map<string, TripResponse>();

  return {
    requestTrip(req: CreateTripRequest): Promise<TripResponse> {
      const now = new Date().toISOString();
      const trip: TripResponse = {
        id: crypto.randomUUID(),
        passengerId: req.passengerId,
        // No driver/vehicle assigned at request time.
        driverId: null,
        vehicleId: null,
        rideType: req.rideType,
        // Echo the submitted coordinates unchanged.
        pickupLat: req.pickupLat,
        pickupLng: req.pickupLng,
        pickupAddress: null,
        destinationLat: req.destinationLat,
        destinationLng: req.destinationLng,
        destinationAddress: null,
        // A new trip starts SEARCHING (the trip-service begins matching, Req 9.1).
        status: "SEARCHING",
        // Fares are not known at request time.
        estimatedFare: null,
        finalFare: null,
        cancellationReason: null,
        version: 0,
        requestedAt: now,
        acceptedAt: null,
        arrivedAt: null,
        startedAt: null,
        completedAt: null,
        cancelledAt: null,
        createdAt: now,
        updatedAt: now,
      };
      store.set(trip.id, trip);
      return Promise.resolve(trip);
    },

    getTrip(id: string): Promise<TripResponse> {
      const trip = store.get(id);
      if (!trip) {
        return Promise.reject(ApiError.notFound("The requested trip could not be found."));
      }
      return Promise.resolve(trip);
    },

    acceptTrip(id: string, driverId: string): Promise<TripResponse> {
      const existing = store.get(id);
      if (!existing) {
        return Promise.reject(ApiError.notFound("The requested trip could not be found."));
      }
      const now = new Date().toISOString();
      const accepted: TripResponse = {
        ...existing,
        driverId,
        status: "DRIVER_ASSIGNED",
        acceptedAt: now,
        version: existing.version + 1,
        updatedAt: now,
      };
      store.set(id, accepted);
      return Promise.resolve(accepted);
    },

    cancelTrip(id: string): Promise<TripResponse> {
      const existing = store.get(id);
      if (!existing) {
        return Promise.reject(ApiError.notFound("The requested trip could not be found."));
      }
      if (existing.status === "COMPLETED" || existing.status === "CANCELLED") {
        return Promise.reject(
          ApiError.conflict("This trip can no longer be cancelled."),
        );
      }
      const now = new Date().toISOString();
      const cancelled: TripResponse = {
        ...existing,
        status: "CANCELLED",
        cancellationReason: "Cancelled by rider",
        cancelledAt: now,
        version: existing.version + 1,
        updatedAt: now,
      };
      store.set(id, cancelled);
      return Promise.resolve(cancelled);
    },

    listTrips(params: ListTripsParams): Promise<Page<TripResponse>> {
      const limit = Math.min(
        Math.max(params.limit ?? DEFAULT_LIMIT, 0),
        MAX_LIMIT,
      );
      const offset = Math.max(params.offset ?? 0, 0);

      const matched = [...store.values()]
        .filter((trip) => {
          if (params.passengerId !== undefined && trip.passengerId !== params.passengerId) {
            return false;
          }
          if (params.status !== undefined && trip.status !== params.status) {
            return false;
          }
          return true;
        })
        // Most recently requested first.
        .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));

      const items = matched.slice(offset, offset + limit);
      return Promise.resolve({ items, total: matched.length, limit, offset });
    },
  };
}
