package cloudnative.microservices.payment.dto.request;

import cloudnative.microservices.payment.entity.PaymentMethod;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.util.UUID;

/**
 * What a client must send to create (charge) a payment for a trip.
 *
 * The server owns id, status, and all timestamps. The client supplies the trip
 * it is paying for, the amount/currency/method, and an idempotencyKey so that a
 * retried request is de-duplicated instead of charging twice.
 *
 * Validated at the controller boundary via @Valid; bad input is rejected with a
 * 400 before reaching the service layer.
 */
public record CreatePaymentRequest(

        @NotNull(message = "tripId is required")
        UUID tripId,

        @NotNull(message = "amount is required")
        @DecimalMin(value = "0.0", inclusive = false, message = "amount must be greater than 0")
        BigDecimal amount,

        @NotBlank(message = "currency is required")
        @Size(min = 3, max = 3, message = "currency must be a 3-letter code")
        String currency,

        @NotNull(message = "method is required")
        PaymentMethod method,

        @NotBlank(message = "idempotencyKey is required")
        String idempotencyKey
) {
}
