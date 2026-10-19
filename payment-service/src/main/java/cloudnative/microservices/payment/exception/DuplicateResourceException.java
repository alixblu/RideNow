package cloudnative.microservices.payment.exception;

/**
 * Thrown when creating a resource would violate a uniqueness rule that is NOT
 * the idempotency key (e.g. a different payment already exists for the trip).
 * Handled as HTTP 409 Conflict.
 */
public class DuplicateResourceException extends RuntimeException {

    public DuplicateResourceException(String message) {
        super(message);
    }
}
