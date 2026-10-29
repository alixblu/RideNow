package cloudnative.microservices.trip.exception;

import cloudnative.microservices.trip.entity.TripStatus;
import java.util.UUID;

/**
 * Thrown when a trip lifecycle transition is not legal from the current status
 * (e.g. trying to START a trip that has not been accepted). Surfaced as HTTP 409
 * Conflict - the request is well-formed but conflicts with the trip's state.
 */
public class TripTransitionException extends RuntimeException {

    public TripTransitionException(UUID tripId, TripStatus currentStatus, String attemptedTransition) {
        super("Trip " + tripId + " cannot be " + attemptedTransition
                + " (status=" + currentStatus + ")");
    }
}
