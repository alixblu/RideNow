package cloudnative.microservices.matching.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.when;

import cloudnative.microservices.matching.dto.request.MatchRequest;
import cloudnative.microservices.matching.dto.response.CandidateDriver;
import cloudnative.microservices.matching.dto.response.MatchResponse;
import cloudnative.microservices.matching.entity.TripOffer;
import cloudnative.microservices.matching.entity.VehicleType;
import cloudnative.microservices.matching.repository.TripOfferRepository;
import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

/**
 * Matching service rules with mocks: it records one offer per candidate the
 * finder returns, and returns both the candidates and the persisted offers.
 */
@ExtendWith(MockitoExtension.class)
class MatchingServiceTest {

    @Mock private NearbyDriverFinder finder;
    @Mock private TripOfferRepository offerRepository;

    @InjectMocks private MatchingService matchingService;

    @Test
    void matchRecordsOneOfferPerCandidate() {
        UUID tripId = UUID.randomUUID();
        UUID d1 = UUID.randomUUID();
        UUID d2 = UUID.randomUUID();
        when(finder.findNearby(any(), any(), any(), anyInt(), anyInt()))
                .thenReturn(List.of(new CandidateDriver(d1, 100), new CandidateDriver(d2, 250)));
        when(offerRepository.save(any(TripOffer.class))).thenAnswer(inv -> inv.getArgument(0));

        MatchRequest request = new MatchRequest(
                tripId, VehicleType.CAR, new BigDecimal("10.0"), new BigDecimal("106.0"), null, null);
        MatchResponse response = matchingService.match(request);

        assertThat(response.candidates()).hasSize(2);
        assertThat(response.offers()).hasSize(2);
        assertThat(response.offers()).extracting(o -> o.driverId()).containsExactly(d1, d2);
        verify(offerRepository, times(2)).save(any(TripOffer.class));
    }

    @Test
    void matchWithNoCandidatesMakesNoOffers() {
        UUID tripId = UUID.randomUUID();
        when(finder.findNearby(any(), any(), any(), anyInt(), anyInt())).thenReturn(List.of());

        MatchRequest request = new MatchRequest(
                tripId, VehicleType.CAR, new BigDecimal("10.0"), new BigDecimal("106.0"), 3000, 5);
        MatchResponse response = matchingService.match(request);

        assertThat(response.candidates()).isEmpty();
        assertThat(response.offers()).isEmpty();
    }
}
