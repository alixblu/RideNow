package cloudnative.microservices.matching;

import static org.assertj.core.api.Assertions.assertThat;

import cloudnative.microservices.matching.dto.request.MatchRequest;
import cloudnative.microservices.matching.dto.response.CandidateDriver;
import cloudnative.microservices.matching.dto.response.MatchResponse;
import cloudnative.microservices.matching.entity.VehicleType;
import cloudnative.microservices.matching.service.DriverPositionService;
import cloudnative.microservices.matching.service.MatchingService;
import java.math.BigDecimal;
import java.util.List;
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
 * Task B4 verification: with the Redis GEO finder active, ingesting positions
 * populates the GEO index matching-service owns, and a match answers from
 * GEOSEARCH - returning only the nearby driver, nearest first. Proves the
 * substitution behind NearbyDriverFinder works against real Redis + Postgres.
 * Skipped when Docker is unavailable.
 */
@Testcontainers
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.NONE)
class MatchingRedisGeoIntegrationTest {

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
        // The point of this test: use the Redis GEO finder.
        registry.add("ridenow.matching.finder", () -> "redis");
    }

    @Autowired
    DriverPositionService positionService;

    @Autowired
    MatchingService matchingService;
    @Autowired
    org.springframework.data.redis.core.StringRedisTemplate redis;

    /**
     * The handoff: a driver who only posts to driver-service is found because
     * matching subscribes to the location channel; going offline removes them.
     */
    @Test
    void aPositionOnTheLocationChannelMakesTheDriverMatchable() {
        UUID driver = UUID.randomUUID();
        String position = "{\"driverId\":\"" + driver + "\",\"lat\":10.200000,\"lng\":106.200000,"
                + "\"recordedAt\":\"2026-11-11T07:00:00Z\",\"vehicleType\":\"MOTORBIKE\",\"online\":true}";
        MatchRequest request = new MatchRequest(UUID.randomUUID(), VehicleType.MOTORBIKE,
                new BigDecimal("10.200000"), new BigDecimal("106.200000"), 1000, 5);

        // Re-publish until the subscription is live (Pub/Sub drops messages sent before it).
        org.awaitility.Awaitility.await().atMost(java.time.Duration.ofSeconds(15)).untilAsserted(() -> {
            redis.convertAndSend("ridenow:driver:locations", position);
            assertThat(matchingService.match(request).candidates())
                    .extracting(CandidateDriver::driverId).contains(driver);
        });

        redis.convertAndSend("ridenow:driver:locations", "{\"driverId\":\"" + driver + "\",\"online\":false}");
        org.awaitility.Awaitility.await().atMost(java.time.Duration.ofSeconds(10)).untilAsserted(() ->
                assertThat(matchingService.match(new MatchRequest(UUID.randomUUID(), VehicleType.MOTORBIKE,
                        new BigDecimal("10.200000"), new BigDecimal("106.200000"), 1000, 5)).candidates())
                        .extracting(CandidateDriver::driverId).doesNotContain(driver));
    }

    @Test
    void geoSearchReturnsNearbyDriversNearestFirst() {
        UUID near = UUID.randomUUID();   // at pickup
        UUID mid = UUID.randomUUID();    // ~1.1 km away
        UUID far = UUID.randomUUID();    // ~11 km away, outside radius

        positionService.reportPosition(near, VehicleType.CAR,
                new BigDecimal("10.000000"), new BigDecimal("106.000000"));
        positionService.reportPosition(mid, VehicleType.CAR,
                new BigDecimal("10.000000"), new BigDecimal("106.010000"));
        positionService.reportPosition(far, VehicleType.CAR,
                new BigDecimal("10.000000"), new BigDecimal("106.100000"));

        MatchResponse response = matchingService.match(new MatchRequest(
                UUID.randomUUID(), VehicleType.CAR,
                new BigDecimal("10.000000"), new BigDecimal("106.000000"), 5000, 10));

        List<CandidateDriver> candidates = response.candidates();
        assertThat(candidates).extracting(CandidateDriver::driverId).containsExactly(near, mid);
        assertThat(candidates.get(0).distanceMeters()).isLessThan(candidates.get(1).distanceMeters());
    }
}
