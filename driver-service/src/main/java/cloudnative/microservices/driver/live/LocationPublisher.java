package cloudnative.microservices.driver.live;

import cloudnative.microservices.driver.entity.VehicleType;
import java.math.BigDecimal;
import java.time.Instant;
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
 * and is deliberately NOT used for must-not-lose work (that is SQS).
 * realtime-gateway subscribes and streams each position to the passenger over SSE;
 * matching-service subscribes to keep its nearby-driver index current.
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

    /** A new position. {@code recordedAt} is when driver-service stored it. */
    public void publish(UUID driverId, BigDecimal lat, BigDecimal lng, Instant recordedAt,
                        VehicleType vehicleType) {
        send(new LocationUpdate(driverId, lat, lng, recordedAt, vehicleType, true));
    }

    /**
     * The driver went offline: subscribers (matching) should drop the driver. It
     * carries no position.
     */
    public void publishOffline(UUID driverId, Instant recordedAt) {
        send(new LocationUpdate(driverId, null, null, recordedAt, null, false));
    }

    private void send(LocationUpdate update) {
        UUID driverId = update.driverId();
        try {
            String message = objectMapper.writeValueAsString(update);
            redis.convertAndSend(CHANNEL, message);
        } catch (RuntimeException ex) {
            // Live tracking is loss-tolerant: a failed publish must not break the
            // location write (which already updated the primary store).
            log.warn("Failed to publish location for {}: {}", driverId, ex.getMessage());
        }
    }

    /**
     * The on-the-wire shape of a live location update. Fields are additive;
     * readers ignore unknown ones. {@code lat}/{@code lng} are null when
     * {@code online} is false. {@code vehicleType} is the type of the vehicle the
     * driver went online with (null only if the driver has no active vehicle).
     */
    public record LocationUpdate(UUID driverId, BigDecimal lat, BigDecimal lng, Instant recordedAt,
                                 VehicleType vehicleType, boolean online) {
    }
}
