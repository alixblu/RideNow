package cloudnative.microservices.matching.controller;

import cloudnative.microservices.matching.dto.request.MatchRequest;
import cloudnative.microservices.matching.dto.response.MatchResponse;
import cloudnative.microservices.matching.dto.response.TripOfferResponse;
import cloudnative.microservices.matching.service.MatchingService;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Matching endpoints: run a match for a trip (find candidates + record offers),
 * and read the offers made for a trip.
 */
@RestController
@RequestMapping("/api/matching")
@RequiredArgsConstructor
public class MatchingController {

    private final MatchingService matchingService;

    @PostMapping("/match")
    public MatchResponse match(@Valid @RequestBody MatchRequest request) {
        return matchingService.match(request);
    }

    @GetMapping("/trips/{tripId}/offers")
    public List<TripOfferResponse> offersForTrip(@PathVariable UUID tripId) {
        return matchingService.offersForTrip(tripId);
    }
}
