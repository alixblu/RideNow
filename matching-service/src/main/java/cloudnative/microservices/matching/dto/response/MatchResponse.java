package cloudnative.microservices.matching.dto.response;

import java.util.List;
import java.util.UUID;

/**
 * The outcome of a match request: the ranked candidates found and the offers
 * persisted for them.
 */
public record MatchResponse(
        UUID tripId,
        List<CandidateDriver> candidates,
        List<TripOfferResponse> offers
) {
}
