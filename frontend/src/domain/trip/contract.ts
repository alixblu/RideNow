/**
 * Trip domain contract — the single documented shape the Mock_Client implements today
 * and a future Live_Client must match without any screen change (Req 9.5). Screens
 * depend only on this interface and these types, never on which implementation is
 * active, so swapping mock → live is a configuration change (Req 4.1, 4.3).
 *
 * The trip domain is STUBBED: no trip-service exists yet, so there is only a
 * `Mock_Client` behind this documented future contract. The request/response types
 * are drawn from the DBML `trips` table (design: "Typed models and DTOs") and
 * deliberately exclude live-location and real-time fields (Req 9.6): the DBML's
 * address strings, accepted/arrived/started/completed/cancelled timestamps, and the
 * JPA `version` column are not part of this contract.
 *
 * Field mapping from the DBML `trips` table:
 *   - id                 ← id (uuid)
 *   - passengerId        ← passenger_id (uuid)
 *   - driverId           ← driver_id (uuid, nullable until assigned)
 *   - vehicleId          ← vehicle_id (uuid, nullable until assigned)
 *   - rideType           ← ride_type (MOTORBIKE | CAR)
 *   - status             ← status (Trip_Status set)
 *   - pickupLat/Lng      ← pickup_lat / pickup_lng (decimal → JSON number)
 *   - destinationLat/Lng ← destination_lat / destination_lng (decimal → JSON number)
 *   - estimatedFare      ← estimated_fare (decimal, nullable)
 *   - finalFare          ← final_fare (decimal, nullable)
 *   - cancellationReason ← cancellation_reason (varchar, nullable)
 *   - requestedAt        ← requested_at (timestamp → ISO-8601 string)
 *   - createdAt          ← created_at (timestamp → ISO-8601 string)
 *   - updatedAt          ← updated_at (timestamp → ISO-8601 string)
 */
import type { TripStatus, VehicleType } from "../../shared/enums";

// ---------------------------------------------------------------------------
// Request types — only the facts a rider supplies; the server owns the rest.
// ---------------------------------------------------------------------------

/** Body for requesting a trip (pickup/destination coordinates + ride type, Req 9.1). */
export interface CreateTripRequest {
  passengerId: string;
  rideType: VehicleType;
  pickupLat: number;
  pickupLng: number;
  destinationLat: number;
  destinationLng: number;
}

// ---------------------------------------------------------------------------
// Response types — field names and types match the DBML trips table (sans
// live-location/real-time fields).
// ---------------------------------------------------------------------------

/** A trip returned by the trip Service_Client (drawn from the DBML `trips` table). */
export interface TripResponse {
  id: string;
  passengerId: string;
  /** Cross-service id; null until a driver is assigned. */
  driverId: string | null;
  /** Cross-service id; null until a vehicle is assigned. */
  vehicleId: string | null;
  rideType: VehicleType;
  status: TripStatus;
  pickupLat: number;
  pickupLng: number;
  destinationLat: number;
  destinationLng: number;
  /** decimal → JSON number, nullable per DBML. */
  estimatedFare: number | null;
  /** decimal → JSON number, nullable per DBML. */
  finalFare: number | null;
  /** varchar, nullable; set when the trip is cancelled. */
  cancellationReason: string | null;
  /** timestamp → ISO-8601 string. */
  requestedAt: string;
  /** timestamp → ISO-8601 string. */
  createdAt: string;
  /** timestamp → ISO-8601 string. */
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Service_Client contract — identical for the Mock_Client and a future Live_Client.
// ---------------------------------------------------------------------------

export interface TripServiceClient {
  /**
   * Request a new trip. The created trip starts with Trip_Status REQUESTED and echoes
   * the submitted coordinates and ride type; driverId/vehicleId and both fares are
   * null until later lifecycle steps assign them (Req 9.1).
   */
  requestTrip(req: CreateTripRequest): Promise<TripResponse>;
  /** Read a trip by id → `TripResponse` (missing id → ApiError.notFound, Req 9.3). */
  getTrip(id: string): Promise<TripResponse>;
  /** Cancel a trip → the trip with Trip_Status CANCELLED (Req 9.4). */
  cancelTrip(id: string): Promise<TripResponse>;
}
