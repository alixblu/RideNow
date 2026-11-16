package cloudnative.microservices.notification.service;

import cloudnative.microservices.notification.dto.IncomingEvent;
import cloudnative.microservices.notification.dto.NotificationMessage;
import cloudnative.microservices.notification.entity.ProcessedNotification;
import cloudnative.microservices.notification.repository.ProcessedNotificationRepository;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Handles one domain event: update the live-tracking pairing, work out who to
 * tell, send each of them the notification, then record the event id so a
 * duplicate SQS delivery is a no-op.
 *
 * Each "send" writes an inbox row, and the ledger row is saved in the same
 * transaction. If any send throws, nothing is committed (no inbox row, no ledger
 * row) and the whole event is retried. If the ledger row already exists, we skip
 * entirely, and the unique (event_id, user_id) on the inbox is a second guard.
 */
@Service
@RequiredArgsConstructor
public class NotificationService {

    private static final Logger log = LoggerFactory.getLogger(NotificationService.class);

    private final ProcessedNotificationRepository processedRepository;
    private final NotificationSender sender;
    private final RecipientResolver recipientResolver;
    private final TrackingPairingService trackingPairing;

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

        // Live-tracking pairing (who may watch whom). Naturally idempotent, so safe on retry.
        trackingPairing.apply(event);
        List<UUID> recipients = recipientResolver.recipients(event);
        if (recipients.isEmpty()) {
            log.info("No recipient for {} eventId={}; nothing to send", event.type(), event.eventId());
        }
        String summary = summarize(event);
        String tripId = event.data() != null ? event.data().get("tripId") : null;
        for (UUID recipient : recipients) {
            sender.send(new NotificationMessage(
                    event.eventId(), recipient, event.type(), summary, tripId, event.occurredAt()));
        }

        processedRepository.save(new ProcessedNotification(
                event.eventId(), event.type(), event.aggregateId(), Instant.now()));
        return true;
    }

    private String summarize(IncomingEvent event) {
        return switch (event.type()) {
            case "trip.requested" -> "Looking for a driver near you.";
            case "match.offered" -> "New ride request near you.";
            case "driver.accepted" -> "A driver has accepted your trip.";
            case "driver.arrived" -> "Your driver has arrived at the pickup point.";
            case "trip.started" -> "Your trip has started.";
            case "trip.completed" -> "Your trip is complete.";
            case "trip.cancelled" -> "Your trip was cancelled.";
            case "payment.succeeded" -> "Your payment was successful.";
            case "payment.failed" -> "Your payment failed.";
            default -> "Update: " + event.type();
        };
    }
}
