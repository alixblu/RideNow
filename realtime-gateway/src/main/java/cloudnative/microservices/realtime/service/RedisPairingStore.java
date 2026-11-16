package cloudnative.microservices.realtime.service;

import cloudnative.microservices.realtime.dto.Pairing;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * Reads the pairing keys written by notification-worker:
 * {@code ridenow:tracking:trip:{tripId}} = {passengerId, driverId} and
 * {@code ridenow:tracking:driver:{driverId}} = {tripId, passengerId}.
 * Switchable off with {@code ridenow.gateway.redis.enabled=false} (tests supply their own).
 */
@Component
@ConditionalOnProperty(name = "ridenow.gateway.redis.enabled", havingValue = "true", matchIfMissing = true)
public class RedisPairingStore implements PairingStore {

    private static final Logger log = LoggerFactory.getLogger(RedisPairingStore.class);

    private final StringRedisTemplate redis;
    private final ObjectMapper objectMapper;

    public RedisPairingStore(StringRedisTemplate redis, ObjectMapper objectMapper) {
        this.redis = redis;
        this.objectMapper = objectMapper;
    }

    @Override
    public Optional<Pairing> findByTrip(UUID tripId) {
        return read("ridenow:tracking:trip:" + tripId)
                .flatMap(json -> uuid(json, "passengerId")
                        .flatMap(passenger -> uuid(json, "driverId")
                                .map(driver -> new Pairing(tripId, passenger, driver))));
    }

    @Override
    public Optional<Pairing> findByDriver(UUID driverId) {
        return read("ridenow:tracking:driver:" + driverId)
                .flatMap(json -> uuid(json, "tripId")
                        .flatMap(trip -> uuid(json, "passengerId")
                                .map(passenger -> new Pairing(trip, passenger, driverId))));
    }

    private Optional<JsonNode> read(String key) {
        String value = redis.opsForValue().get(key);
        if (value == null) {
            return Optional.empty();
        }
        try {
            return Optional.of(objectMapper.readTree(value));
        } catch (RuntimeException e) {
            log.warn("Unreadable pairing under {}", key);
            return Optional.empty();
        }
    }

    private static Optional<UUID> uuid(JsonNode json, String field) {
        try {
            return Optional.of(UUID.fromString(json.path(field).asString("")));
        } catch (IllegalArgumentException e) {
            return Optional.empty();
        }
    }
}
