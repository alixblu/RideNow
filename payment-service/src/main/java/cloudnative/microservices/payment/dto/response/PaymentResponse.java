package cloudnative.microservices.payment.dto.response;

import cloudnative.microservices.payment.entity.PaymentMethod;
import cloudnative.microservices.payment.entity.PaymentStatus;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

public record PaymentResponse(
        UUID id,
        UUID tripId,
        BigDecimal amount,
        String currency,
        PaymentMethod method,
        PaymentStatus status,
        String idempotencyKey,
        String failureReason,
        Instant createdAt,
        Instant updatedAt,
        Instant paidAt,
        Instant failedAt
) {
}
