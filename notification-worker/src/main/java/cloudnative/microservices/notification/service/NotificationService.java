package cloudnative.microservices.notification.service;

import cloudnative.microservices.notification.dto.IncomingEvent;
import cloudnative.microservices.notification.entity.ProcessedNotification;
import cloudnative.microservices.notification.repository.ProcessedNotificationRepository;
import java.time.Instant;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Handles one domain event: send the notification exactly once, then record the
 * event id so a duplicate SQS delivery is a no-op.
 *
 * Order matters for at-least-once delivery: we "send" first, then persist the
 * ledger row in the same transaction. If sending throws, nothing is committed
 * and the message is retried. If the row already exists, we skip entirely.
 */
@Service
@RequiredArgsConstructor
public class NotificationService {

    private static final Logger log = LoggerFactory.getLogger(NotificationService.class);

    private final ProcessedNotificationRepository processedRepository;
    private final NotificationSender sender;

    /**
     * Processes an event idempotently.
     *
     * @return true if handled (or already handled); the caller may then delete
     *         the SQS message. Exceptions propagate so the message is retried.
     */
    @Transactional
    public boolean handle(IncomingEvent event) {
        if (event.eventId() == null || event.type() == null) {
            // Malformed/unexpected payload: drop it (do not retry forever).
            log.warn("Skipping event with missing id/type: {}", event);
            return true;
        }
        if (processedRepository.existsById(event.eventId())) {
            log.debug("Duplicate delivery for eventId={}, skipping", event.eventId());
            return true;
        }

        String summary = summarize(event);
        sender.send(event.type(), String.valueOf(event.aggregateId()), summary);

        processedRepository.save(new ProcessedNotification(
                event.eventId(), event.type(), event.aggregateId(), Instant.now()));
        return true;
    }

    private String summarize(IncomingEvent event) {
        return switch (event.type()) {
            case "driver.accepted" -> "A driver has accepted your trip.";
            case "driver.arrived" -> "Your driver has arrived at the pickup point.";
            case "trip.completed" -> "Your trip is complete.";
            case "trip.cancelled" -> "Your trip was cancelled.";
            case "payment.succeeded" -> "Your payment was successful.";
            case "payment.failed" -> "Your payment failed.";
            default -> "Update: " + event.type();
        };
    }
}
