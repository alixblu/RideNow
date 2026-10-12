package cloudnative.microservices.trip.dto.request;

import cloudnative.microservices.trip.entity.RideType;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;
import java.util.UUID;

public record CreateTripRequest(
        @NotNull UUID passengerId,
        @NotNull RideType rideType,
        @NotNull BigDecimal pickupLat,
        @NotNull BigDecimal pickupLng,
        @NotNull BigDecimal destinationLat,
        @NotNull BigDecimal destinationLng
) {
}