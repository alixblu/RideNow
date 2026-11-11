package cloudnative.microservices.realtime.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

/**
 * One notification as published by notification-worker on the Redis channel, and
 * as pushed to the client unchanged.
 *
 * {@code eventId} and {@code occurredAt} are what lets a client cope with the
 * fact that Redis Pub/Sub is at-most-once and can reorder across reconnects: drop
 * a message whose eventId it has already seen, and ignore one older than the
 * state it just fetched over REST.
 *
 * @param eventId    unique id of the originating domain event (client-side dedupe key)
 * @param userId     the recipient; becomes part of the topic, so it is validated as a UUID
 * @param type       the event type, e.g. {@code driver.accepted}
 * @param message    human-readable text to show
 * @param tripId     the trip this is about, when there is one
 * @param occurredAt ISO-8601 time the underlying change happened
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record GatewayMessage(
        String eventId,
        String userId,
        String type,
        String message,
        String tripId,
        String occurredAt
) {
}
