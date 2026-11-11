package cloudnative.microservices.notification.service;

import cloudnative.microservices.notification.dto.Notification;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Simulated sender: logs "notification sent" instead of delivering it. Enough to
 * demonstrate the consumer, retries, and DLQ without an external dependency. A
 * plain class; {@link cloudnative.microservices.notification.config.NotificationSenderConfig}
 * registers it only when no other {@link NotificationSender} bean exists.
 */
public class LoggingNotificationSender implements NotificationSender {

    private static final Logger log = LoggerFactory.getLogger(LoggingNotificationSender.class);

    @Override
    public void send(Notification notification) {
        log.info("[notification sent] type={} user={} trip={} message={}",
                notification.type(), notification.userId(), notification.tripId(), notification.message());
    }
}
