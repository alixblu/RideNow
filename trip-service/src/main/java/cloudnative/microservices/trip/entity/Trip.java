package cloudnative.microservices.trip.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import cloudnative.microservices.trip.exception.TripNotAcceptableException;
import cloudnative.microservices.trip.exception.TripNotCancellableException;
import cloudnative.microservices.trip.exception.TripTransitionException;
import lombok.NoArgsConstructor;

@Entity
@Table(name = "trips", indexes = {
        @Index(name = "idx_trips_passenger_id", columnList = "passenger_id"),
        @Index(name = "idx_trips_driver_id", columnList = "driver_id"),
        @Index(name = "idx_trips_status", columnList = "status"),
        @Index(name = "idx_trips_requested_at", columnList = "requested_at"),
        @Index(name = "idx_trips_passenger_requested_at", columnList = "passenger_id, requested_at"),
        @Index(name = "idx_trips_driver_requested_at", columnList = "driver_id, requested_at")
})
@Getter
@NoArgsConstructor
public class Trip {

    @Id
    private UUID id;

    @Column(name = "passenger_id", nullable = false)
    private UUID passengerId;

    @Column(name = "driver_id")
    private UUID driverId;

    @Column(name = "vehicle_id")
    private UUID vehicleId;

    @Enumerated(EnumType.STRING)
    @Column(name = "ride_type", nullable = false)
    private RideType rideType;

    @Column(name = "pickup_lat", nullable = false, precision = 9, scale = 6)
    private BigDecimal pickupLat;

    @Column(name = "pickup_lng", nullable = false, precision = 9, scale = 6)
    private BigDecimal pickupLng;

    @Column(name = "pickup_address")
    private String pickupAddress;

    @Column(name = "destination_lat", nullable = false, precision = 9, scale = 6)
    private BigDecimal destinationLat;

    @Column(name = "destination_lng", nullable = false, precision = 9, scale = 6)
    private BigDecimal destinationLng;

    @Column(name = "destination_address")
    private String destinationAddress;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private TripStatus status;

    @Column(name = "estimated_fare", precision = 12, scale = 2)
    private BigDecimal estimatedFare;

    @Column(name = "final_fare", precision = 12, scale = 2)
    private BigDecimal finalFare;

    @Column(name = "cancellation_reason")
    private String cancellationReason;

    @Version
    @Column(nullable = false)
    private long version;

    @Column(name = "requested_at", nullable = false)
    private Instant requestedAt;

    @Column(name = "accepted_at")
    private Instant acceptedAt;

    @Column(name = "arrived_at")
    private Instant arrivedAt;

    @Column(name = "started_at")
    private Instant startedAt;

    @Column(name = "completed_at")
    private Instant completedAt;

    @Column(name = "cancelled_at")
    private Instant cancelledAt;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    /**
     * Creates a new trip that is already SEARCHING for a driver, so it can be offered
     * to multiple drivers. Minimal fields for the concurrency lab; the full request
     * flow (fare estimation, etc.) is a later stage.
     */
    public Trip(UUID id, UUID passengerId, RideType rideType,
                BigDecimal pickupLat, BigDecimal pickupLng,
                BigDecimal destinationLat, BigDecimal destinationLng, Instant now) {
        this.id = id;
        this.passengerId = passengerId;
        this.rideType = rideType;
        this.pickupLat = pickupLat;
        this.pickupLng = pickupLng;
        this.destinationLat = destinationLat;
        this.destinationLng = destinationLng;
        this.status = TripStatus.SEARCHING;
        this.requestedAt = now;
        this.createdAt = now;
        this.updatedAt = now;
    }

    /**
     * Assigns a driver to this trip. THE signature business rule:
     * a trip may only be accepted while it is still SEARCHING. If a driver already
     * won it, the status is no longer SEARCHING and this throws.
     *
     * This guard, combined with the @Version optimistic lock, is what guarantees
     * exactly one winner when many drivers accept at the same instant: even if two
     * threads both read status=SEARCHING, only one commit succeeds; the other fails
     * the version check and is rejected before it can overwrite the winner.
     */
    public void acceptBy(UUID driverId, Instant now) {
        if (this.status != TripStatus.SEARCHING) {
            throw new TripNotAcceptableException(this.id, this.status);
        }
        this.driverId = driverId;
        this.status = TripStatus.DRIVER_ASSIGNED;
        this.acceptedAt = now;
        this.updatedAt = now;
    }

    /**
     * Marks that the assigned driver has arrived at the pickup point.
     * Legal only from DRIVER_ASSIGNED.
     */
    public void arrive(Instant now) {
        if (this.status != TripStatus.DRIVER_ASSIGNED) {
            throw new TripTransitionException(this.id, this.status, "marked arrived");
        }
        this.status = TripStatus.DRIVER_ARRIVED;
        this.arrivedAt = now;
        this.updatedAt = now;
    }

    /**
     * Starts the trip once the driver has arrived and the passenger is aboard.
     * Legal only from DRIVER_ARRIVED.
     */
    public void start(Instant now) {
        if (this.status != TripStatus.DRIVER_ARRIVED) {
            throw new TripTransitionException(this.id, this.status, "started");
        }
        this.status = TripStatus.IN_PROGRESS;
        this.startedAt = now;
        this.updatedAt = now;
    }

    /**
     * Completes the trip after it has been driven. Legal only from IN_PROGRESS.
     * COMPLETED is a terminal state.
     */
    public void complete(Instant now) {
        if (this.status != TripStatus.IN_PROGRESS) {
            throw new TripTransitionException(this.id, this.status, "completed");
        }
        this.status = TripStatus.COMPLETED;
        this.completedAt = now;
        this.updatedAt = now;
    }

    /**
     * Cancels this trip. A trip may be cancelled from any non-terminal status;
     * a trip that is already COMPLETED or CANCELLED cannot be cancelled again.
     */
    public void cancel(String reason, Instant now) {
        if (this.status == TripStatus.COMPLETED || this.status == TripStatus.CANCELLED) {
            throw new TripNotCancellableException(this.id, this.status);
        }
        this.status = TripStatus.CANCELLED;
        this.cancellationReason = reason;
        this.cancelledAt = now;
        this.updatedAt = now;
    }
}