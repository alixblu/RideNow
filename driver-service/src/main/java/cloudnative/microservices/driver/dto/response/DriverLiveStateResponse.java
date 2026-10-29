package cloudnative.microservices.driver.dto.response;

import cloudnative.microservices.driver.live.Availability;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/**
 * The live-state view returned at the API boundary (never the internal store
 * type). lat/lng are null until the driver reports a position.
 */
public record DriverLiveStateResponse(
        UUID driverId,
        Availability availability,
        BigDecimal lat,
        BigDecimal lng,
        Instant updatedAt
) {
}
