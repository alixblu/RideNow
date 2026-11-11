package cloudnative.microservices.matching.event;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

/**
 * A domain event emitted by matching-service when it offers a trip to a driver.
 *
 * Small, self-contained contract (no shared cross-service module): the envelope
 * carries identity and timing, and {@code data} carries the event-specific key
 * fields as scalar strings for clean JSON on EventBridge.
 *
 * <ul>
 *   <li>{@code eventId}    - unique id; consumers use it for idempotency.</li>
 *   <li>{@code type}       - e.g. {@code match.offered}; the EventBridge DetailType.</li>
 *   <li>{@code version}    - contract version.</li>
 *   <li>{@code occurredAt} - when the change happened.</li>
 *   <li>{@code aggregateId}- the offer id this event is about.</li>
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
    /** The EventBridge Source for every matching-service event. */
    public static final String SOURCE = "ridenow.matching";

    private static final int CURRENT_VERSION = 1;

    public static DomainEvent of(String type, UUID aggregateId, Map<String, String> data) {
        return new DomainEvent(UUID.randomUUID(), type, CURRENT_VERSION, Instant.now(), aggregateId, data);
    }
}
