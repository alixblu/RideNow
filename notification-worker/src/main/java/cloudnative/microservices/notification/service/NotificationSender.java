package cloudnative.microservices.notification.service;

/**
 * The seam to the actual notification channel (push/SMS/email). Locally this is
 * a simulated sender that logs; a real provider implements the same interface
 * later with no change to the consumer or idempotency logic.
 */
public interface NotificationSender {

    /**
     * Delivers a notification for the given event. Throwing signals a transient
     * failure so the message is retried (and eventually dead-lettered).
     */
    void send(String eventType, String aggregateId, String summary);
}
