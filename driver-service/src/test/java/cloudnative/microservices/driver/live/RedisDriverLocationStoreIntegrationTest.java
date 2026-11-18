package cloudnative.microservices.driver.live;

import static org.assertj.core.api.Assertions.assertThat;

import java.math.BigDecimal;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

/**
 * Task B2 verification: the Redis-backed live-state store sets ONLINE, records a
 * position, reads it back, expires on a TTL, and clears on OFFLINE. Runs against
 * real Redis (Testcontainers); skipped when Docker is unavailable.
 */
@Testcontainers
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.NONE)
class RedisDriverLocationStoreIntegrationTest {

    @Container
    static final PostgreSQLContainer<?> POSTGRES =
            new PostgreSQLContainer<>("postgres:17").withDatabaseName("driver_service");

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
    }

    @Autowired
    DriverLocationStore store;

    @Autowired
    StringRedisTemplate redis;

    @Test
    void onlineThenLocationIsReadableThenOfflineClears() {
        UUID driverId = UUID.randomUUID();

        store.goOnline(driverId, cloudnative.microservices.driver.entity.VehicleType.CAR);
        assertThat(store.getState(driverId)).isPresent()
                .get().extracting(DriverLiveState::availability).isEqualTo(Availability.ONLINE);
        assertThat(store.getState(driverId).get().vehicleType())
                .isEqualTo(cloudnative.microservices.driver.entity.VehicleType.CAR);

        store.updateLocation(driverId, new BigDecimal("10.762622"), new BigDecimal("106.660172"));
        Optional<DriverLiveState> withLoc = store.getState(driverId);
        assertThat(withLoc).isPresent();
        assertThat(withLoc.get().lat()).isEqualByComparingTo("10.762622");
        assertThat(withLoc.get().lng()).isEqualByComparingTo("106.660172");

        store.goOffline(driverId);
        assertThat(store.getState(driverId)).isEmpty();
    }

    @Test
    void locationWritesBuildAChronologicalTrack() throws InterruptedException {
        UUID driverId = UUID.randomUUID();
        store.goOnline(driverId, cloudnative.microservices.driver.entity.VehicleType.CAR);

        store.updateLocation(driverId, new BigDecimal("10.760000"), new BigDecimal("106.660000"));
        Thread.sleep(5);
        store.updateLocation(driverId, new BigDecimal("10.760000"), new BigDecimal("106.660000"));
        Thread.sleep(5);
        store.updateLocation(driverId, new BigDecimal("10.770000"), new BigDecimal("106.670000"));

        var track = redis.opsForZSet().rangeWithScores("ridenow:driver:track:" + driverId, 0, -1);
        // Same spot twice stays two points; the order follows the timestamps.
        assertThat(track).hasSize(3);
        assertThat(track).extracting(t -> t.getScore()).isSorted();
        assertThat(track.iterator().next().getValue()).startsWith("10.760000,106.660000,");
        assertThat(track.stream().reduce((a, b) -> b).orElseThrow().getValue())
                .startsWith("10.770000,106.670000,");
    }

    @Test
    void trackDropsPointsOlderThanFiveMinutesAndHasATtl() {
        UUID driverId = UUID.randomUUID();
        String trackKey = "ridenow:driver:track:" + driverId;
        long sixMinutesAgo = System.currentTimeMillis() - 6 * 60 * 1000L;
        redis.opsForZSet().add(trackKey, "10.0,106.0," + sixMinutesAgo, sixMinutesAgo);

        store.updateLocation(driverId, new BigDecimal("10.762622"), new BigDecimal("106.660172"));

        assertThat(redis.opsForZSet().range(trackKey, 0, -1))
                .hasSize(1)
                .noneMatch(m -> m.startsWith("10.0,106.0,"));
        Long ttl = redis.getExpire(trackKey, TimeUnit.SECONDS);
        assertThat(ttl).isNotNull().isGreaterThan(0L).isLessThanOrEqualTo(300L);
    }

    @Test
    void goingOfflineClearsTheTrack() {
        UUID driverId = UUID.randomUUID();
        store.goOnline(driverId, cloudnative.microservices.driver.entity.VehicleType.CAR);
        store.updateLocation(driverId, new BigDecimal("10.762622"), new BigDecimal("106.660172"));
        assertThat(redis.hasKey("ridenow:driver:track:" + driverId)).isTrue();

        store.goOffline(driverId);

        assertThat(redis.hasKey("ridenow:driver:track:" + driverId)).isFalse();
    }

    @Test
    void liveRecordHasATtl() {
        UUID driverId = UUID.randomUUID();
        store.goOnline(driverId, cloudnative.microservices.driver.entity.VehicleType.CAR);

        Long ttl = redis.getExpire("ridenow:driver:live:" + driverId, TimeUnit.SECONDS);
        assertThat(ttl).isNotNull().isGreaterThan(0L);
    }
}
