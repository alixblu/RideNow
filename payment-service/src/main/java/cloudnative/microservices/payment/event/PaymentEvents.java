package cloudnative.microservices.payment.event;

import cloudnative.microservices.payment.entity.Payment;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Factory for payment-service domain events, keeping each event's JSON contract
 * next to its type constant.
 */
public final class PaymentEvents {

    public static final String PAYMENT_SUCCEEDED = "payment.succeeded";
    public static final String PAYMENT_FAILED = "payment.failed";

    private PaymentEvents() {
    }

    public static DomainEvent paymentSucceeded(Payment payment) {
        return DomainEvent.of(PAYMENT_SUCCEEDED, payment.getId(), base(payment));
    }

    public static DomainEvent paymentFailed(Payment payment) {
        Map<String, String> data = base(payment);
        if (payment.getFailureReason() != null) {
            data.put("failureReason", payment.getFailureReason());
        }
        return DomainEvent.of(PAYMENT_FAILED, payment.getId(), data);
    }

    private static Map<String, String> base(Payment payment) {
        Map<String, String> data = new LinkedHashMap<>();
        data.put("paymentId", payment.getId().toString());
        data.put("tripId", payment.getTripId().toString());
        data.put("amount", payment.getAmount().toPlainString());
        data.put("currency", payment.getCurrency());
        data.put("status", payment.getStatus().name());
        return data;
    }
}
