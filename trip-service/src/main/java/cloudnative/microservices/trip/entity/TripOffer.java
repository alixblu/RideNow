package cloudnative.microservices.trip.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Entity
@Table(name = "trip_offers", uniqueConstraints = @UniqueConstraint(columnNames = {"trip_id", "driver_id"}), indexes = {
        @Index(name = "idx_trip_offers_trip_id", columnList = "trip_id"),
        @Index(name = "idx_trip_offers_driver_id", columnList = "driver_id"),
        @Index(name = "idx_trip_offers_status", columnList = "status"),
        @Index(name = "idx_trip_offers_expires_at", columnList = "expires_at")
})
@Getter
@NoArgsConstructor
public class TripOffer {

    @Id
    private UUID id;

    @Column(name = "trip_id", nullable = false)
    private UUID tripId;

    @Column(name = "driver_id", nullable = false)
    private UUID driverId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private TripOfferStatus status;

    @Column(name = "distance_meters")
    private Integer distanceMeters;

    @Column(name = "offered_at", nullable = false)
    private Instant offeredAt;

    @Column(name = "responded_at")
    private Instant respondedAt;

    @Column(name = "expires_at")
    private Instant expiresAt;
}
