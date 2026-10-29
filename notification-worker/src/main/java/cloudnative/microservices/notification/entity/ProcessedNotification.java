package cloudnative.microservices.notification.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;

/**
 * The idempotency ledger: one row per domain event this worker has already
 * handled, keyed by the event's own id. Before "sending" a notification the
 * worker checks for the row; a duplicate SQS delivery (at-least-once) finds the
 * row and is a no-op, so no passenger is notified twice.
 */
@Entity
@Table(name = "processed_notifications")
@Getter
@NoArgsConstructor
public class ProcessedNotification {

    /** The source event id (DomainEvent.eventId) - the idempotency key. */
    @Id
    @Column(name = "event_id")
    private UUID eventId;

    @Column(name = "event_type", nullable = false)
    private String eventType;

    @Column(name = "aggregate_id")
    private UUID aggregateId;

    @Column(name = "processed_at", nullable = false)
    private Instant processedAt;

    public ProcessedNotification(UUID eventId, String eventType, UUID aggregateId, Instant processedAt) {
        this.eventId = eventId;
        this.eventType = eventType;
        this.aggregateId = aggregateId;
        this.processedAt = processedAt;
    }
}
