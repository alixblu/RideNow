package cloudnative.microservices.driver.dto.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.util.UUID;

/**
 * What a client must send to create a driver profile.
 *
 * Only the two facts the client actually knows are accepted. Everything else
 * (id, status, ratings, trip count, timestamps) is owned and set by the server,
 * so a client cannot, for example, create a driver that already has 500 trips.
 *
 * The validation annotations run at the controller boundary (via @Valid), so
 * bad input is rejected with a 400 before it ever reaches the service layer.
 */
public record CreateDriverRequest(

        @NotNull(message = "userId is required")
        UUID userId,

        @NotBlank(message = "licenseNumber is required")
        String licenseNumber
) {
}
