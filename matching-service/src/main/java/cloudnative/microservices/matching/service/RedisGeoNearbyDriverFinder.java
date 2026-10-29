package cloudnative.microservices.matching.service;

import cloudnative.microservices.matching.dto.response.CandidateDriver;
import cloudnative.microservices.matching.entity.VehicleType;
import java.math.BigDecimal;
import java.util.List;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/**
 * The "real" nearby finder: answers from the Redis GEO index matching-service
 * owns ({@link DriverGeoIndex}), using GEOSEARCH to return only the nearby
 * drivers, already ordered by distance. This replaces the boring Postgres scan
 * (which loaded and sorted every candidate) - a pure substitution behind
 * {@link NearbyDriverFinder}.
 *
 * Active when {@code ridenow.matching.finder=redis}.
 */
@Component
@ConditionalOnProperty(name = "ridenow.matching.finder", havingValue = "redis")
public class RedisGeoNearbyDriverFinder implements NearbyDriverFinder {

    private final DriverGeoIndex geoIndex;

    public RedisGeoNearbyDriverFinder(DriverGeoIndex geoIndex) {
        this.geoIndex = geoIndex;
    }

    @Override
    public List<CandidateDriver> findNearby(
            VehicleType vehicleType, BigDecimal pickupLat, BigDecimal pickupLng, int radiusMeters, int limit) {
        return geoIndex.searchNearby(vehicleType, pickupLat, pickupLng, radiusMeters, limit);
    }
}
