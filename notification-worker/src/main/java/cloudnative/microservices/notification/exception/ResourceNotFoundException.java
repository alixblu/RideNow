package cloudnative.microservices.notification.exception;

/** The requested resource does not exist. -> 404. */
public class ResourceNotFoundException extends RuntimeException {

    public ResourceNotFoundException(String message) {
        super(message);
    }
}
