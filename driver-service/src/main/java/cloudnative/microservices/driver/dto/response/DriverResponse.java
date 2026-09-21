package cloudnative.microservices.driver.dto.response;

import cloudnative.microservices.driver.entity.DriverStatus;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

public record DriverResponse(
        UUID id,
        UUID userId,
        String licenseNumber,
        DriverStatus status,
        BigDecimal averageRating,
        long totalTrips,
        Instant createdAt,
        Instant updatedAt
) {
}
