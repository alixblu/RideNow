package cloudnative.microservices.notification.service;

import cloudnative.microservices.notification.dto.IncomingEvent;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * Tells the realtime-gateway who may watch whom, and when that ends.
 *
 * <ul>
 *   <li>{@code driver.accepted}: sets two keys, each with a 3h TTL as a safety net:
 *       {@code ridenow:tracking:trip:{tripId}} = {passengerId, driverId} and
 *       {@code ridenow:tracking:driver:{driverId}} = {tripId, passengerId};</li>
 *   <li>{@code trip.completed} / {@code trip.cancelled}: deletes both keys and
 *       publishes {@code {tripId}} on {@code ridenow:tracking:ended}.</li>
 * </ul>
 *
 * Every step is naturally idempotent (SET, DEL), so a redelivered event is harmless.
 * A Redis failure throws, so the SQS message is retried. The compensation
 * {@code trip.cancelled} event (no passengerId, no driver) just deletes keys that
 * do not exist and publishes an end signal nobody is listening for.
 */
@Component
public class TrackingPairingService {

    static final String TRIP_KEY_PREFIX = "ridenow:tracking:trip:";
    static final String DRIVER_KEY_PREFIX = "ridenow:tracking:driver:";
    static final String ENDED_CHANNEL = "ridenow:tracking:ended";
    static final Duration TTL = Duration.ofHours(3);

    private static final Logger log = LoggerFactory.getLogger(TrackingPairingService.class);

    private final StringRedisTemplate redis;
    private final ObjectMapper objectMapper;

    public TrackingPairingService(StringRedisTemplate redis, ObjectMapper objectMapper) {
        this.redis = redis;
        this.objectMapper = objectMapper;
    }

    /** Applies the event's effect on the pairing, if it has one. */
    public void apply(IncomingEvent event) {
        switch (event.type()) {
            case "driver.accepted" -> pair(event);
            case "trip.completed", "trip.cancelled" -> end(event);
            default -> {
                // not a tracking event
            }
        }
    }

    private void pair(IncomingEvent event) {
        UUID tripId = id(event, "tripId");
        UUID passengerId = id(event, "passengerId");
        UUID driverId = id(event, "driverId");
        if (tripId == null || passengerId == null || driverId == null) {
            log.warn("driver.accepted eventId={} lacks a trip, passenger or driver id; no pairing", event.eventId());
            return;
        }
        redis.opsForValue().set(TRIP_KEY_PREFIX + tripId,
                json("passengerId", passengerId, "driverId", driverId), TTL);
        redis.opsForValue().set(DRIVER_KEY_PREFIX + driverId,
                json("tripId", tripId, "passengerId", passengerId), TTL);
    }

    private void end(IncomingEvent event) {
        UUID tripId = id(event, "tripId");
        if (tripId == null) {
            log.warn("{} eventId={} has no tripId; nothing to end", event.type(), event.eventId());
            return;
        }
        // The event usually names the driver. If it does not, the trip key still knows.
        UUID driverId = id(event, "driverId");
        if (driverId == null) {
            driverId = driverFromTripKey(tripId);
        }
        redis.delete(TRIP_KEY_PREFIX + tripId);
        if (driverId != null) {
            deleteDriverKeyIfStillThisTrip(driverId, tripId);
        }
        redis.convertAndSend(ENDED_CHANNEL, json("tripId", tripId));
    }

    /**
     * The driver may already have accepted a newer trip by the time a late
     * completion event is handled; only remove the key if it still points here.
     */
    private void deleteDriverKeyIfStillThisTrip(UUID driverId, UUID tripId) {
        String key = DRIVER_KEY_PREFIX + driverId;
        String value = redis.opsForValue().get(key);
        if (value == null) {
            return;
        }
        try {
            JsonNode node = objectMapper.readTree(value);
            if (tripId.toString().equals(node.path("tripId").asString())) {
                redis.delete(key);
            }
        } catch (RuntimeException e) {
            log.warn("Unreadable pairing value under {}; deleting it", key);
            redis.delete(key);
        }
    }

    private UUID driverFromTripKey(UUID tripId) {
        String value = redis.opsForValue().get(TRIP_KEY_PREFIX + tripId);
        if (value == null) {
            return null;
        }
        try {
            return parse(objectMapper.readTree(value).path("driverId").asString());
        } catch (RuntimeException e) {
            return null;
        }
    }

    private UUID id(IncomingEvent event, String field) {
        return event.data() == null ? null : parse(event.data().get(field));
    }

    private static UUID parse(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        try {
            return UUID.fromString(value);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    /** Builds a small JSON object with its fields in the order given (name, id, name, id...). */
    private String json(Object... nameValuePairs) {
        Map<String, String> fields = new LinkedHashMap<>();
        for (int i = 0; i < nameValuePairs.length; i += 2) {
            fields.put((String) nameValuePairs[i], nameValuePairs[i + 1].toString());
        }
        return objectMapper.writeValueAsString(fields);
}
}
