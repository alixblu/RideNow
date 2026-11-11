package cloudnative.microservices.trip.exception;

/** payment-service could not be reached (or answered with an error), so no trip is created. -> 503. */
public class PaymentUnavailableException extends RuntimeException {
    public PaymentUnavailableException(String message) {
        super(message);
    }
}
