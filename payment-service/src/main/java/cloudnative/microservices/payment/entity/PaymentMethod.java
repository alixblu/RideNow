package cloudnative.microservices.payment.entity;

public enum PaymentMethod {
    CASH,
    SIMULATED_CARD,
    // PayPal is modelled as a method value now so the API and schema are ready.
    // The actual PayPal integration lives behind the PaymentGateway seam; a real
    // PayPalPaymentGateway would be added without changing this enum.
    PAYPAL
}
