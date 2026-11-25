package cloudnative.microservices.trip.dto.request;

import cloudnative.microservices.trip.entity.RideType;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.util.UUID;

public record CreateTripRequest(
        @NotNull UUID passengerId,
        @NotNull RideType rideType,
        @NotNull BigDecimal pickupLat,
        @NotNull BigDecimal pickupLng,
        @NotNull BigDecimal destinationLat,
        @NotNull BigDecimal destinationLng,
        @NotNull PaymentMethod paymentMethod,
        /** PayPal order id the rider approved; required when paymentMethod is PAYPAL. */
        String paypalOrderId,
        @Size(max = 255) String pickupAddress,
        @Size(max = 255) String destinationAddress
) {
    /** Request without addresses, for callers that only know coordinates. */
    public CreateTripRequest(UUID passengerId, RideType rideType,
                             BigDecimal pickupLat, BigDecimal pickupLng,
                             BigDecimal destinationLat, BigDecimal destinationLng,
                             PaymentMethod paymentMethod, String paypalOrderId) {
        this(passengerId, rideType, pickupLat, pickupLng, destinationLat, destinationLng,
                paymentMethod, paypalOrderId, null, null);
    }
}
