package cloudnative.microservices.notification.dto;

import cloudnative.microservices.notification.entity.Notification;
import java.time.Instant;
import java.util.UUID;

/** One inbox item as the API returns it. */
public record NotificationResponse(
        UUID id,
        UUID userId,
        String type,
        String message,
        UUID tripId,
        Instant occurredAt,
        Instant createdAt,
        Instant readAt
) {
    public static NotificationResponse from(Notification n) {
        return new NotificationResponse(n.getId(), n.getUserId(), n.getType(), n.getMessage(),
                n.getTripId(), n.getOccurredAt(), n.getCreatedAt(), n.getReadAt());
    }
}
