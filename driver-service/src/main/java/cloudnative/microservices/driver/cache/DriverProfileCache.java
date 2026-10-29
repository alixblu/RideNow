package cloudnative.microservices.driver.cache;

import cloudnative.microservices.driver.dto.response.DriverResponse;
import java.time.Duration;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

/**
 * Cache-aside store for driver PROFILE reads - the one endpoint the docs call a
 * good cache candidate (read far more often than it changes, tolerates brief
 * staleness). Deliberately scoped: nothing else in driver-service is cached.
 *
 * A cached driver profile is a disposable COPY whose real home is Postgres; on a
 * miss the service reads Postgres and populates the cache, and any profile write
 * evicts the entry. Values are JSON with a short TTL so a missed eviction still
 * self-heals.
 */
@Component
public class DriverProfileCache {

    private static final Logger log = LoggerFactory.getLogger(DriverProfileCache.class);
    private static final String KEY_PREFIX = "ridenow:driver:profile:";
    private static final Duration TTL = Duration.ofMinutes(10);

    private final StringRedisTemplate redis;
    private final ObjectMapper objectMapper;

    public DriverProfileCache(StringRedisTemplate redis, ObjectMapper objectMapper) {
        this.redis = redis;
        this.objectMapper = objectMapper;
    }

    private static String key(UUID driverId) {
        return KEY_PREFIX + driverId;
    }

    /** Returns the cached profile if present. A cache failure is swallowed (miss). */
    public Optional<DriverResponse> get(UUID driverId) {
        try {
            String json = redis.opsForValue().get(key(driverId));
            if (json == null) {
                return Optional.empty();
            }
            return Optional.of(objectMapper.readValue(json, DriverResponse.class));
        } catch (RuntimeException ex) {
            // A cache must never break a read: on any cache error, treat as a miss.
            log.warn("Driver profile cache read failed for {}: {}", driverId, ex.getMessage());
            return Optional.empty();
        }
    }

    /** Stores the profile with a TTL. A cache failure is swallowed. */
    public void put(DriverResponse driver) {
        try {
            redis.opsForValue().set(key(driver.id()), objectMapper.writeValueAsString(driver), TTL);
        } catch (RuntimeException ex) {
            log.warn("Driver profile cache write failed for {}: {}", driver.id(), ex.getMessage());
        }
    }

    /** Evicts the cached profile (called on any write that changes the driver). */
    public void evict(UUID driverId) {
        try {
            redis.delete(key(driverId));
        } catch (RuntimeException ex) {
            log.warn("Driver profile cache evict failed for {}: {}", driverId, ex.getMessage());
        }
    }
}
