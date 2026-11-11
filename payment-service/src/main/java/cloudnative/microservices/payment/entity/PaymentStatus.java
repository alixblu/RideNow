package cloudnative.microservices.payment.entity;

public enum PaymentStatus {
    PENDING,
    PROCESSING,
    /** Funds are held for the estimated fare (set synchronously at trip request). */
    AUTHORIZED,
    /** The final fare was captured after the trip completed. */
    PAID,
    /** The hold was released because the trip was cancelled. */
    RELEASED,
    FAILED
}
