package cloudnative.microservices.driver.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Entity
@Table(name = "vehicles")
@Getter
@NoArgsConstructor
public class Vehicle {

    @Id
    private UUID id;

    @Column(name = "driver_id", nullable = false)
    private UUID driverId;

    @Column(name = "plate_number", nullable = false, unique = true)
    private String plateNumber;

    @Enumerated(EnumType.STRING)
    @Column(name = "vehicle_type", nullable = false)
    private VehicleType vehicleType;

    private String brand;
    private String model;
    private String color;

    @Column(nullable = false)
    private boolean active;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    /** Creates a new vehicle for a driver; server owns id, active=true, and timestamps. */
    public Vehicle(UUID id, UUID driverId, String plateNumber, VehicleType vehicleType,
                   String brand, String model, String color, Instant now) {
        this.id = id;
        this.driverId = driverId;
        this.plateNumber = plateNumber;
        this.vehicleType = vehicleType;
        this.brand = brand;
        this.model = model;
        this.color = color;
        this.active = true;
        this.createdAt = now;
        this.updatedAt = now;
    }
}