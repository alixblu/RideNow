package cloudnative.microservices.driver.live;

import cloudnative.microservices.driver.entity.VehicleType;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.connection.RedisStreamCommands.XAddOptions;
import org.springframework.data.redis.connection.stream.StreamRecords;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

/**
 * Publishes a driver's live location to two places - the backend side of live
 * tracking:
 *
 * <ul>
 *   <li>a Redis Pub/Sub channel ({@link #CHANNEL}), fire-and-forget and
 *       loss-tolerant, which fits GPS pings (a dropped one is replaced a second
 *       later). realtime-gateway subscribes and streams each position to the
 *       passenger over SSE;</li>
 *   <li>a Redis Stream ({@link #STREAM_KEY}), retained and read through a consumer
 *       group. matching-service consumes it so its nearby-driver index survives a
 *       restart without losing updates. The stream is capped (approximate
 *       {@code MAXLEN}), so it holds only the most recent entries.</li>
 * </ul>
 *
 * The two writes are independent: a failure of one never blocks the other or the
 * location write that already updated the primary store. Domain events that must
 * not be lost still go through SNS/SQS, not through here.
 */
@Component
public class LocationPublisher {

    private static final Logger log = LoggerFactory.getLogger(LocationPublisher.class);

    /** One channel for all driver location updates; subscribers filter by driverId. */
    public static final String CHANNEL = "ridenow:driver:locations";

    /** The retained stream of the same updates, consumed by matching-service. */
    public static final String STREAM_KEY = "ridenow:stream:driver-locations";

    /** The single field of a stream entry: the update JSON, same as the channel message. */
    public static final String PAYLOAD_FIELD = "payload";

    private final StringRedisTemplate redis;
    private final ObjectMapper objectMapper;
    private final long streamMaxLength;

    public LocationPublisher(StringRedisTemplate redis, ObjectMapper objectMapper,
                             @Value("${ridenow.live.location.stream-max-length:10000}") long streamMaxLength) {
        this.redis = redis;
        this.objectMapper = objectMapper;
        this.streamMaxLength = streamMaxLength;
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
        String message;
        try {
            message = objectMapper.writeValueAsString(update);
        } catch (RuntimeException ex) {
            log.warn("Failed to serialize location for {}: {}", driverId, ex.getMessage());
            return;
        }
        // Each write is attempted on its own. Live tracking is loss-tolerant at this
        // end: a failed publish must not break the location write (which already
        // updated the primary store), and one failing must not skip the other.
        try {
            redis.convertAndSend(CHANNEL, message);
        } catch (RuntimeException ex) {
            log.warn("Failed to publish location for {} on the channel: {}", driverId, ex.getMessage());
        }
        try {
            redis.opsForStream().add(
                    StreamRecords.string(Map.of(PAYLOAD_FIELD, message)).withStreamKey(STREAM_KEY),
                    XAddOptions.maxlen(streamMaxLength).approximateTrimming(true));
        } catch (RuntimeException ex) {
            log.warn("Failed to append location for {} to the stream: {}", driverId, ex.getMessage());
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
