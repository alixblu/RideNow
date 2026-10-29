package cloudnative.microservices.matching.dto.response;

import cloudnative.microservices.matching.entity.TripOfferStatus;
import java.time.Instant;
import java.util.UUID;

public record TripOfferResponse(
        UUID id,
        UUID tripId,
        UUID driverId,
        TripOfferStatus status,
        Integer distanceMeters,
        Instant offeredAt,
        Instant respondedAt,
        Instant expiresAt
) {
}
