package cloudnative.microservices.payment.event;

import cloudnative.microservices.payment.entity.Payment;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/**
 * Factory for payment-service domain events, keeping each event's JSON contract
 * next to its type constant.
 *
 * {@code passengerId} is optional and never persisted by payment-service; it is
 * copied from the request / the trip event being handled so that notifications
 * know who to tell.
 */
public final class PaymentEvents {

    public static final String PAYMENT_SUCCEEDED = "payment.succeeded";
    public static final String PAYMENT_FAILED = "payment.failed";

    private PaymentEvents() {
    }

    public static DomainEvent paymentSucceeded(Payment payment, UUID passengerId) {
        return DomainEvent.of(PAYMENT_SUCCEEDED, payment.getId(), base(payment, passengerId));
    }

    public static DomainEvent paymentFailed(Payment payment, UUID passengerId) {
        Map<String, String> data = base(payment, passengerId);
        if (payment.getFailureReason() != null) {
            data.put("failureReason", payment.getFailureReason());
        }
        return DomainEvent.of(PAYMENT_FAILED, payment.getId(), data);
    }

    private static Map<String, String> base(Payment payment, UUID passengerId) {
        Map<String, String> data = new LinkedHashMap<>();
        data.put("paymentId", payment.getId().toString());
        data.put("tripId", payment.getTripId().toString());
        if (passengerId != null) {
            data.put("passengerId", passengerId.toString());
        }
        data.put("amount", payment.getAmount().toPlainString());
        data.put("currency", payment.getCurrency());
        data.put("status", payment.getStatus().name());
        return data;
    }
}
