package cloudnative.microservices.matching.service;

import cloudnative.microservices.matching.dto.response.CandidateDriver;
import cloudnative.microservices.matching.entity.VehicleType;
import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Sort;
import org.springframework.data.geo.Circle;
import org.springframework.data.geo.Distance;
import org.springframework.data.geo.Point;
import org.springframework.data.redis.connection.RedisGeoCommands.DistanceUnit;
import org.springframework.data.redis.connection.RedisGeoCommands.GeoRadiusCommandArgs;
import org.springframework.data.redis.core.GeoOperations;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

/**
 * The Redis GEO index matching-service OWNS and queries. One sorted-set per
 * vehicle type ({@code ridenow:matching:geo:{TYPE}}) holds each driver's position;
 * GEOSEARCH returns only the drivers near a point, ordered by distance - no
 * full-table scan. driver-service never touches this key; positions arrive via
 * the ingest handoff, and matching-service writes them here.
 */
@Component
public class DriverGeoIndex {

    private static final String KEY_PREFIX = "ridenow:matching:geo:";

    private final StringRedisTemplate redis;

    public DriverGeoIndex(StringRedisTemplate redis) {
        this.redis = redis;
    }

    private static String key(VehicleType vehicleType) {
        return KEY_PREFIX + vehicleType.name();
    }

    /** Adds or moves a driver's position in the index for its vehicle type. */
    public void upsert(UUID driverId, VehicleType vehicleType, BigDecimal lat, BigDecimal lng) {
        GeoOperations<String, String> geo = redis.opsForGeo();
        // Redis GEO takes (longitude, latitude).
        geo.add(key(vehicleType), new Point(lng.doubleValue(), lat.doubleValue()), driverId.toString());
    }

    /** Removes a driver from the index (e.g. when they go offline). */
    public void remove(UUID driverId, VehicleType vehicleType) {
        redis.opsForGeo().remove(key(vehicleType), driverId.toString());
    }

    /** Nearby drivers within the radius, nearest first, capped at limit. */
    public List<CandidateDriver> searchNearby(
            VehicleType vehicleType, BigDecimal lat, BigDecimal lng, int radiusMeters, int limit) {
        Circle within = new Circle(
                new Point(lng.doubleValue(), lat.doubleValue()),
                new Distance(radiusMeters, DistanceUnit.METERS));
        GeoRadiusCommandArgs args = GeoRadiusCommandArgs.newGeoRadiusArgs()
                .includeDistance()
                .sortAscending()
                .limit(limit);

        var results = redis.opsForGeo().radius(key(vehicleType), within, args);
        if (results == null) {
            return List.of();
        }
        return results.getContent().stream()
                .map(result -> {
                    String driverId = result.getContent().getName();
                    double distance = result.getDistance().getValue(); // meters (Metrics.METERS)
                    return new CandidateDriver(UUID.fromString(driverId), (int) Math.round(distance));
                })
                .toList();
    }
}
