package cloudnative.microservices.matching.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

import cloudnative.microservices.matching.dto.response.CandidateDriver;
import cloudnative.microservices.matching.entity.DriverPosition;
import cloudnative.microservices.matching.entity.VehicleType;
import cloudnative.microservices.matching.repository.DriverPositionRepository;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

/**
 * The boring Postgres finder's ranking/filtering, verified with mocks: within
 * radius, nearest-first, and capped by limit.
 */
@ExtendWith(MockitoExtension.class)
class PostgresNearbyDriverFinderTest {

    @Mock private DriverPositionRepository positionRepository;

    @InjectMocks private PostgresNearbyDriverFinder finder;

    private DriverPosition at(UUID id, String lat, String lng) {
        return new DriverPosition(id, VehicleType.CAR, new BigDecimal(lat), new BigDecimal(lng), Instant.now());
    }

    @Test
    void returnsNearbyDriversNearestFirstWithinRadius() {
        // Pickup at (10.000000, 106.000000).
        UUID near = UUID.randomUUID();   // ~0 m
        UUID mid = UUID.randomUUID();    // ~1.1 km east
        UUID far = UUID.randomUUID();    // ~11 km east (outside a 5 km radius)
        when(positionRepository.findByVehicleType(VehicleType.CAR)).thenReturn(List.of(
                at(mid, "10.000000", "106.010000"),
                at(near, "10.000000", "106.000000"),
                at(far, "10.000000", "106.100000")));

        List<CandidateDriver> result = finder.findNearby(
                VehicleType.CAR, new BigDecimal("10.000000"), new BigDecimal("106.000000"), 5000, 10);

        assertThat(result).extracting(CandidateDriver::driverId).containsExactly(near, mid);
        assertThat(result.get(0).distanceMeters()).isLessThan(result.get(1).distanceMeters());
    }

    @Test
    void capsResultsToLimit() {
        when(positionRepository.findByVehicleType(VehicleType.CAR)).thenReturn(List.of(
                at(UUID.randomUUID(), "10.000000", "106.000000"),
                at(UUID.randomUUID(), "10.000100", "106.000000"),
                at(UUID.randomUUID(), "10.000200", "106.000000")));

        List<CandidateDriver> result = finder.findNearby(
                VehicleType.CAR, new BigDecimal("10.000000"), new BigDecimal("106.000000"), 5000, 2);

        assertThat(result).hasSize(2);
    }
}
