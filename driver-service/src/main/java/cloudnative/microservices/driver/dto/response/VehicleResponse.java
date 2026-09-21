package cloudnative.microservices.driver.dto.response;

import cloudnative.microservices.driver.entity.VehicleType;
import java.time.Instant;
import java.util.UUID;

public record VehicleResponse(
        UUID id,
        UUID driverId,
        String plateNumber,
        VehicleType vehicleType,
        String brand,
        String model,
        String color,
        boolean active,
        Instant createdAt,
        Instant updatedAt
) {
}
