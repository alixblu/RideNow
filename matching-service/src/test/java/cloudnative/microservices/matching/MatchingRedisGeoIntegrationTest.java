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
 * GEOSEARCH - returning only the nearby driver, nearest first. Positions arrive
 * through the driver-locations stream and its consumer group. Proves the
 * substitution behind NearbyDriverFinder works against real Valkey + Postgres.
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
            new GenericContainer<>(DockerImageName.parse("valkey/valkey:8-alpine")).withExposedPorts(6379);

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

    @Autowired
    cloudnative.microservices.matching.event.DriverLocationStreamConsumer consumer;

    @Autowired
    cloudnative.microservices.matching.repository.DriverPositionRepository positionRepository;

    private static final String STREAM = "ridenow:stream:driver-locations";

    /** Appends one update to the stream, as driver-service does. */
    private void append(String json) {
        redis.opsForStream().add(
                org.springframework.data.redis.connection.stream.StreamRecords
                        .string(java.util.Map.of("payload", json)).withStreamKey(STREAM));
    }

    /** The consumer group is created by the consumer thread; entries sent before that are skipped. */
    private void awaitGroup() {
        org.awaitility.Awaitility.await().atMost(java.time.Duration.ofSeconds(15)).until(() -> {
            try {
                return redis.opsForStream().groups(STREAM).size() > 0;
            } catch (RuntimeException e) {
                return false; // the stream does not exist yet
            }
        });
    }

    /**
     * The handoff: a driver who only posts to driver-service is found because
     * matching reads the location stream; going offline removes them.
     */
    @Test
    void aPositionOnTheLocationStreamMakesTheDriverMatchable() {
        awaitGroup();
        UUID driver = UUID.randomUUID();
        MatchRequest request = new MatchRequest(UUID.randomUUID(), VehicleType.MOTORBIKE,
                new BigDecimal("10.200000"), new BigDecimal("106.200000"), 1000, 5);

        append("{\"driverId\":\"" + driver + "\",\"lat\":10.200000,\"lng\":106.200000,"
                + "\"recordedAt\":\"2026-11-11T07:00:00Z\",\"vehicleType\":\"MOTORBIKE\",\"online\":true}");
        org.awaitility.Awaitility.await().atMost(java.time.Duration.ofSeconds(15)).untilAsserted(() ->
                assertThat(matchingService.match(request).candidates())
                        .extracting(CandidateDriver::driverId).contains(driver));

        append("{\"driverId\":\"" + driver + "\",\"recordedAt\":\"2026-11-11T07:00:05Z\",\"online\":false}");
        org.awaitility.Awaitility.await().atMost(java.time.Duration.ofSeconds(10)).untilAsserted(() ->
                assertThat(matchingService.match(request).candidates())
                        .extracting(CandidateDriver::driverId).doesNotContain(driver));
    }

    /**
     * The point of the stream: entries added while matching is not reading are not
     * lost; they are processed once the consumer is back.
     */
    @Test
    void positionsAddedWhileTheConsumerWasStoppedAreAppliedWhenItStartsAgain() {
        awaitGroup();
        UUID driver = UUID.randomUUID();
        MatchRequest request = new MatchRequest(UUID.randomUUID(), VehicleType.CAR,
                new BigDecimal("10.300000"), new BigDecimal("106.300000"), 1000, 5);

        consumer.stop();
        try {
            append("{\"driverId\":\"" + driver + "\",\"lat\":10.300000,\"lng\":106.300000,"
                    + "\"recordedAt\":\"2026-11-11T08:00:00Z\",\"vehicleType\":\"CAR\",\"online\":true}");
            // nothing is reading, so the driver is not known yet
            assertThat(matchingService.match(request).candidates())
                    .extracting(CandidateDriver::driverId).doesNotContain(driver);
        } finally {
            consumer.start();
        }

        org.awaitility.Awaitility.await().atMost(java.time.Duration.ofSeconds(15)).untilAsserted(() ->
                assertThat(matchingService.match(request).candidates())
                        .extracting(CandidateDriver::driverId).contains(driver));
    }

    /** A late, older position must not bring back a driver who already went offline. */
    @Test
    void aLateOlderPositionDoesNotResurrectAnOfflineDriver() {
        awaitGroup();
        UUID driver = UUID.randomUUID();
        MatchRequest request = new MatchRequest(UUID.randomUUID(), VehicleType.CAR,
                new BigDecimal("10.400000"), new BigDecimal("106.400000"), 1000, 5);
        append("{\"driverId\":\"" + driver + "\",\"lat\":10.400000,\"lng\":106.400000,"
                + "\"recordedAt\":\"2026-11-11T09:00:05Z\",\"vehicleType\":\"CAR\",\"online\":true}");
        org.awaitility.Awaitility.await().atMost(java.time.Duration.ofSeconds(15)).untilAsserted(() ->
                assertThat(matchingService.match(request).candidates())
                        .extracting(CandidateDriver::driverId).contains(driver));

        append("{\"driverId\":\"" + driver + "\",\"recordedAt\":\"2026-11-11T09:00:10Z\",\"online\":false}");
        org.awaitility.Awaitility.await().atMost(java.time.Duration.ofSeconds(10)).untilAsserted(() ->
                assertThat(matchingService.match(request).candidates())
                        .extracting(CandidateDriver::driverId).doesNotContain(driver));

        // a replayed position recorded before the offline marker
        append("{\"driverId\":\"" + driver + "\",\"lat\":10.400000,\"lng\":106.400000,"
                + "\"recordedAt\":\"2026-11-11T09:00:07Z\",\"vehicleType\":\"CAR\",\"online\":true}");
        // a probe entry after it; once the probe is applied, the replay was applied (or ignored) too
        UUID probe = UUID.randomUUID();
        append("{\"driverId\":\"" + probe + "\",\"lat\":10.400000,\"lng\":106.400000,"
                + "\"recordedAt\":\"2026-11-11T09:00:11Z\",\"vehicleType\":\"CAR\",\"online\":true}");
        org.awaitility.Awaitility.await().atMost(java.time.Duration.ofSeconds(15)).untilAsserted(() ->
                assertThat(matchingService.match(request).candidates())
                        .extracting(CandidateDriver::driverId).contains(probe));
        assertThat(matchingService.match(request).candidates())
                .extracting(CandidateDriver::driverId).doesNotContain(driver);
    }
    /**
     * Several pods can handle updates for one driver at once. Whatever order they run in,
     * the row and the GEO index must end up at the newest report.
     */
    @Test
    void concurrentOutOfOrderReportsLeaveTheNewestPositionInTheRowAndTheIndex() throws Exception {
        UUID driver = UUID.randomUUID();
        int reports = 60;
        java.time.Instant base = java.time.Instant.parse("2026-11-11T10:00:00Z");
        java.util.List<Integer> order = new java.util.ArrayList<>();
        for (int i = 0; i < reports; i++) {
            order.add(i);
        }
        java.util.Collections.shuffle(order);

        java.util.concurrent.ExecutorService pool = java.util.concurrent.Executors.newFixedThreadPool(8);
        try {
            java.util.List<java.util.concurrent.Future<?>> futures = new java.util.ArrayList<>();
            for (int i : order) {
                futures.add(pool.submit(() -> positionService.reportPosition(driver, VehicleType.CAR,
                        new BigDecimal("10.500000").add(new BigDecimal(i).movePointLeft(4)),
                        new BigDecimal("106.500000"), base.plusSeconds(i))));
            }
            for (java.util.concurrent.Future<?> future : futures) {
                future.get();
            }
        } finally {
            pool.shutdownNow();
        }

        double newestLat = 10.5 + (reports - 1) * 0.0001;
        var point = redis.opsForGeo().position("ridenow:matching:geo:CAR", driver.toString());
        assertThat(point).isNotEmpty();
        assertThat(point.get(0).getY()).isCloseTo(newestLat, org.assertj.core.data.Offset.offset(0.00002));
        assertThat(positionRepository.findById(driver)).hasValueSatisfying(stored -> {
            assertThat(stored.getReportedAt()).isEqualTo(base.plusSeconds(reports - 1));
            assertThat(stored.getLat()).isEqualByComparingTo(new BigDecimal(newestLat).setScale(6, java.math.RoundingMode.HALF_UP));
        });
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
