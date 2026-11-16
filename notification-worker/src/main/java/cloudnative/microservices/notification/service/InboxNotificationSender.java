package cloudnative.microservices.notification.service;

import cloudnative.microservices.notification.dto.NotificationMessage;
import cloudnative.microservices.notification.entity.Notification;
import cloudnative.microservices.notification.repository.NotificationRepository;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * Delivers a notification by writing it to the user's inbox. It runs inside the
 * event's transaction (see {@link NotificationService#handle}), so the inbox row
 * and the processed-event ledger row commit or roll back together.
 */
@Component
@RequiredArgsConstructor
public class InboxNotificationSender implements NotificationSender {

    private static final Logger log = LoggerFactory.getLogger(InboxNotificationSender.class);

    private final NotificationRepository repository;

    @Override
    public void send(NotificationMessage message) {
        // Microsecond precision: that is what Postgres stores, so the keyset cursor
        // compares equal values.
        Instant now = Instant.now().truncatedTo(ChronoUnit.MICROS);
        repository.save(new Notification(
                UUID.randomUUID(),
                message.userId(),
                message.eventId(),
                message.type(),
                message.message(),
                parseUuid(message.tripId()),
                parseInstant(message.occurredAt()),
                now));
    }

    private static UUID parseUuid(String value) {
        if (value == null) {
            return null;
        }
        try {
            return UUID.fromString(value);
        } catch (IllegalArgumentException e) {
            log.warn("Ignoring tripId that is not a UUID: {}", value);
            return null;
        }
    }

    private static Instant parseInstant(String value) {
        if (value == null) {
            return null;
        }
        try {
            return Instant.parse(value);
        } catch (java.time.format.DateTimeParseException e) {
            log.warn("Ignoring occurredAt that is not ISO-8601: {}", value);
            return null;
        }
    }
}
