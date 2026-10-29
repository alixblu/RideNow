package cloudnative.microservices.notification.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Simulated sender: logs "notification sent" instead of calling a real provider.
 * Enough to demonstrate the consumer, retries, and DLQ without an external
 * dependency. A plain class; {@link cloudnative.microservices.notification.config.NotificationSenderConfig}
 * registers it only when no other {@link NotificationSender} bean exists, so a
 * real sender (or a test sender) cleanly replaces it.
 */
public class LoggingNotificationSender implements NotificationSender {

    private static final Logger log = LoggerFactory.getLogger(LoggingNotificationSender.class);

    @Override
    public void send(String eventType, String aggregateId, String summary) {
        log.info("[notification sent] type={} aggregateId={} summary={}", eventType, aggregateId, summary);
    }
}
