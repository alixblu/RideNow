package cloudnative.microservices.notification.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

/**
 * One inbox row: a notification for one recipient. {@code userId} and
 * {@code tripId} are logical references to other services, stored as plain ids.
 */
@Entity
@Table(name = "notifications")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Notification {

    @Id
    private UUID id;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    /** The originating domain event; with userId it is unique. */
    @Column(name = "event_id", nullable = false)
    private UUID eventId;

    @Column(nullable = false)
    private String type;

    @Column(nullable = false)
    private String message;

    @Column(name = "trip_id")
    private UUID tripId;

    @Column(name = "occurred_at")
    private Instant occurredAt;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "read_at")
    private Instant readAt;

    public Notification(UUID id, UUID userId, UUID eventId, String type, String message,
                        UUID tripId, Instant occurredAt, Instant createdAt) {
        this.id = id;
        this.userId = userId;
        this.eventId = eventId;
        this.type = type;
        this.message = message;
        this.tripId = tripId;
        this.occurredAt = occurredAt;
        this.createdAt = createdAt;
    }

    /** Marks the row read. Idempotent: the first read time is kept. */
    public void markRead(Instant when) {
        if (readAt == null) {
            readAt = when;
        }
    }
}
