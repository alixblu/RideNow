package cloudnative.microservices.trip.exception;

/** payment-service declined the authorization, so the trip must not be created. -> 402. */
public class PaymentDeclinedException extends RuntimeException {
    public PaymentDeclinedException(String reason) {
        super("Payment was declined: " + reason);
    }
}
