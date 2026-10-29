package cloudnative.microservices.driver.live;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

/**
 * Redis-backed live driver state: one hash per driver at
 * {@code ridenow:driver:live:{driverId}} holding availability + last position,
 * with a TTL so a driver whose app stops reporting is treated as gone. Redis is
 * the PRIMARY store for this (the DBML keeps it out of Postgres); the data is
 * ephemeral and re-reported by the driver app, so a Redis loss is acceptable.
 */
@Component
public class RedisDriverLocationStore implements DriverLocationStore {

    private static final String KEY_PREFIX = "ridenow:driver:live:";
    private static final String FIELD_AVAILABILITY = "availability";
    private static final String FIELD_LAT = "lat";
    private static final String FIELD_LNG = "lng";
    private static final String FIELD_UPDATED_AT = "updatedAt";

    /** How long a live record survives without an update (driver app heartbeat). */
    private static final Duration TTL = Duration.ofMinutes(5);

    private final StringRedisTemplate redis;

    public RedisDriverLocationStore(StringRedisTemplate redis) {
        this.redis = redis;
    }

    private static String key(UUID driverId) {
        return KEY_PREFIX + driverId;
    }

    @Override
    public void goOnline(UUID driverId) {
        String key = key(driverId);
        redis.opsForHash().put(key, FIELD_AVAILABILITY, Availability.ONLINE.name());
        redis.opsForHash().put(key, FIELD_UPDATED_AT, Instant.now().toString());
        redis.expire(key, TTL);
    }

    @Override
    public void goOffline(UUID driverId) {
        // Clearing the key is the simplest representation of OFFLINE: no live
        // record means not available. (The durable account row stays in Postgres.)
        redis.delete(key(driverId));
    }

    @Override
    public void updateLocation(UUID driverId, BigDecimal lat, BigDecimal lng) {
        String key = key(driverId);
        Map<String, String> fields = Map.of(
                FIELD_AVAILABILITY, Availability.ONLINE.name(),
                FIELD_LAT, lat.toPlainString(),
                FIELD_LNG, lng.toPlainString(),
                FIELD_UPDATED_AT, Instant.now().toString());
        redis.opsForHash().putAll(key, fields);
        redis.expire(key, TTL);
    }

    @Override
    public Optional<DriverLiveState> getState(UUID driverId) {
        String key = key(driverId);
        Map<Object, Object> raw = redis.opsForHash().entries(key);
        if (raw.isEmpty()) {
            return Optional.empty();
        }
        String availability = (String) raw.get(FIELD_AVAILABILITY);
        String lat = (String) raw.get(FIELD_LAT);
        String lng = (String) raw.get(FIELD_LNG);
        String updatedAt = (String) raw.get(FIELD_UPDATED_AT);
        return Optional.of(new DriverLiveState(
                driverId,
                availability != null ? Availability.valueOf(availability) : Availability.OFFLINE,
                lat != null ? new BigDecimal(lat) : null,
                lng != null ? new BigDecimal(lng) : null,
                updatedAt != null ? Instant.parse(updatedAt) : null));
    }
}
