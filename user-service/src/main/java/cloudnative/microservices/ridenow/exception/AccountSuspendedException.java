package cloudnative.microservices.ridenow.exception;

public class AccountSuspendedException extends RuntimeException {
    public AccountSuspendedException() {
        super("This account is suspended.");
    }
}
