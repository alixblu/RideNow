package cloudnative.microservices.matching;

import static org.assertj.core.api.Assertions.assertThat;

import cloudnative.microservices.matching.dto.request.MatchRequest;
import cloudnative.microservices.matching.dto.response.MatchResponse;
import cloudnative.microservices.matching.entity.VehicleType;
import cloudnative.microservices.matching.service.DriverPositionService;
import cloudnative.microservices.matching.service.MatchingService;
import java.math.BigDecimal;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

/**
 * Task B3 verification against a real Postgres (Testcontainers): ingest driver
 * positions via the handoff, run a match, and confirm the boring Postgres finder
 * returns the nearby driver and an offer is persisted. The default finder
 * (postgres) is used.
 *
 * A redis container is also started because position ingest keeps the Redis GEO
 * index in sync regardless of which finder answers queries. Skipped when Docker
 * is unavailable.
 */
@Testcontainers
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.NONE)
class MatchingPersistenceIntegrationTest {

    @Container
    static final PostgreSQLContainer<?> POSTGRES =
            new PostgreSQLContainer<>("postgres:17").withDatabaseName("matching_service");

    @Container
    static final GenericContainer<?> REDIS =
            new GenericContainer<>(DockerImageName.parse("redis:7-alpine")).withExposedPorts(6379);

    @DynamicPropertySource
    static void props(DynamicPropertyRegistry registry) {
        POSTGRES.start();
        REDIS.start();
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("spring.data.redis.host", REDIS::getHost);
        registry.add("spring.data.redis.port", () -> REDIS.getMappedPort(6379));
        // Force the boring Postgres finder (default, but explicit here).
        registry.add("ridenow.matching.finder", () -> "postgres");
    }

    @Autowired
    DriverPositionService positionService;

    @Autowired
    MatchingService matchingService;

    @Test
    void ingestThenMatchFindsNearbyDriverAndPersistsOffer() {
        UUID nearDriver = UUID.randomUUID();
        UUID farDriver = UUID.randomUUID();
        // near: at the pickup; far: ~11 km away (outside a 5 km radius).
        positionService.reportPosition(nearDriver, VehicleType.CAR,
                new BigDecimal("10.000000"), new BigDecimal("106.000000"));
        positionService.reportPosition(farDriver, VehicleType.CAR,
                new BigDecimal("10.000000"), new BigDecimal("106.100000"));

        UUID tripId = UUID.randomUUID();
        MatchResponse response = matchingService.match(new MatchRequest(
                tripId, VehicleType.CAR, new BigDecimal("10.000000"), new BigDecimal("106.000000"), 5000, 5));

        assertThat(response.candidates()).extracting(c -> c.driverId()).containsExactly(nearDriver);
        assertThat(response.offers()).hasSize(1);
        assertThat(matchingService.offersForTrip(tripId)).hasSize(1);
    }
}
