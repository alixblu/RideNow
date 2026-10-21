/**
 * Trip domain contract — the single documented shape both the Live_Client and the
 * Mock_Client implement (Req 4.1, 4.3, 9.5). Screens depend only on this interface and
 * these types, never on which implementation is active, so swapping mock → live is a
 * configuration change.
 *
 * Request/response types mirror the real trip-service Java records exactly (design:
 * "Typed models and DTOs"):
 *   - CreateTripRequest ← `CreateTripRequest.java`
 *   - TripResponse      ← `TripResponse.java` (record)
 *
 * All IDs are UUID strings; timestamps are ISO-8601 strings (Jackson serializes
 * `Instant` as ISO-8601); lat/lng/fare values are `BigDecimal` serialized as JSON
 * numbers, so they stay `number` here. Real trips are created already in status
 * SEARCHING (the trip-service immediately begins matching), not REQUESTED.
 */
import type { Page } from "../../shared/page";
import type { TripStatus, VehicleType } from "../../shared/enums";

export type { Page } from "../../shared/page";

// ---------------------------------------------------------------------------
// Request types — only the facts a rider supplies; the server owns the rest.
// ---------------------------------------------------------------------------

/** Body for `POST /api/trips` (mirrors the Java `CreateTripRequest` record). */
export interface CreateTripRequest {
  passengerId: string;
  rideType: VehicleType;
  pickupLat: number;
  pickupLng: number;
  destinationLat: number;
  destinationLng: number;
}

// ---------------------------------------------------------------------------
// Response types — field names and types match the Java `TripResponse` record.
// ---------------------------------------------------------------------------

/** A trip returned by the trip Service_Client (mirrors the `TripResponse` record). */
export interface TripResponse {
  id: string;
  passengerId: string;
  /** Cross-service id; null until a driver is assigned. */
  driverId: string | null;
  /** Cross-service id; null until a vehicle is assigned. */
  vehicleId: string | null;
  rideType: VehicleType;
  /** BigDecimal → JSON number. */
  pickupLat: number;
  /** BigDecimal → JSON number. */
  pickupLng: number;
  /** varchar, nullable. */
  pickupAddress: string | null;
  /** BigDecimal → JSON number. */
  destinationLat: number;
  /** BigDecimal → JSON number. */
  destinationLng: number;
  /** varchar, nullable. */
  destinationAddress: string | null;
  status: TripStatus;
  /** BigDecimal → JSON number, nullable. */
  estimatedFare: number | null;
  /** BigDecimal → JSON number, nullable. */
  finalFare: number | null;
  /** varchar, nullable; set when the trip is cancelled. */
  cancellationReason: string | null;
  /** JPA optimistic-lock version (long). */
  version: number;
  /** timestamp → ISO-8601 string. */
  requestedAt: string;
  /** timestamp → ISO-8601 string, null until a driver accepts. */
  acceptedAt: string | null;
  /** timestamp → ISO-8601 string, null until the driver arrives. */
  arrivedAt: string | null;
  /** timestamp → ISO-8601 string, null until the trip starts. */
  startedAt: string | null;
  /** timestamp → ISO-8601 string, null until the trip completes. */
  completedAt: string | null;
  /** timestamp → ISO-8601 string, null unless the trip is cancelled. */
  cancelledAt: string | null;
  /** timestamp → ISO-8601 string. */
  createdAt: string;
  /** timestamp → ISO-8601 string. */
  updatedAt: string;
}

/** Query parameters for listing trips (`GET /api/trips`). */
export interface ListTripsParams {
  passengerId?: string;
  status?: TripStatus;
  limit?: number;
  offset?: number;
}

// ---------------------------------------------------------------------------
// Service_Client contract — identical for the Mock_Client and the Live_Client.
// ---------------------------------------------------------------------------

export interface TripServiceClient {
  /**
   * Request a new trip. The created trip starts with Trip_Status SEARCHING (the
   * trip-service immediately begins matching) and echoes the submitted coordinates and
   * ride type; driverId/vehicleId and both fares are null until later lifecycle steps
   * assign them (Req 9.1).
   */
  requestTrip(req: CreateTripRequest): Promise<TripResponse>;
  /** Read a trip by id → `TripResponse` (missing id → ApiError.notFound, Req 9.3). */
  getTrip(id: string): Promise<TripResponse>;
  /** Cancel a trip → the trip with Trip_Status CANCELLED (Req 9.4). */
  cancelTrip(id: string): Promise<TripResponse>;
  /** A driver accepts a trip → the trip with driverId set and status DRIVER_ASSIGNED. */
  acceptTrip(id: string, driverId: string): Promise<TripResponse>;
  /** List trips, filtered/paginated, as a `Page<TripResponse>`. */
  listTrips(params: ListTripsParams): Promise<Page<TripResponse>>;
}
