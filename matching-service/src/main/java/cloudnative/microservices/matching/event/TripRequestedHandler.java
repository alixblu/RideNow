package cloudnative.microservices.matching.event;

import cloudnative.microservices.matching.dto.request.MatchRequest;
import cloudnative.microservices.matching.entity.VehicleType;
import cloudnative.microservices.matching.repository.TripOfferRepository;
import cloudnative.microservices.matching.service.MatchingService;
import java.math.BigDecimal;
import java.util.Map;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * Turns a {@code trip.requested} event into a match: find nearby drivers for the
 * pickup and record an offer for each. Replaces the old "someone calls
 * POST /api/matching/match" step; that endpoint stays for manual testing.
 *
 * Retry contract with the SQS consumer: returning normally means "done, delete
 * the message"; throwing means "retry" (and eventually dead-letter). Events that
 * can never succeed (malformed) are logged and dropped. A trip that already has
 * offers is skipped, so a duplicate delivery does not offer it twice.
 */
@Component
@RequiredArgsConstructor
public class TripRequestedHandler {

    private static final Logger log = LoggerFactory.getLogger(TripRequestedHandler.class);

    static final String TRIP_REQUESTED = "trip.requested";

    private final MatchingService matchingService;
    private final TripOfferRepository offerRepository;

    public void handle(IncomingEvent event) {
        if (event == null || !TRIP_REQUESTED.equals(event.type())) {
            log.debug("Ignoring event {}", event == null ? null : event.type());
            return;
        }

        MatchRequest request;
        try {
            Map<String, String> data = event.data() != null ? event.data() : Map.of();
            request = new MatchRequest(
                    UUID.fromString(data.get("tripId")),
                    VehicleType.valueOf(data.get("rideType")),
                    new BigDecimal(data.get("pickupLat")),
                    new BigDecimal(data.get("pickupLng")),
                    null, null);
        } catch (RuntimeException ex) { // missing/invalid tripId, rideType or coordinates
            log.warn("Dropping malformed trip.requested event {}: {}", event.eventId(), ex.getMessage());
            return;
        }

        if (offerRepository.existsByTripId(request.tripId())) {
            log.info("Trip {} already has offers; skipping duplicate trip.requested", request.tripId());
            return;
        }
        matchingService.match(request);
    }
}
