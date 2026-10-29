package cloudnative.microservices.matching.service;

import cloudnative.microservices.matching.dto.request.MatchRequest;
import cloudnative.microservices.matching.dto.response.CandidateDriver;
import cloudnative.microservices.matching.dto.response.MatchResponse;
import cloudnative.microservices.matching.dto.response.TripOfferResponse;
import cloudnative.microservices.matching.entity.TripOffer;
import cloudnative.microservices.matching.repository.TripOfferRepository;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Finds candidate drivers for a trip's pickup (via the swappable
 * {@link NearbyDriverFinder}) and records a PENDING offer for each, nearest
 * first. matching-service only proposes candidates and persists offers; the
 * accept decision (and its concurrency guard) stays in trip-service.
 */
@Service
@RequiredArgsConstructor
public class MatchingService {

    private static final int DEFAULT_RADIUS_METERS = 5_000;
    private static final int DEFAULT_LIMIT = 5;
    private static final Duration OFFER_TTL = Duration.ofSeconds(30);

    private final NearbyDriverFinder finder;
    private final TripOfferRepository offerRepository;

    @Transactional
    public MatchResponse match(MatchRequest request) {
        int radius = request.radiusMeters() != null ? request.radiusMeters() : DEFAULT_RADIUS_METERS;
        int limit = request.limit() != null ? request.limit() : DEFAULT_LIMIT;

        List<CandidateDriver> candidates = finder.findNearby(
                request.vehicleType(), request.pickupLat(), request.pickupLng(), radius, limit);

        Instant now = Instant.now();
        Instant expiresAt = now.plus(OFFER_TTL);
        List<TripOfferResponse> offers = candidates.stream()
                .map(c -> offerRepository.save(new TripOffer(
                        UUID.randomUUID(), request.tripId(), c.driverId(),
                        c.distanceMeters(), now, expiresAt)))
                .map(MatchingService::toResponse)
                .toList();

        return new MatchResponse(request.tripId(), candidates, offers);
    }

    @Transactional(readOnly = true)
    public List<TripOfferResponse> offersForTrip(UUID tripId) {
        return offerRepository.findByTripIdOrderByOfferedAtAsc(tripId).stream()
                .map(MatchingService::toResponse)
                .toList();
    }

    private static TripOfferResponse toResponse(TripOffer offer) {
        return new TripOfferResponse(
                offer.getId(), offer.getTripId(), offer.getDriverId(), offer.getStatus(),
                offer.getDistanceMeters(), offer.getOfferedAt(), offer.getRespondedAt(), offer.getExpiresAt());
    }
}
