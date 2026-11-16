package cloudnative.microservices.driver.exception;

/**
 * The driver tried to go online without a usable vehicle: they have no active
 * vehicle, or the one they picked is inactive. Handled as HTTP 409 Conflict.
 */
public class NoActiveVehicleException extends RuntimeException {

    public NoActiveVehicleException(String message) {
        super(message);
    }
}
