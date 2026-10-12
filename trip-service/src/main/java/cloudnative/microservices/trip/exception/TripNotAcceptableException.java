package cloudnative.microservices.trip.exception;

import cloudnative.microservices.trip.entity.TripStatus;
import java.util.UUID;

/**
 * Thrown when a driver tries to accept a trip that is no longer available
 * (already assigned, cancelled, etc.). Surfaced as HTTP 409 Conflict.
 */
public class TripNotAcceptableException extends RuntimeException {

    public TripNotAcceptableException(UUID tripId, TripStatus currentStatus) {
        super("Trip " + tripId + " is no longer available (status=" + currentStatus + ")");
    }
}