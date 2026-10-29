package cloudnative.microservices.matching.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;

/**
 * matching-service's own working copy of a candidate driver's last reported
 * position, fed by an explicit handoff from driver-service (NOT by reading
 * driver-service's store). Used by the LOCAL-FIRST "boring Postgres nearby query"
 * before matching moves to Redis GEO. One row per driver; upserted on each report.
 */
@Entity
@Table(name = "matching_driver_positions", indexes = {
        @Index(name = "idx_mdp_vehicle_type", columnList = "vehicle_type"),
        @Index(name = "idx_mdp_reported_at", columnList = "reported_at")
})
@Getter
@NoArgsConstructor
public class DriverPosition {

    @Id
    @Column(name = "driver_id")
    private UUID driverId;

    @Enumerated(EnumType.STRING)
    @Column(name = "vehicle_type", nullable = false)
    private VehicleType vehicleType;

    @Column(nullable = false, precision = 9, scale = 6)
    private BigDecimal lat;

    @Column(nullable = false, precision = 9, scale = 6)
    private BigDecimal lng;

    @Column(name = "reported_at", nullable = false)
    private Instant reportedAt;

    public DriverPosition(UUID driverId, VehicleType vehicleType, BigDecimal lat, BigDecimal lng, Instant reportedAt) {
        this.driverId = driverId;
        this.vehicleType = vehicleType;
        this.lat = lat;
        this.lng = lng;
        this.reportedAt = reportedAt;
    }

    /** Replaces the stored position with a newer report. */
    public void update(VehicleType vehicleType, BigDecimal lat, BigDecimal lng, Instant reportedAt) {
        this.vehicleType = vehicleType;
        this.lat = lat;
        this.lng = lng;
        this.reportedAt = reportedAt;
    }
}
