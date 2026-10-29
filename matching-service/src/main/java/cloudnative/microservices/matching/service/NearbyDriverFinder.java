package cloudnative.microservices.matching.service;

import cloudnative.microservices.matching.dto.response.CandidateDriver;
import cloudnative.microservices.matching.entity.VehicleType;
import java.math.BigDecimal;
import java.util.List;

/**
 * The seam for "find nearby available drivers". The LOCAL-FIRST implementation
 * scans a Postgres table (feel the limit); a later implementation answers from a
 * Redis GEO index. Because callers depend only on this interface, swapping the
 * mechanism is a substitution, not a rewrite.
 */
public interface NearbyDriverFinder {

    /**
     * Returns candidate drivers of the given type within {@code radiusMeters} of
     * the pickup point, nearest first, capped at {@code limit}.
     */
    List<CandidateDriver> findNearby(
            VehicleType vehicleType, BigDecimal pickupLat, BigDecimal pickupLng, int radiusMeters, int limit);
}
