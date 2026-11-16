package cloudnative.microservices.realtime.service;

import cloudnative.microservices.realtime.config.GatewayProperties;
import cloudnative.microservices.realtime.dto.Pairing;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.LongSupplier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

/**
 * Handles one driver position from the Redis channel {@code ridenow:driver:locations}.
 *
 * <p>A position is delivered only if the driver is paired with a trip that has a
 * stream open on this pod. Everything else is dropped quietly: it is the normal case
 * for most positions on most pods. Delivery is throttled to one {@code location}
 * event per trip per {@code minEventInterval}.
 *
 * <p>The event has no {@code id}: a reconnect must not ask for replay, because the
 * client redraws the REST snapshot and only the latest position matters.
 */
@Component
public class LocationRelay {

    private static final Logger log = LoggerFactory.getLogger(LocationRelay.class);

    private final StreamRegistry registry;
    private final PairingCache pairings;
    private final ObjectMapper objectMapper;
    private final long minIntervalNanos;
    private final LongSupplier nanoClock;
    private final Map<UUID, Long> lastSentByTrip = new ConcurrentHashMap<>();

    @Autowired
    public LocationRelay(StreamRegistry registry, PairingCache pairings,
                         ObjectMapper objectMapper, GatewayProperties properties) {
        this(registry, pairings, objectMapper, properties, System::nanoTime);
    }

    LocationRelay(StreamRegistry registry, PairingCache pairings, ObjectMapper objectMapper,
                  GatewayProperties properties, LongSupplier nanoClock) {
        this.registry = registry;
        this.pairings = pairings;
        this.objectMapper = objectMapper;
        this.minIntervalNanos = properties.minEventInterval().toNanos();
        this.nanoClock = nanoClock;
    }

    /** Entry point for a message from the locations channel (called by the Redis listener). */
    public void onMessage(String json) {
        JsonNode update;
        try {
            update = objectMapper.readTree(json);
        } catch (RuntimeException e) {
            log.warn("Dropping an unreadable location message");
            return;
        }
        UUID driverId = uuid(update.path("driverId").asString(""));
        if (driverId == null || !update.path("lat").isNumber() || !update.path("lng").isNumber()) {
            log.warn("Dropping a location message without driverId, lat and lng");
            return;
        }
        if (!update.path("online").asBoolean(true)) {
            return; // the driver went offline; there is no position to show
        }
        if (registry.isEmpty()) {
            return; // nobody is watching on this pod: skip the pairing lookup
        }
        Optional<Pairing> pairing = pairings.findByDriver(driverId);
        if (pairing.isEmpty() || !registry.hasStreams(pairing.get().tripId())) {
            return;
        }
        UUID tripId = pairing.get().tripId();
        if (!claimSlot(tripId)) {
            return;
        }
        ObjectNode data = objectMapper.createObjectNode();
        data.put("driverId", driverId.toString());
        data.put("tripId", tripId.toString());
        data.set("lat", update.get("lat"));
        data.set("lng", update.get("lng"));
        data.put("recordedAt", update.path("recordedAt").asString(Instant.now().toString()));
        registry.send(tripId, SseEmitter.event().name("location").data(data.toString()));
    }

    /** Forgets the throttle state for an ended trip. */
    public void forget(UUID tripId) {
        lastSentByTrip.remove(tripId);
    }

    /** True if this trip may send now; records the send time. */
    private boolean claimSlot(UUID tripId) {
        long now = nanoClock.getAsLong();
        boolean[] allowed = {false};
        lastSentByTrip.compute(tripId, (id, last) -> {
            if (last == null || now - last >= minIntervalNanos) {
                allowed[0] = true;
                return now;
            }
            return last;
        });
        return allowed[0];
    }

    private static UUID uuid(String value) {
        try {
            return UUID.fromString(value);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }
}
