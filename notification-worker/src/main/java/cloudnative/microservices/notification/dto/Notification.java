package cloudnative.microservices.notification.dto;

import java.util.UUID;

/**
 * One notification for one recipient, ready to hand to a {@code NotificationSender}.
 * An event with two recipients (e.g. a cancellation the passenger and the driver
 * both need to hear about) becomes two of these, sharing the same {@code eventId}
 * so a client can de-duplicate.
 *
 * @param eventId    the originating domain event's id (client-side dedupe key)
 * @param userId     who to tell
 * @param type       the event type, e.g. {@code driver.accepted}
 * @param message    human-readable text
 * @param tripId     the trip this is about, when known
 * @param occurredAt when the underlying change happened (ISO-8601), when known
 */
public record Notification(
        UUID eventId,
        UUID userId,
        String type,
        String message,
        String tripId,
        String occurredAt
) {
}
