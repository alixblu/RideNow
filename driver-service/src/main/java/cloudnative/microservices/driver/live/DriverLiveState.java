package cloudnative.microservices.driver.live;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/**
 * A snapshot of a driver's live state: availability plus the last reported
 * position. Primary home is Redis (ephemeral, re-reported by the driver app);
 * losing it is acceptable. Lat/lng are null when the driver has not reported a
 * position yet.
 */
public record DriverLiveState(
        UUID driverId,
        Availability availability,
        BigDecimal lat,
        BigDecimal lng,
        Instant updatedAt
) {
}
