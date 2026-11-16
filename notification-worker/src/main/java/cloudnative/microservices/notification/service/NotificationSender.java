package cloudnative.microservices.notification.service;

import cloudnative.microservices.notification.dto.NotificationMessage;

/**
 * The seam to the actual notification channel. Today the only implementation is
 * {@link InboxNotificationSender}, which writes a durable inbox row that clients
 * read by polling. Other channels (push/SMS/email) would implement the same
 * interface with no change to the consumer or idempotency logic.
 */
public interface NotificationSender {

    /**
     * Delivers one notification to one recipient. Called inside the event
     */
    void send(NotificationMessage notification);
}
