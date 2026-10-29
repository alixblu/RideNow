package cloudnative.microservices.trip.event;

import cloudnative.microservices.trip.entity.Trip;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Factory for the trip-service domain events. Keeping event construction in one
 * place means the JSON contract (field names, which fields each event carries)
 * lives next to its type constant and is easy to review.
 */
public final class TripEvents {

    public static final String DRIVER_ACCEPTED = "driver.accepted";
    public static final String DRIVER_ARRIVED = "driver.arrived";
    public static final String TRIP_COMPLETED = "trip.completed";
    public static final String TRIP_CANCELLED = "trip.cancelled";

    private TripEvents() {
    }

    public static DomainEvent driverAccepted(Trip trip) {
        return DomainEvent.of(DRIVER_ACCEPTED, trip.getId(), base(trip));
    }

    public static DomainEvent driverArrived(Trip trip) {
        return DomainEvent.of(DRIVER_ARRIVED, trip.getId(), base(trip));
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

    /** The common scalar fields every trip event carries. */
    private static Map<String, String> base(Trip trip) {
        Map<String, String> data = new LinkedHashMap<>();
        data.put("tripId", trip.getId().toString());
        data.put("passengerId", trip.getPassengerId().toString());
        if (trip.getDriverId() != null) {
            data.put("driverId", trip.getDriverId().toString());
        }
        data.put("status", trip.getStatus().name());
        return data;
    }
}
