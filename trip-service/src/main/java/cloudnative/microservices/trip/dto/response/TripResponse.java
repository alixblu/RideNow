package cloudnative.microservices.trip.dto.response;

import cloudnative.microservices.trip.entity.RideType;
import cloudnative.microservices.trip.entity.TripStatus;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

public record TripResponse(
        UUID id,
        UUID passengerId,
        UUID driverId,
        UUID vehicleId,
        RideType rideType,
        BigDecimal pickupLat,
        BigDecimal pickupLng,
        String pickupAddress,
        BigDecimal destinationLat,
        BigDecimal destinationLng,
        String destinationAddress,
        TripStatus status,
        BigDecimal estimatedFare,
        BigDecimal finalFare,
        String cancellationReason,
        long version,
        Instant requestedAt,
        Instant acceptedAt,
        Instant arrivedAt,
        Instant startedAt,
        Instant completedAt,
        Instant cancelledAt,
        Instant createdAt,
        Instant updatedAt
) {
}
