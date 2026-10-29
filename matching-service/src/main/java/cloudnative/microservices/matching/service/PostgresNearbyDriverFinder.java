package cloudnative.microservices.matching.service;

import cloudnative.microservices.matching.dto.response.CandidateDriver;
import cloudnative.microservices.matching.entity.DriverPosition;
import cloudnative.microservices.matching.entity.VehicleType;
import cloudnative.microservices.matching.repository.DriverPositionRepository;
import java.math.BigDecimal;
import java.util.Comparator;
import java.util.List;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/**
 * The LOCAL-FIRST "boring" nearby finder: load every candidate driver of the
 * requested vehicle type from Postgres, compute the straight-line distance to the
 * pickup in Java, filter by radius, sort nearest-first, and cap.
 *
 * This deliberately feels the limit: it scans ALL positions for the type and
 * sorts in memory, so it does not scale as the fleet grows. That pain is the
 * reason to move to Redis GEO (Task B4), which indexes positions spatially and
 * returns only the nearby ones.
 *
 * Active by default; the Redis GEO finder replaces it when
 * {@code ridenow.matching.finder=redis}.
 */
@Component
@ConditionalOnProperty(name = "ridenow.matching.finder", havingValue = "postgres", matchIfMissing = true)
public class PostgresNearbyDriverFinder implements NearbyDriverFinder {

    private final DriverPositionRepository positionRepository;

    public PostgresNearbyDriverFinder(DriverPositionRepository positionRepository) {
        this.positionRepository = positionRepository;
    }

    @Override
    public List<CandidateDriver> findNearby(
            VehicleType vehicleType, BigDecimal pickupLat, BigDecimal pickupLng, int radiusMeters, int limit) {
        List<DriverPosition> all = positionRepository.findByVehicleType(vehicleType);
        return all.stream()
                .map(p -> new CandidateDriver(
                        p.getDriverId(),
                        GeoDistance.meters(pickupLat, pickupLng, p.getLat(), p.getLng())))
                .filter(c -> c.distanceMeters() <= radiusMeters)
                .sorted(Comparator.comparingInt(CandidateDriver::distanceMeters))
                .limit(limit)
                .toList();
    }
}
