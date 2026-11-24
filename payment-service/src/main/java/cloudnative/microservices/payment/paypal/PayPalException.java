package cloudnative.microservices.payment.paypal;

/** PayPal could not be reached, is not configured, or rejected a request. */
public class PayPalException extends RuntimeException {

    public PayPalException(String message) {
        super(message);
    }

    public PayPalException(String message, Throwable cause) {
        super(message, cause);
    }
}
