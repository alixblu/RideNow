package cloudnative.microservices.driver.dto.request;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;

/**
 * A driver's current position report. Validated at the controller so a bad
 * coordinate is rejected with 400 before it reaches Redis.
 */
public record UpdateLocationRequest(
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
