package cloudnative.microservices.matching.dto.request;

import cloudnative.microservices.matching.entity.VehicleType;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;
import java.util.UUID;

/**
 * The explicit handoff from driver-service: "this driver is now at this
 * position." matching-service stores it in its own working copy / GEO index. No
 * service reads another's store directly; positions arrive through this call.
 */
public record ReportPositionRequest(
        @NotNull(message = "driverId is required") UUID driverId,
        @NotNull(message = "vehicleType is required (MOTORBIKE or CAR)") VehicleType vehicleType,
        @NotNull(message = "lat is required")
        @DecimalMin(value = "-90.0", message = "lat must be >= -90")
        @DecimalMax(value = "90.0", message = "lat must be <= 90")
        BigDecimal lat,
        @NotNull(message = "lng is required")
        @DecimalMin(value = "-180.0", message = "lng must be >= -180")
        @DecimalMax(value = "180.0", message = "lng must be <= 180")
        BigDecimal lng
) {
}
