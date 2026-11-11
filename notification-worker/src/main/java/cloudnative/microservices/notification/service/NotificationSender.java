package cloudnative.microservices.notification.service;

import cloudnative.microservices.notification.dto.Notification;

/**
 * The seam to the actual notification channel. Locally this is a simulated sender
 * that logs; {@link RedisNotificationSender} hands notifications to the
 * realtime-gateway (WebSocket). Other channels (push/SMS/email) would implement
 * the same interface with no change to the consumer or idempotency logic.
 */
public interface NotificationSender {

    /**
     * Delivers one notification to one recipient. Throwing signals a transient
     * failure so the SQS message is retried (and eventually dead-lettered).
     */
    void send(Notification notification);
}
