/**
 * Trip Mock_Client — the in-memory implementation of `TripServiceClient` (Req 9.1–9.4).
 *
 * The trip domain is STUBBED: there is no trip-service yet, so this mock stands in
 * behind the documented future contract and returns data that conforms to it exactly,
 * letting rider screens render as they will against a real Live_Client (Req 4.4, 9.5).
 *
 * State lives in a per-client `Map<string, TripResponse>` seeded empty, so each
 * resolved client is isolated and deterministic. `requestTrip` mints a UUID, stores a
 * REQUESTED trip echoing the request, and returns it; `getTrip` reads it back or
 * throws `ApiError.notFound`; `cancelTrip` flips the stored status to CANCELLED.
 */
import { ApiError } from "../../http/ApiError";
import type {
  CreateTripRequest,
  TripResponse,
  TripServiceClient,
} from "./contract";

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
        // A new trip always starts REQUESTED (Req 9.1).
        status: "REQUESTED",
        // Echo the submitted coordinates unchanged.
        pickupLat: req.pickupLat,
        pickupLng: req.pickupLng,
        destinationLat: req.destinationLat,
        destinationLng: req.destinationLng,
        // Fares are not known at request time.
        estimatedFare: null,
        finalFare: null,
        cancellationReason: null,
        requestedAt: now,
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

    cancelTrip(id: string): Promise<TripResponse> {
      const existing = store.get(id);
      if (!existing) {
        return Promise.reject(ApiError.notFound("The requested trip could not be found."));
      }
      const cancelled: TripResponse = {
        ...existing,
        status: "CANCELLED",
        updatedAt: new Date().toISOString(),
      };
      store.set(id, cancelled);
      return Promise.resolve(cancelled);
    },
  };
}
