package cloudnative.microservices.trip.dto.response;

import cloudnative.microservices.trip.entity.TripOfferStatus;
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
