package cloudnative.microservices.matching.event;

import cloudnative.microservices.matching.entity.TripOffer;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Factory for matching-service domain events, keeping each event's JSON contract
 * next to its type constant.
 */
public final class MatchingEvents {

    public static final String MATCH_OFFERED = "match.offered";

    private MatchingEvents() {
    }

    /** One event per offer: the driver it names is who should be told. */
    public static DomainEvent matchOffered(TripOffer offer) {
        Map<String, String> data = new LinkedHashMap<>();
        data.put("offerId", offer.getId().toString());
        data.put("tripId", offer.getTripId().toString());
        data.put("driverId", offer.getDriverId().toString());
        if (offer.getDistanceMeters() != null) {
            data.put("distanceMeters", offer.getDistanceMeters().toString());
        }
        if (offer.getExpiresAt() != null) {
            data.put("expiresAt", offer.getExpiresAt().toString());
        }
        return DomainEvent.of(MATCH_OFFERED, offer.getId(), data);
    }
}
