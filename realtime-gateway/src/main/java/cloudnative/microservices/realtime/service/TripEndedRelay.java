package cloudnative.microservices.realtime.service;

import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import tools.jackson.databind.ObjectMapper;

/**
 * Handles one message from {@code ridenow:tracking:ended}: sends
 * {@code event: trip-ended} on every stream of that trip, completes them, and
 * forgets the trip's cached pairing and throttle state.
 */
@Component
public class TripEndedRelay {

    private static final Logger log = LoggerFactory.getLogger(TripEndedRelay.class);

    private final StreamRegistry registry;
    private final PairingCache pairings;
    private final LocationRelay locationRelay;
    private final ObjectMapper objectMapper;

    public TripEndedRelay(StreamRegistry registry, PairingCache pairings,
                          LocationRelay locationRelay, ObjectMapper objectMapper) {
        this.registry = registry;
        this.pairings = pairings;
        this.locationRelay = locationRelay;
        this.objectMapper = objectMapper;
    }

    public void onMessage(String json) {
        UUID tripId;
        try {
            tripId = UUID.fromString(objectMapper.readTree(json).path("tripId").asString(""));
        } catch (RuntimeException e) {
            log.warn("Dropping an unreadable trip-ended message");
            return;
        }
        pairings.evictTrip(tripId);
        locationRelay.forget(tripId);
        registry.end(tripId, SseEmitter.event().name("trip-ended").data("{\"tripId\":\"" + tripId + "\"}"));
    }
}
