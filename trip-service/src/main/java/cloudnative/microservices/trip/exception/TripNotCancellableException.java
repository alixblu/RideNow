package cloudnative.microservices.trip.exception;

import cloudnative.microservices.trip.entity.TripStatus;
import java.util.UUID;

/**
 * Thrown when a trip cannot be cancelled because it has already reached a
 * terminal state (completed or already cancelled). Surfaced as HTTP 409 Conflict.
 */
public class TripNotCancellableException extends RuntimeException {

    public TripNotCancellableException(UUID tripId, TripStatus currentStatus) {
        super("Trip " + tripId + " cannot be cancelled (status=" + currentStatus + ")");
    }
}
