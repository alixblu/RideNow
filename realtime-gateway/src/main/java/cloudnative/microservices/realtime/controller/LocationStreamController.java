package cloudnative.microservices.realtime.controller;

import cloudnative.microservices.realtime.config.GatewayProperties;
import cloudnative.microservices.realtime.dto.Pairing;
import cloudnative.microservices.realtime.service.PairingStore;
import cloudnative.microservices.realtime.service.StreamRegistry;
import java.io.IOException;
import java.util.UUID;
import java.util.concurrent.ThreadLocalRandom;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/**
 * {@code GET /live/trips/{tripId}/location?userId=}: streams the driver's position
 * to that trip's passenger, and to nobody else.
 *
 * <ul>
 *   <li>400: {@code tripId} or {@code userId} is not a UUID;</li>
 *   <li>410: the trip has no pairing (not tracking yet, or it ended);</li>
 *   <li>403: {@code userId} is not the trip's passenger.</li>
 * </ul>
 *
 * Authentication is not in place yet: {@code userId} is trusted as given. That is a
 * documented gap (see docs/REALTIME.md).
 */
@RestController
@RequestMapping("/live")
public class LocationStreamController {

    private final PairingStore pairingStore;
    private final StreamRegistry registry;
    private final GatewayProperties properties;

    public LocationStreamController(PairingStore pairingStore, StreamRegistry registry,
                                    GatewayProperties properties) {
        this.pairingStore = pairingStore;
        this.registry = registry;
        this.properties = properties;
    }

    @GetMapping("/trips/{tripId}/location")
    public ResponseEntity<SseEmitter> location(@PathVariable String tripId, @RequestParam String userId) {
        UUID trip = parse(tripId, "tripId");
        UUID user = parse(userId, "userId");

        Pairing pairing = pairingStore.findByTrip(trip)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.GONE, "Trip is not being tracked"));
        if (!pairing.passengerId().equals(user)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Not your trip");
        }

        SseEmitter emitter = new SseEmitter(properties.streamTimeout().toMillis());
        registry.register(trip, emitter, properties.maxStreamsPerTrip());
        try {
            // Tells the browser how long to wait before reconnecting (jittered so a
            // pod's clients do not all return together), and flushes the headers.
            emitter.send(SseEmitter.event().reconnectTime(jitteredRetryMillis()).comment("connected"));
        } catch (IOException | RuntimeException e) {
            emitter.complete();
        }
        return ResponseEntity.ok()
                .header("Cache-Control", "no-cache")
                .header("X-Accel-Buffering", "no")
                .body(emitter);
    }

    private long jitteredRetryMillis() {
        long base = properties.retry().toMillis();
        return ThreadLocalRandom.current().nextLong(base / 2, base * 3 / 2 + 1);
    }

    private static UUID parse(String value, String name) {
        try {
            return UUID.fromString(value);
        } catch (IllegalArgumentException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, name + " must be a UUID");
        }
    }
}
