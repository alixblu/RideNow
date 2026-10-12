package cloudnative.microservices.driver.exception;

/**
 * Thrown when creating a resource would violate a uniqueness rule
 * (e.g. a license number or user already has a driver profile).
 * Handled as HTTP 409 Conflict.
 */
public class DuplicateResourceException extends RuntimeException {

    public DuplicateResourceException(String message) {
        super(message);
    }
}
