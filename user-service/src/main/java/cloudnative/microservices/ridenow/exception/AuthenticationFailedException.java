package cloudnative.microservices.ridenow.exception;

/** Login failed. One message for every cause so callers cannot enumerate accounts. */
public class AuthenticationFailedException extends RuntimeException {
    public static final String MESSAGE = "Invalid email or password.";

    public AuthenticationFailedException() {
        super(MESSAGE);
    }
}
