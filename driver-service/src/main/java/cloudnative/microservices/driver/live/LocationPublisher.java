package cloudnative.microservices.driver.live;

import java.math.BigDecimal;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

/**
 * Publishes a driver's live location on a Redis Pub/Sub channel - the backend
 * side of live tracking. Pub/Sub is fire-and-forget and loss-tolerant, which
 * fits GPS pings (a dropped one is replaced a second later); it is NOT durable
 * and is deliberately NOT used for must-not-lose work (that is SQS). A future
 * WebSocket layer subscribes and pushes each position to the passenger's map.
 */
@Component
public class LocationPublisher {

    private static final Logger log = LoggerFactory.getLogger(LocationPublisher.class);

    /** One channel for all driver location updates; subscribers filter by driverId. */
    public static final String CHANNEL = "ridenow:driver:locations";

    private final StringRedisTemplate redis;
    private final ObjectMapper objectMapper;

    public LocationPublisher(StringRedisTemplate redis, ObjectMapper objectMapper) {
        this.redis = redis;
        this.objectMapper = objectMapper;
    }

    public void publish(UUID driverId, BigDecimal lat, BigDecimal lng) {
        try {
            String message = objectMapper.writeValueAsString(
                    new LocationUpdate(driverId, lat, lng));
            redis.convertAndSend(CHANNEL, message);
        } catch (RuntimeException ex) {
            // Live tracking is loss-tolerant: a failed publish must not break the
            // location write (which already updated the primary store).
            log.warn("Failed to publish location for {}: {}", driverId, ex.getMessage());
        }
    }

    /** The on-the-wire shape of a live location update. */
    public record LocationUpdate(UUID driverId, BigDecimal lat, BigDecimal lng) {
    }
}
