package cloudnative.microservices.driver.exception;

/** Thrown when a required upstream service (e.g. user-service) is unavailable. -> 503. */
public class UpstreamUnavailableException extends RuntimeException {
    public UpstreamUnavailableException(String message) {
        super(message);
    }
}