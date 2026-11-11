package cloudnative.microservices.trip.dto.request;

/**
 * How the passenger intends to pay. Passed through to payment-service when the
 * trip is authorized; trip-service does not store it. Mirrors payment-service's
 * own enum by value (no shared cross-service module).
 */
public enum PaymentMethod {
    CASH,
    SIMULATED_CARD,
    PAYPAL
}
