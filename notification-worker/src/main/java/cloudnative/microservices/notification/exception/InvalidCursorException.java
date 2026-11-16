package cloudnative.microservices.notification.exception;

/** The {@code since} cursor does not identify one of the user's notifications. -> 400. */
public class InvalidCursorException extends RuntimeException {

    public InvalidCursorException(String message) {
        super(message);
    }
}
