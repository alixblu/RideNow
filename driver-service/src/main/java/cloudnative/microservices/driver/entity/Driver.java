package cloudnative.microservices.driver.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Entity
@Table(name = "drivers")
@Getter
@NoArgsConstructor
public class Driver {

    @Id
    private UUID id;

    @Column(name = "user_id", nullable = false, unique = true)
    private UUID userId;

    @Column(name = "license_number", nullable = false, unique = true)
    private String licenseNumber;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private DriverStatus status;

    @Column(name = "average_rating", precision = 3, scale = 2)
    private BigDecimal averageRating;

    @Column(name = "total_trips", nullable = false)
    private long totalTrips;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    /**
     * Creates a brand-new driver profile with server-owned defaults:
     * status ACTIVE, zero trips, no rating yet, timestamps set to now.
     * The service is the only caller; this keeps "how a driver is born"
     * in one place instead of scattered setters.
     */
    public Driver(UUID id, UUID userId, String licenseNumber, Instant now) {
        this.id = id;
        this.userId = userId;
        this.licenseNumber = licenseNumber;
        this.status = DriverStatus.ACTIVE;
        this.averageRating = null;
        this.totalTrips = 0L;
        this.createdAt = now;
        this.updatedAt = now;
    }
}
