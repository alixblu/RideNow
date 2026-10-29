package cloudnative.microservices.matching.dto.response;

import java.util.UUID;

/** A nearby driver matching-service found, with the straight-line distance. */
public record CandidateDriver(
        UUID driverId,
        int distanceMeters
) {
}
