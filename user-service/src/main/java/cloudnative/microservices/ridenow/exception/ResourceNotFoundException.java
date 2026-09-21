package cloudnative.microservices.ridenow.exception;

import java.util.UUID;

public class ResourceNotFoundException extends RuntimeException {

    public ResourceNotFoundException(String resourceName, UUID id) {
        super(resourceName + " with id " + id + " was not found");
    }
}
