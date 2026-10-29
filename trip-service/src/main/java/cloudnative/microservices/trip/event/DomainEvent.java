package cloudnative.microservices.trip.event;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

/**
 * A domain event emitted by trip-service when a trip's lifecycle changes.
 *
 * This is a small, self-contained contract (no shared cross-service module, per
 * the service-boundary rules): the envelope carries identity and timing, and
 * {@code data} carries the event-specific key fields as scalar strings so the
 * payload serializes cleanly to JSON for EventBridge and stays loosely coupled.
 *
 * <ul>
 *   <li>{@code eventId}    - unique id; consumers use it for idempotency.</li>
 *   <li>{@code type}       - e.g. {@code trip.completed}; the EventBridge DetailType.</li>
 *   <li>{@code version}    - contract version, so the shape can evolve safely.</li>
 *   <li>{@code occurredAt} - when the change happened.</li>
 *   <li>{@code aggregateId}- the trip id this event is about.</li>
 *   <li>{@code data}       - flat key/value detail (tripId, driverId, ...).</li>
 * </ul>
 */
public record DomainEvent(
        UUID eventId,
        String type,
        int version,
        Instant occurredAt,
        UUID aggregateId,
        Map<String, String> data
) {
    /** The EventBridge Source for every trip-service event. */
    public static final String SOURCE = "ridenow.trip";

    private static final int CURRENT_VERSION = 1;

    /** Builds an event with a fresh id, the current contract version, and now(). */
    public static DomainEvent of(String type, UUID aggregateId, Map<String, String> data) {
        return new DomainEvent(UUID.randomUUID(), type, CURRENT_VERSION, Instant.now(), aggregateId, data);
    }
}
