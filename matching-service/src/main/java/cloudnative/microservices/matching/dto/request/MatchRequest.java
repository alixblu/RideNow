package cloudnative.microservices.matching.dto.request;

import cloudnative.microservices.matching.entity.VehicleType;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import java.math.BigDecimal;
import java.util.UUID;

/**
 * "Find nearby drivers for this trip's pickup and make offers." tripId lets the
 * resulting offers be recorded against the trip. radiusMeters/limit are optional
 * (sensible defaults applied in the service).
 */
public record MatchRequest(
        @NotNull(message = "tripId is required") UUID tripId,
        @NotNull(message = "vehicleType is required (MOTORBIKE or CAR)") VehicleType vehicleType,
        @NotNull(message = "pickupLat is required")
        @DecimalMin(value = "-90.0", message = "pickupLat must be >= -90")
        @DecimalMax(value = "90.0", message = "pickupLat must be <= 90")
        BigDecimal pickupLat,
        @NotNull(message = "pickupLng is required")
        @DecimalMin(value = "-180.0", message = "pickupLng must be >= -180")
        @DecimalMax(value = "180.0", message = "pickupLng must be <= 180")
        BigDecimal pickupLng,
        @Positive(message = "radiusMeters must be positive") Integer radiusMeters,
        @Positive(message = "limit must be positive") Integer limit
) {
}
