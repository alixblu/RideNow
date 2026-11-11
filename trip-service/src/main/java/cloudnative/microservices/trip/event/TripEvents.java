package cloudnative.microservices.trip.event;

import cloudnative.microservices.trip.entity.Trip;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/**
 * Factory for the trip-service domain events. Keeping event construction in one
 * place means the JSON contract (field names, which fields each event carries)
 * lives next to its type constant and is easy to review.
 *
 * Every event carries the common fields (tripId, passengerId, driverId when
 * assigned, status, rideType, and the fares once known). {@code trip.requested}
 * additionally carries the pickup and destination coordinates, which is what
 * matching-service needs to find drivers.
 */
public final class TripEvents {

    public static final String TRIP_REQUESTED = "trip.requested";
    public static final String DRIVER_ACCEPTED = "driver.accepted";
    public static final String DRIVER_ARRIVED = "driver.arrived";
    public static final String TRIP_STARTED = "trip.started";
    public static final String TRIP_COMPLETED = "trip.completed";
    public static final String TRIP_CANCELLED = "trip.cancelled";

    private TripEvents() {
    }

    public static DomainEvent tripRequested(Trip trip) {
        Map<String, String> data = base(trip);
        data.put("pickupLat", trip.getPickupLat().toPlainString());
        data.put("pickupLng", trip.getPickupLng().toPlainString());
        data.put("destinationLat", trip.getDestinationLat().toPlainString());
        data.put("destinationLng", trip.getDestinationLng().toPlainString());
        return DomainEvent.of(TRIP_REQUESTED, trip.getId(), data);
    }

    public static DomainEvent driverAccepted(Trip trip) {
        return DomainEvent.of(DRIVER_ACCEPTED, trip.getId(), base(trip));
    }

    public static DomainEvent driverArrived(Trip trip) {
        return DomainEvent.of(DRIVER_ARRIVED, trip.getId(), base(trip));
    }

    public static DomainEvent tripStarted(Trip trip) {
        return DomainEvent.of(TRIP_STARTED, trip.getId(), base(trip));
    }

    public static DomainEvent tripCompleted(Trip trip) {
        return DomainEvent.of(TRIP_COMPLETED, trip.getId(), base(trip));
    }

    public static DomainEvent tripCancelled(Trip trip) {
        Map<String, String> data = base(trip);
        if (trip.getCancellationReason() != null) {
            data.put("cancellationReason", trip.getCancellationReason());
        }
        return DomainEvent.of(TRIP_CANCELLED, trip.getId(), data);
    }

    /**
     * Compensation for a trip that was never created: payment may already hold funds
     * for {@code tripId} (the authorize call succeeded, or timed out after reaching
     * payment-service) but no trip row exists. A {@code trip.cancelled} event makes
     * payment-service release that hold through its normal async path; if no hold
     * exists, the release is simply dropped.
     *
     * Deliberately carries NO passengerId: the passenger already got the failure
     * synchronously (the 402/503 on POST /trips), so notifications must not also
     * tell them "your trip was cancelled" for a trip they never saw. With no
     * recipient id, notification-worker sends nothing. {@code compensation=true}
     * marks the event for anyone reading logs or queues.
     */
    public static DomainEvent tripCreationFailed(UUID tripId, String reason) {
        Map<String, String> data = new LinkedHashMap<>();
        data.put("tripId", tripId.toString());
        data.put("status", "CANCELLED");
        data.put("cancellationReason", reason);
        data.put("compensation", "true");
        return DomainEvent.of(TRIP_CANCELLED, tripId, data);
    }

    /** The common scalar fields every trip event carries. */
    private static Map<String, String> base(Trip trip) {
        Map<String, String> data = new LinkedHashMap<>();
        data.put("tripId", trip.getId().toString());
        data.put("passengerId", trip.getPassengerId().toString());
        if (trip.getDriverId() != null) {
            data.put("driverId", trip.getDriverId().toString());
        }
        data.put("status", trip.getStatus().name());
        data.put("rideType", trip.getRideType().name());
        if (trip.getEstimatedFare() != null) {
            data.put("estimatedFare", trip.getEstimatedFare().toPlainString());
        }
        if (trip.getFinalFare() != null) {
            data.put("finalFare", trip.getFinalFare().toPlainString());
        }
        return data;
    }
}
